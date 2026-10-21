import asyncio
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from unittest.mock import patch

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from roleintel.main import app
from roleintel.models import Application, Job
from roleintel.providers import common, greenhouse

URL = "https://job-boards.greenhouse.io/disposable-fixture/jobs/123"
PAYLOAD = {
    "id": 123,
    "title": "Fixture role",
    "company_name": "Explicit fixture company",
    "requisition_id": "REQ-TEST",
    "location": {"name": "Remote"},
    "departments": [{"name": "Platform"}, {"name": "Platform"}, {"name": "Testing"}],
    "content": "<p>First &amp; second.</p><p>Next<br>line.</p><script>hidden()</script>",
    "absolute_url": "http://127.0.0.1/must-not-be-fetched",
}


def test_public_api_import_maps_only_provider_fields_without_database(
    transport: Callable[[httpx2.Response], list[httpx2.Request]],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    calls = transport(httpx2.Response(200, json=PAYLOAD))
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with (
        TestClient(app) as client,
        patch("roleintel.database.create_engine", side_effect=AssertionError("Database accessed")),
    ):
        response = client.post(
            "/api/jobs/import/greenhouse", json={"source_url": URL + "?gh_src=discard"}
        )
    assert response.status_code == 200
    draft = response.json()
    assert draft["company"] == "Explicit fixture company"
    assert draft["title"] == "Fixture role"
    assert draft["requisition_id"] == "REQ-TEST"
    assert draft["location"] == "Remote"
    assert draft["department"] == "Platform; Testing"
    assert draft["description"] == "First & second.\n\nNext\nline."
    assert draft["source_url"] == URL
    assert all(
        draft[field] is None for field in ["technologies", "experience_requirements", "seniority"]
    )
    assert "application" not in draft and "id" not in draft
    assert len(calls) == 1
    assert str(calls[0].url) == (
        "https://boards-api.greenhouse.io/v1/boards/disposable-fixture/jobs/123"
    )
    assert calls[0].method == "GET"
    assert calls[0].headers["accept-encoding"] == "identity"
    assert not {"authorization", "cookie"} & set(calls[0].headers)


@pytest.mark.parametrize(
    "url",
    [
        "http://boards.greenhouse.io/company/jobs/123",
        "https://job-boards.greenhouse.io.evil.test/company/jobs/123",
        "https://evil.test/company/jobs/123",
        "https://127.0.0.1/company/jobs/123",
        "https://user:password@boards.greenhouse.io/company/jobs/123",
        "https://boards.greenhouse.io:443/company/jobs/123",
        "https://boards.greenhouse.io/company/jobs/123#fragment",
        "https://boards.greenhouse.io/company/jobs/%31%32%33",
        "https://boards.greenhouse.io/company/../jobs/123",
        "https://boards.greenhouse.io/company/jobs/0",
        "https://boards.greenhouse.io/company/jobs/" + "1" * 21,
        "https://boards.greenhouse.io/embed/job_app?for=company&token=123",
        "https://boards.greenhouse.io/company/jobs/123/extra",
        "https://boards.greenhouse.io\\@evil.test/company/jobs/123",
        "https://boards.greenhouse.io/\ncompany/jobs/123",
        "https://boards.greenhouse.io/" + "a" * 101 + "/jobs/123",
        "https://my.greenhouse.io.evil.test/jobs/company/123",
        "https://my.greenhouse.io/company/jobs/123",
        "https://my.greenhouse.io/jobs/company/123/extra",
        "http://my.greenhouse.io/jobs/company/123",
        "https://my.greenhouse.io:443/jobs/company/123",
        "https://my.greenhouse.io/jobs/company/%31",
    ],
)
def test_unsupported_urls_never_contact_network(url: str) -> None:
    with (
        TestClient(app) as client,
        patch.object(common.httpx2, "AsyncClient", side_effect=AssertionError("Network accessed")),
    ):
        response = client.post("/api/jobs/import/greenhouse", json={"source_url": url})
    assert response.status_code == 422
    assert url not in response.text


@pytest.mark.parametrize("host", ["boards.greenhouse.io", "job-boards.greenhouse.io"])
def test_supported_url_canonicalization(host: str) -> None:
    assert greenhouse.posting_target(f"https://{host}/fixture_1-test/jobs/42/?gh_src=tracking") == (
        "fixture_1-test",
        42,
        f"https://{host}/fixture_1-test/jobs/42",
    )


def test_my_greenhouse_maps_to_same_fixed_api_without_fetching_input_host(
    transport: Callable[[httpx2.Response], list[httpx2.Request]],
) -> None:
    calls = transport(httpx2.Response(200, json=PAYLOAD))
    source = "https://my.greenhouse.io/jobs/disposable-fixture/123"
    with TestClient(app) as client:
        response = client.post(
            "/api/jobs/import/greenhouse", json={"source_url": source + "/?tracking=discard"}
        )
    assert response.status_code == 200
    assert response.json()["source_url"] == source
    assert len(calls) == 1
    assert str(calls[0].url) == (
        "https://boards-api.greenhouse.io/v1/boards/disposable-fixture/jobs/123"
    )


@pytest.mark.parametrize(
    "content",
    [
        "<p>Paragraph &amp; text</p><ul><li>One</li><li>Two</li></ul>",
        "&lt;p&gt;Paragraph &amp;amp; text&lt;/p&gt;&lt;ul&gt;"
        "&lt;li&gt;One&lt;/li&gt;&lt;li&gt;Two&lt;/li&gt;&lt;/ul&gt;",
    ],
)
def test_html_and_encoded_markup_preserve_paragraphs(content: str) -> None:
    draft = greenhouse.provider_draft({**PAYLOAD, "content": content}, 123, URL)
    assert draft.description == "Paragraph & text\n\nOne\n\nTwo"


def test_missing_fields_are_null_and_prose_labels_do_not_infer_provider_fields() -> None:
    draft = greenhouse.provider_draft(
        {"id": 123, "content": "<p>Company: Unverified prose</p><p>Technologies: Python</p>"},
        123,
        URL,
    )
    assert draft.company is None
    assert draft.requisition_id is None
    assert draft.technologies is None
    assert draft.title is None
    assert draft.department is None
    assert draft.description == "Company: Unverified prose\n\nTechnologies: Python"


def test_description_limit_is_not_truncated() -> None:
    draft = greenhouse.provider_draft({**PAYLOAD, "content": "x" * 100_000}, 123, URL)
    assert draft.description == "x" * 100_000


def test_oversized_optional_fields_warn_without_truncation() -> None:
    draft = greenhouse.provider_draft({**PAYLOAD, "title": "x" * 1001}, 123, URL)
    assert draft.title is None
    assert any("title" in warning for warning in draft.warnings)


@pytest.mark.parametrize(
    "data",
    [
        None,
        [],
        {},
        {**PAYLOAD, "id": 124},
        {**PAYLOAD, "id": "123"},
        {**PAYLOAD, "id": True},
        {**PAYLOAD, "content": None},
        {**PAYLOAD, "content": "<script>hidden()</script>"},
        {**PAYLOAD, "content": "x" * 100_001},
        {**PAYLOAD, "content": "private\x00text"},
        {**PAYLOAD, "title": 42},
        {**PAYLOAD, "location": []},
        {**PAYLOAD, "departments": ["Bad"]},
    ],
)
def test_invalid_provider_data_is_explicit(data: object) -> None:
    with pytest.raises(common.ProviderError) as error:
        greenhouse.provider_draft(data, 123, URL)
    assert error.value.status == 502


@pytest.mark.parametrize(
    ("upstream", "expected"),
    [(301, 502), (302, 502), (401, 502), (404, 404), (429, 503), (500, 503)],
)
def test_provider_status_errors_are_redacted_and_redirects_not_followed(
    transport: Callable[[httpx2.Response], list[httpx2.Request]], upstream: int, expected: int
) -> None:
    calls = transport(
        httpx2.Response(
            upstream, text="private provider response", headers={"location": "http://127.0.0.1"}
        )
    )
    with TestClient(app) as client:
        response = client.post("/api/jobs/import/greenhouse", json={"source_url": URL})
    assert response.status_code == expected
    assert "private provider" not in response.text
    assert len(calls) == 1


@pytest.mark.parametrize(
    "response",
    [
        httpx2.Response(200, text="not JSON"),
        httpx2.Response(200, content=b"{", headers={"content-type": "application/json"}),
        httpx2.Response(200, json={"private": "invalid payload"}),
        httpx2.Response(
            200,
            content=b'{"id":123,"content":"\\ud800"}',
            headers={"content-type": "application/json"},
        ),
        httpx2.Response(
            200, content=b"x" * 1_000_001, headers={"content-type": "application/json"}
        ),
    ],
)
def test_invalid_or_oversized_responses_return_502(
    transport: Callable[[httpx2.Response], list[httpx2.Request]], response: httpx2.Response
) -> None:
    transport(response)
    with TestClient(app) as client:
        result = client.post("/api/jobs/import/greenhouse", json={"source_url": URL})
    assert result.status_code == 502
    assert "private" not in result.text


def test_response_size_limit_is_inclusive(
    transport: Callable[[httpx2.Response], list[httpx2.Request]],
) -> None:
    import json

    content = json.dumps(PAYLOAD).encode()
    body = content + b" " * (common.MAX_RESPONSE_BYTES - len(content))
    transport(httpx2.Response(200, content=body, headers={"content-type": "application/json"}))
    with TestClient(app) as client:
        result = client.post("/api/jobs/import/greenhouse", json={"source_url": URL})
    assert result.status_code == 200


@pytest.mark.parametrize(
    ("body", "headers"),
    [
        (b"[" * 2000 + b"]" * 2000, {"content-type": "application/json"}),
        (b"not accessed", {"content-type": "application/json", "content-encoding": "br"}),
    ],
)
def test_nested_json_and_compressed_responses_fail_explicitly(
    transport: Callable[[httpx2.Response], list[httpx2.Request]],
    body: bytes,
    headers: dict[str, str],
) -> None:
    # Streaming prevents the mock response from decoding before the adapter checks headers.
    transport(httpx2.Response(200, stream=httpx2.ByteStream(body), headers=headers))
    with TestClient(app) as client:
        result = client.post("/api/jobs/import/greenhouse", json={"source_url": URL})
    assert result.status_code == 502


class SlowStream(httpx2.AsyncByteStream):
    async def __aiter__(self) -> AsyncIterator[bytes]:
        await asyncio.sleep(1)
        yield b"{}"


def test_total_deadline_caps_slow_response(
    transport: Callable[[httpx2.Response], list[httpx2.Request]], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(common, "IMPORT_DEADLINE_SECONDS", 0.01)
    transport(
        httpx2.Response(200, stream=SlowStream(), headers={"content-type": "application/json"})
    )
    with TestClient(app) as client:
        result = client.post("/api/jobs/import/greenhouse", json={"source_url": URL})
    assert result.status_code == 504


@pytest.mark.parametrize("error", [httpx2.ReadTimeout("private"), httpx2.ConnectError("private")])
def test_transport_errors_are_redacted(error: httpx2.HTTPError) -> None:
    with (
        TestClient(app) as client,
        patch.object(common.httpx2.AsyncClient, "__aenter__", side_effect=error),
    ):
        result = client.post("/api/jobs/import/greenhouse", json={"source_url": URL})
    assert result.status_code == (504 if isinstance(error, httpx2.TimeoutException) else 502)
    assert "private" not in result.text


@pytest.mark.parametrize(
    "payload", [{}, {"source_url": 12}, {"source_url": ""}, {"source_url": URL, "extra": True}]
)
def test_request_contract_rejects_invalid_payload(payload: dict[str, object]) -> None:
    with TestClient(app) as client:
        response = client.post("/api/jobs/import/greenhouse", json=payload)
    assert response.status_code == 422
    assert all("input" not in item for item in response.json()["detail"])


@pytest.mark.integration
def test_import_writes_only_after_reviewed_save(
    transport: Callable[[httpx2.Response], list[httpx2.Request]],
    jobs_client: TestClient,
    postgres_engine: Engine,
) -> None:
    transport(httpx2.Response(200, json=PAYLOAD))
    response = jobs_client.post("/api/jobs/import/greenhouse", json={"source_url": URL})
    assert response.status_code == 200
    with Session(postgres_engine) as session:
        assert session.scalar(select(func.count()).select_from(Job)) == 0
        assert session.scalar(select(func.count()).select_from(Application)) == 0
    draft = response.json()
    draft.pop("warnings")
    draft["title"] = "Reviewed provider fixture"
    saved = jobs_client.post("/api/jobs", json=draft)
    assert saved.status_code == 201
    detail = jobs_client.get(f"/api/jobs/{saved.json()['id']}").json()
    assert detail["title"] == "Reviewed provider fixture"
    assert detail["source_url"] == URL
    assert detail["application"]["status"] == "interested"
