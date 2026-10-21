import logging
from collections.abc import Iterator
from functools import lru_cache

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

from roleintel.config import Settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    try:
        settings = Settings()
    except ValidationError:
        logger.error("Database configuration is missing or invalid")
        raise HTTPException(
            status_code=503,
            detail={"code": "database_unavailable", "message": "Database is unavailable"},
        ) from None
    return create_engine(
        settings.database_url,
        pool_pre_ping=True,
        hide_parameters=True,
        connect_args={"connect_timeout": 5},
    )


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session


def dispose_engine() -> None:
    if get_engine.cache_info().currsize:
        get_engine().dispose()
        get_engine.cache_clear()
