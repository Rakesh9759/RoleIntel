from datetime import datetime
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select, text
from sqlalchemy.orm import Session

from roleintel.models import Application, ApplicationStatus, Job

pytestmark = pytest.mark.integration


def test_pagination_default_maximum_and_stable_pages(
    jobs_client: TestClient, postgres_engine: Engine
) -> None:
    with Session(postgres_engine) as session:
        for index in range(105):
            session.add(Job(id=UUID(int=index + 1), description="Supplied description"))
        session.commit()
    expected = [str(UUID(int=index)) for index in range(105, 0, -1)]
    default = jobs_client.get("/api/jobs")
    assert default.status_code == 200
    assert [job["id"] for job in default.json()] == expected[:20]
    first = jobs_client.get("/api/jobs", params={"limit": 100, "offset": 0})
    second = jobs_client.get("/api/jobs", params={"limit": 100, "offset": 100})
    assert first.status_code == second.status_code == 200
    assert [job["id"] for job in first.json() + second.json()] == expected
    assert jobs_client.get("/api/jobs", params={"offset": 105}).json() == []
    single = jobs_client.get("/api/jobs", params={"limit": 1, "offset": 10})
    assert [job["id"] for job in single.json()] == expected[10:11]


@pytest.mark.parametrize(
    "params",
    [
        {"limit": "0"},
        {"limit": "101"},
        {"limit": "-1"},
        {"limit": "1.5"},
        {"limit": "abc"},
        {"offset": "-1"},
        {"offset": "1.5"},
        {"offset": "abc"},
        {"offset": str(2**63)},
        {"status": "Interested"},
        {"status": "unknown"},
        {"q": ""},
        {"q": "   "},
        {"q": "x" * 1001},
        {"company": ""},
        {"company": "  "},
        {"company": "x" * 1001},
        {"unrecognized": "value"},
    ],
)
def test_invalid_query_is_structured(jobs_client: TestClient, params: dict[str, str]) -> None:
    response = jobs_client.get("/api/jobs", params=params)
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    assert all("input" not in error for error in response.json()["detail"])


def test_combined_filters_apply_before_pagination(
    jobs_client: TestClient, postgres_engine: Engine
) -> None:
    with Session(postgres_engine) as session:
        for index, (company, title, description, status) in enumerate(
            [
                ("Example Co", "Python engineer", None, ApplicationStatus.APPLIED),
                ("EXAMPLE CO", None, "Python work", ApplicationStatus.APPLIED),
                ("Example Co", "Python engineer", None, ApplicationStatus.INTERESTED),
                ("Example Co", "Designer", None, ApplicationStatus.APPLIED),
                ("Example Co subsidiary", "Python engineer", None, ApplicationStatus.APPLIED),
                (None, None, None, ApplicationStatus.APPLIED),
            ]
        ):
            job = Job(id=UUID(int=index + 1), company=company, title=title, description=description)
            job.application = Application(status=status)
            session.add(job)
        session.commit()

    params = {"company": " example co ", "q": " PYTHON ", "status": "applied", "limit": 1}
    first = jobs_client.get("/api/jobs", params=params)
    assert first.status_code == 200
    assert [job["id"] for job in first.json()] == [str(UUID(int=2))]
    second = jobs_client.get("/api/jobs", params={**params, "offset": 1})
    assert [job["id"] for job in second.json()] == [str(UUID(int=1))]
    assert jobs_client.get("/api/jobs", params={**params, "offset": 2}).json() == []
    assert jobs_client.get("/api/jobs", params={"company": "Example"}).json() == []
    assert len(jobs_client.get("/api/jobs", params={"q": "example co"}).json()) == 5
    assert jobs_client.get("/api/jobs", params={"q": "unmatched"}).json() == []


