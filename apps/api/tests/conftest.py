import os
from collections.abc import Callable, Iterator
from pathlib import Path
from uuid import uuid4

import httpx2
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

from roleintel.config import Settings
from roleintel.database import get_session
from roleintel.main import app
from roleintel.providers import common


@pytest.fixture
def transport(monkeypatch: pytest.MonkeyPatch) -> Callable[[httpx2.Response], list[httpx2.Request]]:
    original = httpx2.AsyncClient

    def configure(response: httpx2.Response) -> list[httpx2.Request]:
        calls: list[httpx2.Request] = []

        def handler(request: httpx2.Request) -> httpx2.Response:
            calls.append(request)
            return response

        def factory(
            *, timeout: float, follow_redirects: bool, trust_env: bool
        ) -> httpx2.AsyncClient:
            assert timeout == 5 and not follow_redirects and not trust_env
            return original(
                transport=httpx2.MockTransport(handler),
                timeout=timeout,
                follow_redirects=follow_redirects,
                trust_env=trust_env,
            )

        monkeypatch.setattr(common.httpx2, "AsyncClient", factory)
        return calls

    return configure


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
