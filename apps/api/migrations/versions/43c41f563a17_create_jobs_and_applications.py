"""create jobs and applications

Revision ID: 43c41f563a17
Revises:
Create Date: 2026-10-21 15:34:51.302187

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "43c41f563a17"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("company", sa.Text(), nullable=True),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("requisition_id", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("technologies", sa.ARRAY(sa.String()), nullable=True),
        sa.Column("experience_requirements", sa.Text(), nullable=True),
        sa.Column("seniority", sa.Text(), nullable=True),
        sa.Column("department", sa.Text(), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_jobs")),
    )
    op.create_index(op.f("ix_jobs_company"), "jobs", ["company"], unique=False)
    op.create_table(
        "applications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "interested",
                "planning_to_apply",
                "applied",
                "referral_requested",
                "interviewing",
                "offer",
                "rejected",
                name="application_status",
                native_enum=False,
                create_constraint=True,
            ),
            server_default="interested",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["job_id"], ["jobs.id"], name=op.f("fk_applications_job_id_jobs"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_applications")),
        sa.UniqueConstraint("job_id", name=op.f("uq_applications_job_id")),
    )
    op.create_index(op.f("ix_applications_status"), "applications", ["status"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_applications_status"), table_name="applications")
    op.drop_table("applications")
    op.drop_index(op.f("ix_jobs_company"), table_name="jobs")
    op.drop_table("jobs")
