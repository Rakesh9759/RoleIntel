from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from roleintel.models import Application, Job
from roleintel.schemas import JobCreate


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


def list_jobs(session: Session) -> list[Job]:
    statement = (
        select(Job)
        .options(joinedload(Job.application))
        .order_by(Job.created_at.desc(), Job.id.desc())
    )
    return list(session.scalars(statement))
