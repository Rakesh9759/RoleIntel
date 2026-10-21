import logging
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from roleintel.database import get_session
from roleintel.jobs import create_job, get_job, list_jobs, update_job_status
from roleintel.models import Job
from roleintel.parsing import normalize_description
from roleintel.providers.ashby import import_ashby_job
from roleintel.providers.common import ProviderError
from roleintel.providers.greenhouse import import_greenhouse_job
from roleintel.providers.lever import import_lever_job
from roleintel.schemas import (
    ErrorResponse,
    JobCreate,
    JobFilters,
    JobImportRequest,
    JobParseRequest,
    JobParseResult,
    JobRead,
    StatusUpdate,
)

router = APIRouter(
    prefix="/api/jobs",
    tags=["jobs"],
    responses={503: {"model": ErrorResponse, "description": "Database unavailable"}},
)
DatabaseSession = Annotated[Session, Depends(get_session)]
logger = logging.getLogger(__name__)


@router.post("", response_model=JobRead, status_code=201)
def submit_job(submission: JobCreate, session: DatabaseSession) -> Job:
    return create_job(session, submission)


@router.get("", response_model=list[JobRead])
def saved_jobs(session: DatabaseSession, filters: Annotated[JobFilters, Query()]) -> list[Job]:
    return list_jobs(session, filters)


@router.post("/parse", response_model=JobParseResult)
def parse_description(submission: JobParseRequest) -> JobParseResult:
    return normalize_description(submission)


@router.post(
    "/import/{provider}",
    response_model=JobParseResult,
    responses={
        status: {"model": ErrorResponse, "description": description}
        for status, description in {
            404: "Posting not found",
            502: "Invalid provider response",
            503: "Provider unavailable",
            504: "Provider timeout",
        }.items()
    },
)
async def import_posting(
    provider: Literal["greenhouse", "lever", "ashby"], submission: JobImportRequest
) -> JobParseResult:
    importer = {
        "greenhouse": import_greenhouse_job,
        "lever": import_lever_job,
        "ashby": import_ashby_job,
    }[provider]
    try:
        return await importer(submission.source_url)
    except ProviderError as error:
        logger.warning("Provider import failed (%s, %s)", provider, error.code)
        raise HTTPException(
            status_code=error.status, detail={"code": error.code, "message": str(error)}
        ) from error


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
