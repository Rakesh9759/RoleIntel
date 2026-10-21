from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from roleintel.models import Application, ApplicationStatus, Job
from roleintel.schemas import JobCreate, JobFilters


def create_job(session: Session, submission: JobCreate) -> Job:
    fields = submission.model_dump(exclude={"source_url"})
    job = Job(
        **fields,
        source_url=str(submission.source_url) if submission.source_url is not None else None,
    )
    job.application = Application()
    with session.begin():
        session.add(job)
    return job


def list_jobs(session: Session, filters: JobFilters) -> list[Job]:
    statement = (
        select(Job)
        .options(joinedload(Job.application))
        .order_by(Job.created_at.desc(), Job.id.desc())
    )
    if filters.company is not None:
        statement = statement.where(func.lower(Job.company) == func.lower(filters.company))
    if filters.status is not None:
        statement = statement.where(Job.application.has(Application.status == filters.status))
    if filters.q is not None:
        statement = statement.where(
            or_(
                Job.title.icontains(filters.q, autoescape=True),
                Job.company.icontains(filters.q, autoescape=True),
                Job.description.icontains(filters.q, autoescape=True),
            )
        )
    statement = statement.limit(filters.limit).offset(filters.offset)
    return list(session.scalars(statement))


def update_job_status(session: Session, job_id: UUID, status: ApplicationStatus) -> Job | None:
    with session.begin():
        job = session.scalar(
            select(Job).options(joinedload(Job.application)).where(Job.id == job_id)
        )
        if job is None or job.application is None:
            return None
        job.application.status = status
    return job
