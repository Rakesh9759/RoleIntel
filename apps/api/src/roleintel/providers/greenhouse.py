import asyncio
import json
import re
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlsplit

import httpx2
from pydantic import HttpUrl, ValidationError

from roleintel.parsing import normalize_description
from roleintel.schemas import JobParseRequest, JobParseResult

MAX_RESPONSE_BYTES = 1_000_000
IMPORT_DEADLINE_SECONDS = 6
HOSTS = {"boards.greenhouse.io", "job-boards.greenhouse.io"}
POSTING_PATH = re.compile(r"/([A-Za-z0-9_-]{1,100})/jobs/([1-9][0-9]{0,19})/?")
MY_POSTING_PATH = re.compile(r"/jobs/([A-Za-z0-9_-]{1,100})/([1-9][0-9]{0,19})/?")


class GreenhouseError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


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
        raise GreenhouseError(
            422,
            "unsupported_greenhouse_url",
            "Use a supported HTTPS boards.greenhouse.io, job-boards.greenhouse.io "
            "or my.greenhouse.io posting URL.",
        ) from error
    board, job_id = path.groups()
    if url.netloc == "my.greenhouse.io":
        return board, int(job_id), f"https://my.greenhouse.io/jobs/{board}/{job_id}"
    return board, int(job_id), f"https://{url.netloc}/{board}/jobs/{job_id}"


class DescriptionText(HTMLParser):
    BLOCKS = {
        "address",
        "article",
        "blockquote",
        "br",
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "hr",
        "li",
        "ol",
        "p",
        "pre",
        "section",
        "table",
        "tr",
        "ul",
    }
    HIDDEN = {"script", "style", "template", "noscript"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden: list[str] = []

    def handle_starttag(self, tag: str, _attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.HIDDEN:
            self.hidden.append(tag)
        elif not self.hidden and tag in self.BLOCKS:
            self.parts.append("\n\n" if tag != "br" else "\n")
        elif not self.hidden and tag in {"td", "th"}:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if self.hidden:
            if tag == self.hidden[-1]:
                self.hidden.pop()
        elif tag in self.BLOCKS:
            self.parts.append("\n\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


def provider_draft(data: object, job_id: int, source_url: str) -> JobParseResult:
    if not isinstance(data, dict) or type(data.get("id")) is not int or data["id"] != job_id:
        raise GreenhouseError(
            502, "invalid_greenhouse_response", "Invalid Greenhouse job response."
        )
    content = data.get("content")
    if not isinstance(content, str):
        raise GreenhouseError(
            502, "invalid_greenhouse_content", "Greenhouse did not supply a usable description."
        )
    parser = DescriptionText()
    # Greenhouse descriptions may contain entity-encoded editor markup.
    parser.feed(unescape(content))
    parser.close()
    text = "".join(parser.parts)
    if (
        not text.strip()
        or len(text) > 100_000
        or any(ord(char) < 32 and char not in "\r\n\t" for char in text)
    ):
        raise GreenhouseError(
            502,
            "invalid_greenhouse_content",
            "Greenhouse description is empty, too large or invalid. Paste it manually instead.",
        )
    normalized = normalize_description(JobParseRequest(description=text))
    warnings = [
        "Imported from Greenhouse. Review all fields before saving; missing facts stay blank."
    ]

    def field(value: object, name: str) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise GreenhouseError(
                502, "invalid_greenhouse_response", "Invalid Greenhouse job response."
            )
        value = value.strip()
        if not value:
            return None
        if len(value) > 1000 or any(ord(char) < 32 for char in value):
            warnings.append(f"{name}: unusable provider value; review manually.")
            return None
        return value

    location = data.get("location")
    if location is not None and not isinstance(location, dict):
        raise GreenhouseError(
            502, "invalid_greenhouse_response", "Invalid Greenhouse job response."
        )
    departments = data.get("departments")
    department = None
    if departments is not None:
        if not isinstance(departments, list) or any(
            not isinstance(item, dict) for item in departments
        ):
            raise GreenhouseError(
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
        description=normalized.description,
        source_url=HttpUrl(source_url),
        warnings=warnings,
    )


async def import_greenhouse_job(source_url: str) -> JobParseResult:
    board, job_id, canonical_url = posting_target(source_url)
    endpoint = f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{job_id}"
    try:
        async with (
            asyncio.timeout(IMPORT_DEADLINE_SECONDS),
            httpx2.AsyncClient(timeout=5, follow_redirects=False, trust_env=False) as client,
            client.stream(
                "GET",
                endpoint,
                headers={"Accept": "application/json", "Accept-Encoding": "identity"},
            ) as response,
        ):
            if response.status_code == 404:
                raise GreenhouseError(
                    404,
                    "greenhouse_job_not_found",
                    "Greenhouse posting was not found or is closed.",
                )
            if response.status_code == 429 or response.status_code >= 500:
                raise GreenhouseError(
                    503, "greenhouse_unavailable", "Greenhouse is unavailable. Try again later."
                )
            if response.status_code != 200:
                raise GreenhouseError(
                    502,
                    "invalid_greenhouse_response",
                    "Greenhouse returned an unexpected response.",
                )
            if response.headers.get("content-type", "").split(";")[0].strip() != "application/json":
                raise GreenhouseError(
                    502, "invalid_greenhouse_response", "Greenhouse did not return JSON."
                )
            if response.headers.get("content-encoding", "identity") != "identity":
                raise GreenhouseError(
                    502, "invalid_greenhouse_response", "Greenhouse returned unsupported encoding."
                )
            body = bytearray()
            async for chunk in response.aiter_bytes(chunk_size=16_384):
                body.extend(chunk)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise GreenhouseError(
                        502, "greenhouse_response_too_large", "Greenhouse response is too large."
                    )
            data: object = json.loads(body)
        return provider_draft(data, job_id, canonical_url)
    except (TimeoutError, httpx2.TimeoutException) as error:
        raise GreenhouseError(
            504, "greenhouse_timeout", "Greenhouse request timed out. Try again or paste manually."
        ) from error
    except (
        httpx2.HTTPError,
        json.JSONDecodeError,
        UnicodeDecodeError,
        RecursionError,
        ValidationError,
    ) as error:
        raise GreenhouseError(
            502, "invalid_greenhouse_response", "Greenhouse could not return a usable job."
        ) from error
