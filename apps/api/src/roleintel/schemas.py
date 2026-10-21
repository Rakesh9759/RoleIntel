from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    StringConstraints,
    field_validator,
    model_validator,
)

from roleintel.models import ApplicationStatus

ShortText = Annotated[
    str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=1000)
]
Description = Annotated[
    str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=100_000)
]


class JobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    company: ShortText | None = None
    title: ShortText | None = None
    requisition_id: ShortText | None = None
    description: Description | None = None
    location: ShortText | None = None
    technologies: list[ShortText] | None = Field(default=None, max_length=100)
    experience_requirements: Description | None = None
    seniority: ShortText | None = None
    department: ShortText | None = None
    source_url: HttpUrl | None = Field(default=None, max_length=2048)

    @model_validator(mode="after")
    def validate_submission(self) -> JobCreate:
        if self.description is None and self.source_url is None:
            raise ValueError("Provide a description or source_url")
        if self.source_url is not None and (
            self.source_url.username is not None or self.source_url.password is not None
        ):
            raise ValueError("source_url must not contain credentials")
        return self


class JobParseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: Description

    @field_validator("description")
    @classmethod
    def validate_plain_text(cls, value: str) -> str:
        if any(ord(char) < 32 and char not in "\r\n\t" for char in value):
            raise ValueError("Description must be plain text without control characters")
        return value


class JobParseResult(JobCreate):
    warnings: list[str]


class GreenhouseImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_url: Annotated[
        str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=2048)
    ]


class ApplicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    job_id: UUID
    status: ApplicationStatus
    created_at: datetime
    updated_at: datetime


class JobFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=2**63 - 1)
    company: ShortText | None = None
    status: ApplicationStatus | None = None
    q: ShortText | None = None


class StatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: ApplicationStatus


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    company: str | None
    title: str | None
    requisition_id: str | None
    description: str | None
    location: str | None
    technologies: list[str] | None
    experience_requirements: str | None
    seniority: str | None
    department: str | None
    source_url: str | None
    created_at: datetime
    updated_at: datetime
    application: ApplicationRead | None


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    detail: ErrorDetail
