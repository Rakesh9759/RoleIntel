from uuid import uuid4

import pytest
from psycopg import Error
from sqlalchemy import Engine, delete, func, select, text, update
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session

from roleintel.models import Application, ApplicationStatus, Job

pytestmark = pytest.mark.integration


def test_job_and_application_survive_commit_and_reconnect(postgres_engine: Engine) -> None:
    fields = {
        "company": "Example test company",
        "title": "Test engineer",
        "requisition_id": "TEST-42",
        "description": "User-supplied test description",
        "location": "Remote",
        "technologies": ["Python", "PostgreSQL"],
        "experience_requirements": "User-supplied requirements",
        "seniority": "Senior",
        "department": "Engineering",
        "source_url": "https://example.com/jobs/TEST-42",
    }
    with Session(postgres_engine) as session:
        job = Job(**fields)
        application = Application()
        job.application = application
        session.add(job)
        session.commit()
        job_id, application_id = job.id, application.id
        created_at, updated_at = job.created_at, job.updated_at
        application_created_at = application.created_at

    postgres_engine.dispose()

    with Session(postgres_engine) as session:
        saved = session.get(Job, job_id)
        assert saved is not None
        for name, value in fields.items():
            assert getattr(saved, name) == value
        assert saved.created_at == created_at
        assert saved.updated_at == updated_at
        assert saved.created_at.utcoffset() is not None
        assert saved.updated_at.utcoffset() is not None
        tracking = saved.application
        assert tracking is not None
        assert tracking.id == application_id
        assert tracking.job_id == job_id
        assert tracking.job is saved
        assert tracking.status is ApplicationStatus.INTERESTED
        assert tracking.created_at == application_created_at
        assert tracking.created_at.utcoffset() is not None
        assert tracking.updated_at.utcoffset() is not None


@pytest.mark.parametrize("technologies", [None, []])
def test_unknown_job_details_remain_null(
    postgres_engine: Engine, technologies: list[str] | None
) -> None:
    with Session(postgres_engine) as session:
        job = Job(technologies=technologies)
        session.add(job)
        session.commit()
        job_id = job.id

    with Session(postgres_engine) as session:
        saved = session.get(Job, job_id)
        assert saved is not None
        for name in (
            "company",
            "title",
            "requisition_id",
            "description",
            "location",
            "experience_requirements",
            "seniority",
            "department",
            "source_url",
        ):
            assert getattr(saved, name) is None
        assert saved.technologies == technologies


@pytest.mark.parametrize("initial", list(ApplicationStatus))
@pytest.mark.parametrize("target", list(ApplicationStatus))
def test_every_status_transition_persists(
    postgres_engine: Engine, initial: ApplicationStatus, target: ApplicationStatus
) -> None:
    with Session(postgres_engine) as session:
        application = Application(job=Job(), status=initial)
        session.add(application)
        session.commit()
        application_id = application.id

    with Session(postgres_engine) as session:
        saved = session.get(Application, application_id)
        assert saved is not None
        assert saved.status is initial
        saved.status = target
        session.commit()

    with Session(postgres_engine) as session:
        reloaded = session.get(Application, application_id)
        assert reloaded is not None
        assert reloaded.status is target


@pytest.mark.parametrize("invalid", ["unknown", "Interested", ""])
def test_orm_rejects_invalid_status(postgres_engine: Engine, invalid: str) -> None:
    with postgres_engine.begin() as connection:
        with pytest.raises(StatementError) as error:
            connection.execute(update(Application).values(status=invalid))
        assert isinstance(error.value.orig, LookupError)


@pytest.mark.parametrize(
    ("statement", "sqlstate"),
    [
        ("INSERT INTO applications (id, job_id, status) VALUES (:id, :job_id, 'unknown')", "23514"),
        ("INSERT INTO applications (id, job_id, status) VALUES (:id, :job_id, NULL)", "23502"),
        ("INSERT INTO applications (id, job_id) VALUES (:id, :job_id)", "23505"),
        ("INSERT INTO applications (id, job_id) VALUES (:id, :missing_job_id)", "23503"),
    ],
    ids=["invalid-status", "null-status", "duplicate-tracking", "orphan-job"],
)
def test_database_constraints_reject_invalid_rows(
    postgres_engine: Engine, statement: str, sqlstate: str
) -> None:
    job_id = uuid4()
    with postgres_engine.begin() as connection:
        connection.execute(text("INSERT INTO jobs (id) VALUES (:id)"), {"id": job_id})
        connection.execute(
            text("INSERT INTO applications (id, job_id) VALUES (:id, :job_id)"),
            {"id": uuid4(), "job_id": job_id},
        )
    with pytest.raises(IntegrityError) as error, postgres_engine.begin() as connection:
        connection.execute(
            text(statement),
            {"id": uuid4(), "job_id": job_id, "missing_job_id": uuid4()},
        )
    assert isinstance(error.value.orig, Error)
    assert error.value.orig.sqlstate == sqlstate

    with Session(postgres_engine) as session:
        assert session.scalar(select(func.count()).select_from(Application)) == 1


@pytest.mark.parametrize("mode", ["orm-loaded", "orm-unloaded", "sql"])
def test_deleting_job_removes_tracking(postgres_engine: Engine, mode: str) -> None:
    with Session(postgres_engine) as session:
        application = Application(job=Job())
        session.add(application)
        session.commit()
        job_id, application_id = application.job_id, application.id

    with Session(postgres_engine) as session:
        if mode == "sql":
            session.execute(delete(Job).where(Job.id == job_id))
        else:
            job = session.get(Job, job_id)
            assert job is not None
            if mode == "orm-loaded":
                assert job.application is not None
            session.delete(job)
        session.commit()

    with Session(postgres_engine) as session:
        assert session.get(Job, job_id) is None
        assert session.get(Application, application_id) is None


def test_failed_transaction_does_not_persist_job(postgres_engine: Engine) -> None:
    job_id = uuid4()
    with Session(postgres_engine) as session:
        session.add(Job(id=job_id))
        session.flush()
        session.add(Application(job_id=uuid4()))
        with pytest.raises(IntegrityError) as error:
            session.commit()
        assert isinstance(error.value.orig, Error)
        assert error.value.orig.sqlstate == "23503"
        session.rollback()
        assert session.get(Job, job_id) is None

    with Session(postgres_engine) as session:
        assert session.get(Job, job_id) is None
        assert session.scalar(select(func.count()).select_from(Application)) == 0


def test_orm_updates_advance_timestamps(postgres_engine: Engine) -> None:
    with Session(postgres_engine) as session:
        job = Job(title="Original supplied title")
        application = Application(job=job)
        session.add(application)
        session.commit()
        job_id, application_id = job.id, application.id
        job_created, job_updated = job.created_at, job.updated_at
        application_created, application_updated = application.created_at, application.updated_at

    with postgres_engine.connect() as connection:
        connection.execute(text("SELECT pg_sleep(0.01)"))

    with Session(postgres_engine) as session:
        saved = session.get(Job, job_id)
        tracking = session.get(Application, application_id)
        assert saved is not None
        assert tracking is not None
        saved.title = "Updated supplied title"
        tracking.status = ApplicationStatus.APPLIED
        session.commit()

    with Session(postgres_engine) as session:
        saved = session.get(Job, job_id)
        tracking = session.get(Application, application_id)
        assert saved is not None
        assert tracking is not None
        assert saved.created_at == job_created
        assert tracking.created_at == application_created
        assert saved.updated_at > job_updated
        assert tracking.updated_at > application_updated
