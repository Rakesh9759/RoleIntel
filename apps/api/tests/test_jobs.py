import logging
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session

from roleintel.database import dispose_engine, get_engine
from roleintel.main import app
from roleintel.models import Application, Job
from roleintel.schemas import JobCreate, JobFilters


@pytest.mark.integration
def test_submit_and_list_persisted_job(jobs_client: TestClient, postgres_engine: Engine) -> None:
    assert jobs_client.get("/api/jobs").json() == []
    payload = {
        "title": "  Supplied job title  ",
        "company": "Example test company",
        "description": "User-provided description",
        "source_url": "https://example.com/jobs/42",
        "technologies": [" Python ", "PostgreSQL"],
        "requisition_id": "42",
        "location": "Remote",
        "experience_requirements": "User-provided requirements",
        "seniority": "Senior",
        "department": "Engineering",
    }
    response = jobs_client.post("/api/jobs", json=payload)
    assert response.status_code == 201
    saved = response.json()
    assert saved["title"] == "Supplied job title"
    assert saved["technologies"] == ["Python", "PostgreSQL"]
    for name in payload.keys() - {"title", "technologies"}:
        assert saved[name] == payload[name]
    assert saved["application"]["status"] == "interested"
    assert saved["application"]["job_id"] == saved["id"]
    assert saved["created_at"]
    assert saved["updated_at"]
    assert saved["application"]["created_at"]

    postgres_engine.dispose()
    assert jobs_client.get("/api/jobs").json() == [saved]
    with Session(postgres_engine) as session:
        assert session.get(Job, UUID(saved["id"])) is not None
        assert session.scalar(select(func.count()).select_from(Application)) == 1


@pytest.mark.integration
@pytest.mark.parametrize(
    "payload",
    [
        {"description": "User-provided description"},
        {"source_url": "https://example.invalid/never-fetched"},
    ],
)
def test_minimal_submissions_keep_unknown_fields_null(
    jobs_client: TestClient, payload: dict[str, str]
) -> None:
    response = jobs_client.post("/api/jobs", json=payload)
    assert response.status_code == 201
    saved = response.json()
    for name in (
        "company",
        "title",
        "requisition_id",
        "location",
        "technologies",
        "experience_requirements",
        "seniority",
        "department",
    ):
        assert saved[name] is None
    if "description" not in payload:
        assert saved["description"] is None
    if "source_url" not in payload:
        assert saved["source_url"] is None


@pytest.mark.integration
def test_listing_is_newest_first_with_stable_ties(
    jobs_client: TestClient, postgres_engine: Engine
) -> None:
    records = [
        jobs_client.post("/api/jobs", json={"description": value}).json()
        for value in ("first", "second", "third")
    ]
    assert [item["id"] for item in jobs_client.get("/api/jobs").json()] == [
        item["id"] for item in reversed(records)
    ]
    with postgres_engine.begin() as connection:
        connection.execute(text("UPDATE jobs SET created_at = '2026-01-01T00:00:00Z'"))
    assert [item["id"] for item in jobs_client.get("/api/jobs").json()] == sorted(
        (item["id"] for item in records), reverse=True
    )


@pytest.mark.integration
@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"title": "Only a title"},
        {"description": "   "},
        {"description": 42},
        {"description": "x" * 100_001},
        {"description": "valid", "title": "x" * 1001},
        {"source_url": "file:///private/file"},
        {"source_url": "not a URL"},
        {"source_url": "https://user:private_password@example.com"},
        {"source_url": "https://example.com/" + "x" * 2048},
        {"description": "valid", "technologies": [""]},
        {"description": "valid", "technologies": ["x"] * 101},
        {"description": "valid", "status": "applied"},
        {"description": "valid", "id": "untrusted"},
    ],
)
def test_invalid_submissions_do_not_write_rows(
    jobs_client: TestClient, postgres_engine: Engine, payload: dict[str, object]
) -> None:
    response = jobs_client.post("/api/jobs", json=payload)
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    assert "private_password" not in response.text
    assert all("input" not in item for item in response.json()["detail"])
    with Session(postgres_engine) as session:
        assert session.scalar(select(func.count()).select_from(Job)) == 0
        assert session.scalar(select(func.count()).select_from(Application)) == 0


@pytest.mark.integration
def test_tracking_failure_rolls_back_job(jobs_client: TestClient, postgres_engine: Engine) -> None:
    with postgres_engine.begin() as connection:
        connection.execute(
            text("ALTER TABLE applications ADD CONSTRAINT force_failure CHECK (false)")
        )
    response = jobs_client.post("/api/jobs", json={"description": "private candidate text"})
    assert response.status_code == 503
    assert response.json() == {
        "detail": {"code": "database_unavailable", "message": "Database is unavailable"}
    }
    assert "private candidate text" not in response.text
    with Session(postgres_engine) as session:
        assert session.scalar(select(func.count()).select_from(Job)) == 0
        assert session.scalar(select(func.count()).select_from(Application)) == 0


