import re
from urllib.parse import urlsplit

from pydantic import HttpUrl

from roleintel.providers.common import (
    ProviderError,
    description_text,
    fetch_json,
    optional_field,
)
from roleintel.schemas import JobParseResult

HOSTS = {"boards.greenhouse.io", "job-boards.greenhouse.io"}
POSTING_PATH = re.compile(r"/([A-Za-z0-9_-]{1,100})/jobs/([1-9][0-9]{0,19})/?")
MY_POSTING_PATH = re.compile(r"/jobs/([A-Za-z0-9_-]{1,100})/([1-9][0-9]{0,19})/?")


def posting_target(source_url: str) -> tuple[str, int, str]:
    try:
        url = urlsplit(source_url)
        path = (
            MY_POSTING_PATH.fullmatch(url.path)
            if url.netloc == "my.greenhouse.io"
            else POSTING_PATH.fullmatch(url.path)
        )
        if (
            url.scheme != "https"
            or url.netloc not in HOSTS | {"my.greenhouse.io"}
            or url.fragment
            or not path
            or any(char.isspace() or ord(char) < 32 for char in source_url)
        ):
            raise ValueError("Unsupported posting URL")
    except ValueError as error:
        raise ProviderError(
            422,
            "unsupported_greenhouse_url",
            "Use a supported HTTPS boards.greenhouse.io, job-boards.greenhouse.io "
            "or my.greenhouse.io posting URL.",
        ) from error
    board, job_id = path.groups()
    if url.netloc == "my.greenhouse.io":
        return board, int(job_id), f"https://my.greenhouse.io/jobs/{board}/{job_id}"
    return board, int(job_id), f"https://{url.netloc}/{board}/jobs/{job_id}"


def provider_draft(data: object, job_id: int, source_url: str) -> JobParseResult:
    if not isinstance(data, dict) or type(data.get("id")) is not int or data["id"] != job_id:
        raise ProviderError(502, "invalid_greenhouse_response", "Invalid Greenhouse job response.")
    content = data.get("content")
    if not isinstance(content, str):
        raise ProviderError(
            502, "invalid_greenhouse_content", "Greenhouse did not supply a usable description."
        )
    description = description_text(content, html=True, encoded=True)
    warnings = [
        "Imported from Greenhouse. Review all fields before saving; missing facts stay blank."
    ]

    def field(value: object, name: str) -> str | None:
        return optional_field(value, name, warnings)

    location = data.get("location")
    if location is not None and not isinstance(location, dict):
        raise ProviderError(502, "invalid_greenhouse_response", "Invalid Greenhouse job response.")
    departments = data.get("departments")
    department = None
    if departments is not None:
        if not isinstance(departments, list) or any(
            not isinstance(item, dict) for item in departments
        ):
            raise ProviderError(
                502, "invalid_greenhouse_response", "Invalid Greenhouse job response."
            )
        names = [field(item.get("name"), "department") for item in departments]
        department = field("; ".join(dict.fromkeys(name for name in names if name)), "department")
    return JobParseResult(
        company=field(data.get("company_name"), "company"),
        title=field(data.get("title"), "title"),
        requisition_id=field(data.get("requisition_id"), "requisition_id"),
        location=field(location.get("name") if location else None, "location"),
        department=department,
        description=description,
        source_url=HttpUrl(source_url),
        warnings=warnings,
    )


async def import_greenhouse_job(source_url: str) -> JobParseResult:
    board, job_id, canonical_url = posting_target(source_url)
    data = await fetch_json(
        f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{job_id}", "Greenhouse"
    )
    return provider_draft(data, job_id, canonical_url)
