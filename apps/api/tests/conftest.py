import os
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine

from roleintel.config import Settings


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
