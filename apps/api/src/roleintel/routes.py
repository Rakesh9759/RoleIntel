from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from roleintel.database import get_session
from roleintel.jobs import create_job, get_job, list_jobs, update_job_status
from roleintel.models import Job
from roleintel.schemas import ErrorResponse, JobCreate, JobFilters, JobRead, StatusUpdate

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
def saved_jobs(session: DatabaseSession, filters: Annotated[JobFilters, Query()]) -> list[Job]:
    return list_jobs(session, filters)


@router.get(
    "/{job_id}",
    response_model=JobRead,
    responses={404: {"model": ErrorResponse, "description": "Job not found"}},
)
def job_details(job_id: UUID, session: DatabaseSession) -> Job:
    job = get_job(session, job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "job_not_found", "message": "Saved job not found"},
        )
    return job


@router.patch(
    "/{job_id}/status",
    response_model=JobRead,
    responses={404: {"model": ErrorResponse, "description": "Job or tracking record not found"}},
)
def change_status(job_id: UUID, submission: StatusUpdate, session: DatabaseSession) -> Job:
    job = update_job_status(session, job_id, submission.status)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "job_not_found",
                "message": "Saved job or application tracking record not found",
            },
        )
    return job
