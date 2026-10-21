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


def posting_target(source_url: str) -> tuple[str, str]:
    try:
        url = urlsplit(source_url)
        path = POSTING_PATH.fullmatch(url.path)
        if (
            url.scheme != "https"
            or url.netloc != "jobs.ashbyhq.com"
            or url.fragment
            or not path
            or any(char.isspace() or ord(char) < 32 for char in source_url)
        ):
            raise ValueError("Unsupported posting URL")
    except ValueError as error:
        raise ProviderError(
            422, "unsupported_ashby_url", "Use an HTTPS jobs.ashbyhq.com /company/posting-uuid URL."
        ) from error
    board, job_id = path.groups()
    return board, f"https://jobs.ashbyhq.com/{board}/{job_id.lower()}"


def provider_draft(data: object, source_url: str) -> JobParseResult:
    if not isinstance(data, dict) or not isinstance(data.get("jobs"), list):
        raise ProviderError(502, "invalid_ashby_response", "Invalid Ashby board response.")
    matches: list[dict[str, object]] = []
    for item in data["jobs"]:
        if not isinstance(item, dict):
            raise ProviderError(502, "invalid_ashby_response", "Invalid Ashby job response.")
        link = item.get("jobUrl")
        if not isinstance(link, str):
            raise ProviderError(502, "invalid_ashby_response", "Invalid Ashby job link.")
        try:
            _, canonical_url = posting_target(link)
        except ProviderError as error:
            raise ProviderError(502, "invalid_ashby_response", "Invalid Ashby job link.") from error
        if canonical_url == source_url:
            matches.append(item)
    if not matches or (len(matches) == 1 and matches[0].get("isListed") is False):
        raise ProviderError(
            404, "ashby_job_not_found", "Ashby posting was not found or is unlisted."
        )
    if len(matches) != 1 or matches[0].get("isListed") is not True:
        raise ProviderError(502, "invalid_ashby_response", "Invalid Ashby listing status.")
    job = matches[0]
    warnings = ["Imported from Ashby. Review all fields; company name is not supplied by this API."]

    def field(value: object, name: str) -> str | None:
        return optional_field(value, name, warnings)

    plain = job.get("descriptionPlain")
    if plain is not None and not isinstance(plain, str):
        raise ProviderError(502, "invalid_ashby_response", "Invalid Ashby description.")
    if isinstance(plain, str) and plain.strip():
        description = description_text(plain)
    else:
        html = job.get("descriptionHtml")
        if not isinstance(html, str):
            raise ProviderError(502, "invalid_ashby_response", "Missing Ashby description.")
        description = description_text(html, html=True)
    department = field(job.get("department"), "department")
    team = field(job.get("team"), "team")
    return JobParseResult(
        title=field(job.get("title"), "title"),
        location=field(job.get("location"), "location"),
        department=field(
            "; ".join(dict.fromkeys(x for x in [department, team] if x)), "department"
        ),
        description=description,
        source_url=HttpUrl(source_url),
        warnings=warnings,
    )


async def import_ashby_job(source_url: str) -> JobParseResult:
    board, canonical_url = posting_target(source_url)
    data = await fetch_json(f"https://api.ashbyhq.com/posting-api/job-board/{board}", "Ashby")
    return provider_draft(data, canonical_url)
