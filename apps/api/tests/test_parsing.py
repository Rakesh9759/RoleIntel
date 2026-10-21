from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from roleintel.database import dispose_engine
from roleintel.main import app
from roleintel.models import Application, Job
from roleintel.parsing import normalize_description
from roleintel.schemas import JobParseRequest


def parse(text: str) -> dict[str, object]:
    return normalize_description(JobParseRequest(description=text)).model_dump(mode="json")


def test_normalizes_whitespace_without_losing_paragraphs_or_markup() -> None:
    result = parse(
        "  Company:\t Example\u00a0Co \r\n\r\n\r\n  A   role.\rNext line."
        "\n\n<script>literal</script> "
    )
    assert (
        result["description"]
        == "Company: Example Co\n\nA role.\nNext line.\n\n<script>literal</script>"
    )
    assert result["company"] == "Example Co"
    assert result["title"] is None
    assert result["warnings"] == []
    assert parse(str(result["description"])) == result


def test_extracts_only_supported_explicit_single_line_labels() -> None:
    result = parse(
        "COMPANY NAME: Supplied Co\nJob title: Supplied role\nRequisition ID: 42\n"
        "Location: Remote\nRequired technologies: C++, Python; SQL; Python\n"
        "Experience requirements: 3 years supplied\nSeniority: Senior\nTeam: Test team\n"
        "Salary: supplied but unsupported\nhttps://example.com/not-fetched"
    )
    assert result == {
        "company": "Supplied Co",
        "title": "Supplied role",
        "requisition_id": "42",
        "description": result["description"],
        "location": "Remote",
        "technologies": ["C++", "Python", "SQL"],
        "experience_requirements": "3 years supplied",
        "seniority": "Senior",
        "department": "Test team",
        "source_url": None,
        "warnings": [],
    }


def test_prose_and_unlabeled_headings_never_invent_fields() -> None:
    text = (
        "Senior Python Engineer at Example Co\nRemote, 5 years of experience."
        "\nTechnologies:\nPython\nSQL"
    )
    result = parse(text)
    for name in result.keys() - {"description", "warnings"}:
        assert result[name] is None
    assert result["description"] == text
    assert result["warnings"] == ["technologies: blank or conflicting labels; review manually."]


@pytest.mark.parametrize(
    ("text", "field"),
    [
        ("Company: One\nCompany name: Two", "company"),
        ("Title: Role\nJob title:", "title"),
        ("Department: A\nTeam: B", "department"),
        ("Location: Remote\nLocation: remote", "location"),
        ("Technologies: Python,,SQL", "technologies"),
        ("Technologies: " + ",".join(str(index) for index in range(101)), "technologies"),
        ("Title: " + "x" * 1001, "title"),
    ],
)
def test_conflicting_blank_or_oversized_labels_remain_null(text: str, field: str) -> None:
    result = parse(text)
    assert result[field] is None
    assert result["warnings"]
    assert result["description"] == text


def test_repeated_identical_labels_and_colons_in_values_are_preserved() -> None:
    result = parse("Job title: Role: Platform\nTitle: Role: Platform\nTechnologies: C++; C++")
    assert result["title"] == "Role: Platform"
    assert result["technologies"] == ["C++"]
    assert result["warnings"] == []


def test_spacing_around_colons_and_aliases_are_supported() -> None:
    result = parse(
        " company  name : Explicit company\nTITLE : Explicit title\nJob ID : TEST-14\n"
        "Department : Explicit department\nTechnologies : C#; .NET"
    )
    assert result["company"] == "Explicit company"
    assert result["title"] == "Explicit title"
    assert result["requisition_id"] == "TEST-14"
    assert result["department"] == "Explicit department"
    assert result["technologies"] == ["C#", ".NET"]


def test_label_limits_and_description_boundary() -> None:
    result = parse("Title: " + "x" * 1000)
    assert result["title"] == "x" * 1000
    result = parse("Technologies: " + ",".join(str(index) for index in range(100)))
    assert isinstance(result["technologies"], list)
    assert len(result["technologies"]) == 100
    assert parse("x" * 100_000)["description"] == "x" * 100_000


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"description": ""},
        {"description": " \t\r\n "},
        {"description": 42},
        {"description": None},
        {"description": "x" * 100_001},
        {"description": "private\x00text"},
        {"description": "private\x01text"},
        {"description": "valid", "source_url": "https://example.com"},
    ],
)
def test_parse_rejects_invalid_input_without_echoing_it(payload: dict[str, object]) -> None:
    with TestClient(app) as client:
        response = client.post("/api/jobs/parse", json=payload)
    assert response.status_code == 422
    assert all("input" not in item for item in response.json()["detail"])
    assert "private" not in response.text


def test_parse_has_no_database_or_network_dependency(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    dispose_engine()
    with (
        TestClient(app) as client,
        patch("roleintel.database.create_engine", side_effect=AssertionError("Database accessed")),
        patch("socket.create_connection", side_effect=AssertionError("Network accessed")),
    ):
        response = client.post(
            "/api/jobs/parse", json={"description": "Company: Test\nhttps://example.invalid/job"}
        )
        assert response.status_code == 200
        assert response.json()["company"] == "Test"
        assert response.json()["source_url"] is None
        assert "id" not in response.json()
        assert "application" not in response.json()
        schema = client.get("/openapi.json").json()
        assert "200" in schema["paths"]["/api/jobs/parse"]["post"]["responses"]


@pytest.mark.integration
def test_parse_preview_does_not_write_until_explicit_save(
    jobs_client: TestClient, postgres_engine: Engine
) -> None:
    response = jobs_client.post(
        "/api/jobs/parse",
        json={"description": "Company: Explicit fixture\nTitle: Supplied role\n\nSupplied duties."},
    )
    assert response.status_code == 200
    with Session(postgres_engine) as session:
        assert session.scalar(select(func.count()).select_from(Job)) == 0
        assert session.scalar(select(func.count()).select_from(Application)) == 0
    draft = response.json()
    draft.pop("warnings")
    draft["title"] = "User reviewed title"
    saved = jobs_client.post("/api/jobs", json=draft)
    assert saved.status_code == 201
    detail = jobs_client.get(f"/api/jobs/{saved.json()['id']}").json()
    assert detail["title"] == "User reviewed title"
    assert detail["company"] == "Explicit fixture"
    assert detail["application"]["status"] == "interested"
    assert detail["description"] == draft["description"]
