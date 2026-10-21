from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from roleintel.database import get_session
from roleintel.jobs import create_job, list_jobs
from roleintel.models import Job
from roleintel.schemas import ErrorResponse, JobCreate, JobRead

router = APIRouter(
    prefix="/api/jobs",
    tags=["jobs"],
    responses={503: {"model": ErrorResponse, "description": "Database unavailable"}},
)
DatabaseSession = Annotated[Session, Depends(get_session)]


@router.post("", response_model=JobRead, status_code=201)
def submit_job(submission: JobCreate, session: DatabaseSession) -> Job:
    return create_job(session, submission)


@router.get("", response_model=list[JobRead])
def saved_jobs(session: DatabaseSession) -> list[Job]:
    return list_jobs(session)
