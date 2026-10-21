import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from roleintel.database import dispose_engine
from roleintel.routes import router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    try:
        yield
    finally:
        dispose_engine()


app = FastAPI(
    title="RoleIntel API",
    description="API foundation for the RoleIntel platform.",
    version="0.1.0",
    lifespan=lifespan,
)
app.include_router(router)


@app.exception_handler(SQLAlchemyError)
async def database_error(_request: Request, error: SQLAlchemyError) -> JSONResponse:
    logger.error("Database operation failed (%s)", type(error).__name__)
    return JSONResponse(
        status_code=503,
        content={"detail": {"code": "database_unavailable", "message": "Database is unavailable"}},
    )


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, error: RequestValidationError) -> JSONResponse:
    errors = [
        {"loc": item["loc"], "msg": item["msg"], "type": item["type"]} for item in error.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": errors})


@app.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}