@pytest.mark.parametrize("literal", ["%", "_", "/", "\\", "' OR 1=1 --"])
def test_search_characters_are_literal(jobs_client: TestClient, literal: str) -> None:
    wanted = jobs_client.post(
        "/api/jobs", json={"description": f"before{literal}after", "company": literal}
    )
    assert wanted.status_code == 201
    unrelated = jobs_client.post(
        "/api/jobs", json={"description": "ordinary text", "company": "other"}
    )
    assert unrelated.status_code == 201
    for params in ({"q": literal}, {"company": literal}):
        response = jobs_client.get("/api/jobs", params=params)
        assert response.status_code == 200
        assert [job["id"] for job in response.json()] == [wanted.json()["id"]]


@pytest.mark.parametrize("target", list(ApplicationStatus))
def test_status_update_persists_and_changes_filter_results(
    jobs_client: TestClient, postgres_engine: Engine, target: ApplicationStatus
) -> None:
    created = jobs_client.post("/api/jobs", json={"description": "User-supplied description"})
    assert created.status_code == 201
    saved = created.json()
    route = f"/api/jobs/{saved['id']}/status"
    assert jobs_client.patch(route, json={"status": "rejected"}).status_code == 200
    response = jobs_client.patch(route, json={"status": target.value})
    assert response.status_code == 200
    updated = response.json()
    for field in saved.keys() - {"application"}:
        assert updated[field] == saved[field]
    assert updated["application"]["id"] == saved["application"]["id"]
    assert updated["application"]["created_at"] == saved["application"]["created_at"]
    assert updated["application"]["status"] == target.value
    assert datetime.fromisoformat(updated["application"]["updated_at"]) > datetime.fromisoformat(
        saved["application"]["updated_at"]
    )
    assert jobs_client.patch(route, json={"status": target.value}).json() == updated

    postgres_engine.dispose()
    filtered = jobs_client.get("/api/jobs", params={"status": target.value})
    assert filtered.json() == [updated]
    other_status = "applied" if target is not ApplicationStatus.APPLIED else "interested"
    assert jobs_client.get("/api/jobs", params={"status": other_status}).json() == []
    with Session(postgres_engine) as session:
        tracking = session.get(Application, UUID(saved["application"]["id"]))
        assert tracking is not None
        assert tracking.status is target


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"status": None},
        {"status": "unknown"},
        {"status": "Applied"},
        {"status": 42},
        {"status": "applied", "title": "untrusted"},
    ],
)
def test_invalid_status_update_does_not_change_tracking(
    jobs_client: TestClient, payload: dict[str, object]
) -> None:
    saved = jobs_client.post("/api/jobs", json={"description": "Supplied description"}).json()
    response = jobs_client.patch(f"/api/jobs/{saved['id']}/status", json=payload)
    assert response.status_code == 422
    assert jobs_client.get("/api/jobs").json() == [saved]


@pytest.mark.parametrize("missing_tracking", [False, True])
def test_missing_job_or_tracking_is_404(
    jobs_client: TestClient, postgres_engine: Engine, missing_tracking: bool
) -> None:
    job_id = uuid4()
    if missing_tracking:
        with Session(postgres_engine) as session:
            session.add(Job(id=job_id))
            session.commit()
    response = jobs_client.patch(f"/api/jobs/{job_id}/status", json={"status": "applied"})
    assert response.status_code == 404
    assert response.json() == {
        "detail": {
            "code": "job_not_found",
            "message": "Saved job or application tracking record not found",
        }
    }
    with Session(postgres_engine) as session:
        assert session.scalar(select(Application).where(Application.job_id == job_id)) is None


def test_invalid_job_id_is_422(jobs_client: TestClient) -> None:
    response = jobs_client.patch("/api/jobs/not-a-uuid/status", json={"status": "applied"})
    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "uuid_parsing"


def test_failed_status_write_rolls_back(jobs_client: TestClient, postgres_engine: Engine) -> None:
    saved = jobs_client.post("/api/jobs", json={"description": "private job text"}).json()
    with postgres_engine.begin() as connection:
        connection.execute(
            text(
                "ALTER TABLE applications ADD CONSTRAINT reject_applied CHECK (status <> 'applied')"
            )
        )
    response = jobs_client.patch(f"/api/jobs/{saved['id']}/status", json={"status": "applied"})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "database_unavailable"
    assert "private job text" not in response.text
    assert jobs_client.get("/api/jobs").json() == [saved]
