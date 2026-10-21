from pathlib import Path

import pytest
from pydantic import ValidationError

from roleintel.config import Settings


def test_database_url_is_required(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)

    with pytest.raises(ValidationError, match="database_url"):
        Settings()


def test_database_url_comes_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    url = "postgresql+psycopg://user:password@localhost/roleintel"
    monkeypatch.setenv("DATABASE_URL", url)

    settings = Settings()

    assert settings.database_url == url
    assert "password" not in repr(settings)


def test_dotenv_configuration_and_environment_override(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    file_url = "postgresql+psycopg://user:file_password@localhost/from_file"
    (tmp_path / ".env").write_text(
        f"DATABASE_URL={file_url}\nPOSTGRES_DB=from_file\n", encoding="utf-8"
    )
    assert Settings().database_url == file_url

    env_url = "postgresql+psycopg://user:env_password@localhost/from_environment"
    monkeypatch.setenv("DATABASE_URL", env_url)
    assert Settings().database_url == env_url


@pytest.mark.parametrize(
    "url",
    [
        "not-a-url-with-secret",
        "sqlite:///roleintel.db",
        "postgresql://user:secret@localhost/roleintel",
        "postgresql+psycopg://user:secret@localhost",
        "postgresql+psycopg://user:secret@localhost:secret/database",
    ],
)
def test_invalid_database_url_is_rejected_without_exposing_input(
    monkeypatch: pytest.MonkeyPatch, url: str
) -> None:
    monkeypatch.setenv("DATABASE_URL", url)

    with pytest.raises(ValidationError) as error:
        Settings()

    assert url not in str(error.value)
    assert "secret" not in str(error.value)
