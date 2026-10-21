import re
from urllib.parse import urlsplit

from pydantic import HttpUrl

from roleintel.providers.common import (
    UUID_PATTERN,
    ProviderError,
    description_text,
    fetch_json,
    optional_field,
)
from roleintel.schemas import JobParseResult

POSTING_PATH = re.compile(rf"/([A-Za-z0-9_-]{{1,100}})/({UUID_PATTERN})/?")
API_HOSTS = {"jobs.lever.co": "api.lever.co", "jobs.eu.lever.co": "api.eu.lever.co"}


def posting_target(source_url: str) -> tuple[str, str, str]:
    try:
        url = urlsplit(source_url)
        path = POSTING_PATH.fullmatch(url.path)
        if (
            url.scheme != "https"
            or url.netloc not in API_HOSTS
            or url.fragment
            or not path
            or any(char.isspace() or ord(char) < 32 for char in source_url)
        ):
            raise ValueError("Unsupported posting URL")
    except ValueError as error:
        raise ProviderError(
            422,
            "unsupported_lever_url",
            "Use an HTTPS jobs.lever.co or jobs.eu.lever.co /company/posting-uuid URL.",
        ) from error
    board, job_id = path.groups()
    job_id = job_id.lower()
    return (
        f"https://{API_HOSTS[url.netloc]}/v0/postings/{board}/{job_id}",
        job_id,
        f"https://{url.netloc}/{board}/{job_id}",
    )


def provider_draft(data: object, job_id: str, source_url: str) -> JobParseResult:
    if not isinstance(data, dict) or data.get("id") != job_id:
        raise ProviderError(502, "invalid_lever_response", "Invalid Lever job response.")
    warnings = ["Imported from Lever. Review all fields; company name is not supplied by this API."]

    def field(value: object, name: str) -> str | None:
        return optional_field(value, name, warnings)

    def content(plain: str, html: str) -> str:
        value = data.get(plain)
        if value is not None and not isinstance(value, str):
            raise ProviderError(502, "invalid_lever_response", "Invalid Lever description.")
        if isinstance(value, str) and value.strip():
            return value
        value = data.get(html)
        if value is None or value == "":
            return ""
        if not isinstance(value, str):
            raise ProviderError(502, "invalid_lever_response", "Invalid Lever description.")
        return description_text(value, html=True)

    sections = [content("descriptionPlain", "description")]
    lists = data.get("lists")
    if lists is not None:
        if not isinstance(lists, list) or any(not isinstance(item, dict) for item in lists):
            raise ProviderError(502, "invalid_lever_response", "Invalid Lever description lists.")
        for item in lists:
            heading, body = item.get("text"), item.get("content")
            if not isinstance(heading, str) or not isinstance(body, str):
                raise ProviderError(
                    502, "invalid_lever_response", "Invalid Lever description lists."
                )
            sections.extend([heading, description_text(body, html=True) if body.strip() else ""])
    sections.extend(
        [
            content("additionalPlain", "additional"),
            content("salaryDescriptionPlain", "salaryDescription"),
        ]
    )
    categories = data.get("categories")
    if categories is None:
        categories = {}
    if not isinstance(categories, dict):
        raise ProviderError(502, "invalid_lever_response", "Invalid Lever categories.")
    department = field(categories.get("department"), "department")
    team = field(categories.get("team"), "team")
    return JobParseResult(
        title=field(data.get("text"), "title"),
        location=field(categories.get("location"), "location"),
        department=field(
            "; ".join(dict.fromkeys(x for x in [department, team] if x)), "department"
        ),
        description=description_text("\n\n".join(x for x in sections if x.strip())),
        source_url=HttpUrl(source_url),
        warnings=warnings,
    )


async def import_lever_job(source_url: str) -> JobParseResult:
    endpoint, job_id, canonical_url = posting_target(source_url)
    return provider_draft(await fetch_json(endpoint, "Lever"), job_id, canonical_url)