@pytest.mark.integration
def test_real_database_dependency_survives_app_restart(
    postgres_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    with postgres_engine.connect() as connection:
        schema = connection.scalar(text("SELECT current_schema()"))
    assert isinstance(schema, str)
    url = postgres_engine.url.update_query_dict({"options": f"-csearch_path={schema}"})
    monkeypatch.setenv("DATABASE_URL", url.render_as_string(hide_password=False))
    dispose_engine()

    with TestClient(app) as client:
        response = client.post("/api/jobs", json={"description": "Supplied description"})
        assert response.status_code == 201
        saved = response.json()
    assert get_engine.cache_info().currsize == 0

    with TestClient(app) as restarted:
        response = restarted.get("/api/jobs")
        assert response.status_code == 200
        assert response.json() == [saved]
    assert get_engine.cache_info().currsize == 0


@pytest.mark.integration
def test_malformed_json_is_structured_and_redacted(jobs_client: TestClient) -> None:
    response = jobs_client.post(
        "/api/jobs",
        content='{"description": "private candidate text",}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert "private candidate text" not in response.text
    assert response.json()["detail"][0]["type"] == "json_invalid"


@pytest.mark.parametrize(
    ("field", "limit"),
    [
        ("title", 1000),
        ("description", 100_000),
        ("experience_requirements", 100_000),
    ],
)
def test_text_size_boundaries(field: str, limit: int) -> None:
    payload = {"description": "Supplied description", field: "x" * limit}
    assert getattr(JobCreate.model_validate(payload), field) == "x" * limit
    payload[field] += "x"
    with pytest.raises(ValidationError):
        JobCreate.model_validate(payload)


def test_technology_count_boundary() -> None:
    payload = {"description": "Supplied description", "technologies": ["Python"] * 100}
    assert len(JobCreate.model_validate(payload).technologies or []) == 100
    payload["technologies"] = ["Python"] * 101
    with pytest.raises(ValidationError):
        JobCreate.model_validate(payload)


def test_database_configuration_failure_is_explicit(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    dispose_engine()
    with TestClient(app) as client, caplog.at_level(logging.ERROR):
        response = client.get("/api/jobs")
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "database_unavailable"
        assert client.get("/health").json() == {"status": "ok"}
    assert "configuration is missing or invalid" in caplog.text


@pytest.mark.parametrize("method", ["GET", "DETAIL", "PATCH"])
def test_unreachable_database_is_redacted(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, method: str
) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+psycopg://user:private_password@127.0.0.1:1/unreachable",
    )
    dispose_engine()
    with TestClient(app) as client, caplog.at_level(logging.ERROR):
        if method == "GET":
            response = client.get("/api/jobs")
        elif method == "DETAIL":
            response = client.get("/api/jobs/00000000-0000-0000-0000-000000000001")
        else:
            response = client.patch(
                "/api/jobs/00000000-0000-0000-0000-000000000001/status",
                json={"status": "applied"},
            )
        assert response.status_code == 503
    assert "private_password" not in response.text
    assert "private_password" not in caplog.text
    assert "Database operation failed" in caplog.text
    assert get_engine.cache_info().currsize == 0


def test_openapi_documents_submission_and_listing() -> None:
    with TestClient(app) as client:
        response = client.get("/openapi.json")
    assert response.status_code == 200
    operations = response.json()["paths"]["/api/jobs"]
    assert "201" in operations["post"]["responses"]
    assert "200" in operations["get"]["responses"]
    assert "503" in operations["get"]["responses"]
    parameters = {item["name"]: item["schema"] for item in operations["get"]["parameters"]}
    assert parameters["limit"]["default"] == 20
    assert parameters["limit"]["maximum"] == 100
    assert parameters["offset"]["default"] == 0
    assert {"q", "company", "status"} <= parameters.keys()
    patch = response.json()["paths"]["/api/jobs/{job_id}/status"]["patch"]
    assert {"200", "404", "422", "503"} <= patch["responses"].keys()
    detail = response.json()["paths"]["/api/jobs/{job_id}"]["get"]
    assert {"200", "404", "422", "503"} <= detail["responses"].keys()


def test_filter_model_boundaries() -> None:
    filters = JobFilters(limit=100, offset=2**63 - 1, company="x" * 1000, q="y" * 1000)
    assert filters.limit == 100
    assert filters.offset == 2**63 - 1
    for payload in (
        {"limit": 101},
        {"offset": 2**63},
        {"company": "x" * 1001},
        {"q": "y" * 1001},
    ):
        with pytest.raises(ValidationError):
            JobFilters.model_validate(payload)
