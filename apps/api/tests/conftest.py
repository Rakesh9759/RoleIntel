import os
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

from roleintel.config import Settings
from roleintel.database import get_session
from roleintel.main import app


@pytest.fixture
def postgres_engine() -> Iterator[Engine]:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set TEST_DATABASE_URL to run PostgreSQL persistence checks")

    settings = Settings(database_url=url)
    schema = f"test_persistence_{uuid4().hex}"
    admin = create_engine(settings.database_url, hide_parameters=True)
    engine = create_engine(
        settings.database_url,
        connect_args={"options": f"-csearch_path={schema}"},
        hide_parameters=True,
    )
    try:
        with admin.begin() as connection:
            connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        yield engine
    finally:
        engine.dispose()
        try:
            with admin.begin() as connection:
                connection.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        finally:
            admin.dispose()


@pytest.fixture
def jobs_client(postgres_engine: Engine) -> Iterator[TestClient]:
    def session_override() -> Iterator[Session]:
        with Session(postgres_engine) as session:
            yield session

    app.dependency_overrides[get_session] = session_override
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_session, None)
