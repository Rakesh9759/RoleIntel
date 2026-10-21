from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete
from sqlalchemy.orm import Session

from roleintel.models import Application, ApplicationStatus

pytestmark = pytest.mark.integration


def test_details_return_all_persisted_fields_after_reconnect(
    jobs_client: TestClient, postgres_engine: Engine
) -> None:
    payload = {
        "title": "Supplied title",
        "company": "Supplied company",
        "description": "Supplied description",
        "requisition_id": "REQ-42",
        "location": "Remote",
        "technologies": ["Python", "PostgreSQL"],
        "experience_requirements": "Supplied requirements",
        "seniority": "Senior",
        "department": "Engineering",
        "source_url": "https://example.com/jobs/42",
    }
    saved = jobs_client.post("/api/jobs", json=payload).json()
    # More recent records must not hide the target behind the default listing page.
    for index in range(21):
        jobs_client.post("/api/jobs", json={"description": f"Pagination fixture {index}"})
    postgres_engine.dispose()
    response = jobs_client.get(f"/api/jobs/{saved['id']}")
    assert response.status_code == 200
    assert response.json() == saved
    assert all(response.json()[key] == value for key, value in payload.items())


def test_details_keep_unknown_fields_and_missing_tracking_null(
    jobs_client: TestClient, postgres_engine: Engine
) -> None:
    saved = jobs_client.post("/api/jobs", json={"source_url": "https://example.invalid/job"}).json()
    assert jobs_client.get(f"/api/jobs/{saved['id']}").json() == saved
    with Session(postgres_engine) as session:
        session.execute(delete(Application).where(Application.job_id == UUID(saved["id"])))
        session.commit()
    response = jobs_client.get(f"/api/jobs/{saved['id']}")
    assert response.status_code == 200
    assert response.json() == {**saved, "application": None}
    assert (
        jobs_client.patch(f"/api/jobs/{saved['id']}/status", json={"status": "applied"}).status_code
        == 404
    )


def test_missing_and_invalid_job_ids_are_explicit(jobs_client: TestClient) -> None:
    response = jobs_client.get(f"/api/jobs/{uuid4()}")
    assert response.status_code == 404
    assert response.json() == {
        "detail": {"code": "job_not_found", "message": "Saved job not found"}
    }
    invalid = jobs_client.get("/api/jobs/not-a-uuid")
    assert invalid.status_code == 422
    assert all("input" not in item for item in invalid.json()["detail"])


@pytest.mark.parametrize("status", list(ApplicationStatus))
def test_detail_reload_reflects_status_without_job_changes(
    jobs_client: TestClient, postgres_engine: Engine, status: ApplicationStatus
) -> None:
    saved = jobs_client.post("/api/jobs", json={"description": "Supplied description"}).json()
    changed = jobs_client.patch(f"/api/jobs/{saved['id']}/status", json={"status": status})
    assert changed.status_code == 200
    postgres_engine.dispose()
    detail = jobs_client.get(f"/api/jobs/{saved['id']}").json()
    assert detail == changed.json()
    assert detail["application"]["status"] == status
    assert {key: value for key, value in detail.items() if key != "application"} == {
        key: value for key, value in saved.items() if key != "application"
    }
