import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from roleintel.config import Settings
from roleintel.models import Application, ApplicationStatus, Job


@pytest.mark.integration
def test_postgres_migration_round_trip() -> None:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set TEST_DATABASE_URL to run PostgreSQL migration checks")

    settings = Settings(database_url=url)
    engine = create_engine(settings.database_url, hide_parameters=True)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    schema = f"test_migrations_{uuid4().hex}"

    try:
        with engine.connect() as connection, connection.begin():
            connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
            connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
            config.attributes["connection"] = connection

            command.upgrade(config, "head")
            assert {"jobs", "applications"} <= set(inspect(connection).get_table_names())
            command.check(config)

            with Session(connection, join_transaction_mode="create_savepoint") as session:
                job = Job(description="User-provided job description")
                application = Application()
                job.application = application
                session.add(job)
                session.commit()
                assert application.status is ApplicationStatus.INTERESTED
                assert job.company is None
                assert job.created_at.tzinfo is not None

            job_id = uuid4()
            connection.execute(text("INSERT INTO jobs (id) VALUES (:id)"), {"id": job_id})
            status = connection.execute(
                text(
                    "INSERT INTO applications (id, job_id) VALUES (:id, :job_id) RETURNING status"
                ),
                {"id": uuid4(), "job_id": job_id},
            ).scalar_one()
            assert status == ApplicationStatus.INTERESTED.value

            foreign_keys = inspect(connection).get_foreign_keys("applications")
            assert foreign_keys[0]["referred_table"] == "jobs"
            assert foreign_keys[0].get("options", {}).get("ondelete") == "CASCADE"
            assert inspect(connection).get_unique_constraints("applications")[0][
                "column_names"
            ] == ["job_id"]
            checks = inspect(connection).get_check_constraints("applications")
            assert len(checks) == 1
            for status in ApplicationStatus:
                assert status.value in checks[0]["sqltext"]

            command.downgrade(config, "base")
            assert set(inspect(connection).get_table_names()) == {"alembic_version"}
            command.upgrade(config, "head")
            command.check(config)
            command.downgrade(config, "base")

            connection.exec_driver_sql("SET LOCAL search_path TO public")
            connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
    finally:
        engine.dispose()
