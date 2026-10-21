import asyncio
import json
from html import unescape
from html.parser import HTMLParser

import httpx2
from pydantic import ValidationError

from roleintel.parsing import normalize_description
from roleintel.schemas import JobParseRequest

MAX_RESPONSE_BYTES = 1_000_000
IMPORT_DEADLINE_SECONDS = 6
UUID_PATTERN = r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"


class ProviderError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


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


def description_text(content: str, *, html: bool = False, encoded: bool = False) -> str:
    if html:
        parser = DescriptionText()
        parser.feed(unescape(content) if encoded else content)
        parser.close()
        content = "".join(parser.parts)
    if (
        not content.strip()
        or len(content) > 100_000
        or any(ord(char) < 32 and char not in "\r\n\t" for char in content)
    ):
        raise ProviderError(
            502,
            "invalid_provider_content",
            "Provider description is empty, too large or invalid. Paste it manually instead.",
        )
    try:
        normalized = normalize_description(JobParseRequest(description=content)).description
    except ValidationError as error:
        raise ProviderError(
            502, "invalid_provider_content", "Provider description is invalid."
        ) from error
    assert normalized is not None
    return normalized


def optional_field(value: object, name: str, warnings: list[str]) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ProviderError(502, "invalid_provider_response", "Invalid provider job response.")
    value = value.strip()
    if not value:
        return None
    if len(value) > 1000 or any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF for char in value):
        warnings.append(f"{name}: unusable provider value; review manually.")
        return None
    return value


async def fetch_json(endpoint: str, provider: str) -> object:
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
                raise ProviderError(
                    404, "provider_job_not_found", f"{provider} posting was not found or is closed."
                )
            if response.status_code == 429 or response.status_code >= 500:
                raise ProviderError(
                    503, "provider_unavailable", f"{provider} is unavailable. Try again later."
                )
            if response.status_code != 200:
                raise ProviderError(
                    502, "invalid_provider_response", f"{provider} returned an unexpected response."
                )
            if response.headers.get("content-type", "").split(";")[0].strip() != "application/json":
                raise ProviderError(
                    502, "invalid_provider_response", f"{provider} did not return JSON."
                )
            if response.headers.get("content-encoding", "identity") != "identity":
                raise ProviderError(
                    502, "invalid_provider_response", f"{provider} returned unsupported encoding."
                )
            body = bytearray()
            async for chunk in response.aiter_bytes(chunk_size=16_384):
                body.extend(chunk)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise ProviderError(
                        502, "provider_response_too_large", f"{provider} response is too large."
                    )
            data: object = json.loads(body)
            return data
    except (TimeoutError, httpx2.TimeoutException) as error:
        raise ProviderError(
            504, "provider_timeout", f"{provider} request timed out. Try again or paste manually."
        ) from error
    except (httpx2.HTTPError, ValueError, RecursionError) as error:
        raise ProviderError(
            502, "invalid_provider_response", f"{provider} could not return a usable job."
        ) from error
