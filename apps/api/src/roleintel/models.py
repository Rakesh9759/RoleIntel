from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import ARRAY, DateTime, Enum, ForeignKey, MetaData, String, Text, Uuid, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(table_name)s_%(column_0_name)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


class ApplicationStatus(StrEnum):
    INTERESTED = "interested"
    PLANNING_TO_APPLY = "planning_to_apply"
    APPLIED = "applied"
    REFERRAL_REQUESTED = "referral_requested"
    INTERVIEWING = "interviewing"
    OFFER = "offer"
    REJECTED = "rejected"


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    company: Mapped[str | None] = mapped_column(Text, index=True)
    title: Mapped[str | None] = mapped_column(Text)
    requisition_id: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    technologies: Mapped[list[str] | None] = mapped_column(ARRAY(String))
    experience_requirements: Mapped[str | None] = mapped_column(Text)
    seniority: Mapped[str | None] = mapped_column(Text)
    department: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    application: Mapped[Application | None] = relationship(
        back_populates="job", cascade="all, delete-orphan", passive_deletes=True
    )


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    job_id: Mapped[UUID] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), unique=True)
    status: Mapped[ApplicationStatus] = mapped_column(
        Enum(
            ApplicationStatus,
            name="application_status",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=lambda statuses: [status.value for status in statuses],
        ),
        default=ApplicationStatus.INTERESTED,
        server_default=ApplicationStatus.INTERESTED.value,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    job: Mapped[Job] = relationship(back_populates="application")
