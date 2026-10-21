from collections.abc import Callable
from pathlib import Path
from unittest.mock import patch

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from roleintel.main import app
from roleintel.models import Application, Job
from roleintel.providers import ashby, common, lever

ID = "11111111-2222-3333-4444-555555555555"
LEVER_URL = f"https://jobs.lever.co/fixture/{ID}"
ASHBY_URL = f"https://jobs.ashbyhq.com/fixture/{ID}"
LEVER = {
    "id": ID,
    "text": "Fixture role",
    "categories": {"location": "Remote", "department": "Engineering", "team": "Platform"},
    "descriptionPlain": "Opening.\n\nBody.",
    "openingPlain": "Opening.",
    "descriptionBodyPlain": "Body.",
    "lists": [{"text": "Requirements", "content": "<ul><li>Supplied requirement</li></ul>"}],
    "additionalPlain": "Closing.",
    "salaryDescriptionPlain": "Supplied salary note.",
    "hostedUrl": "http://127.0.0.1/not-fetched",
}
ASHBY = {
    "jobs": [
        {
            "title": "Fixture role",
            "location": "Remote",
            "department": "Engineering",
            "team": "Platform",
            "isListed": True,
            "descriptionPlain": "Complete fixture description.\n\nNext paragraph.",
            "descriptionHtml": "<p>Not preferred</p>",
            "jobUrl": ASHBY_URL,
            "applyUrl": "http://127.0.0.1/not-fetched",
        }
    ]
}


@pytest.mark.parametrize(
    ("provider", "url", "payload", "endpoint"),
    [
        ("lever", LEVER_URL, LEVER, f"https://api.lever.co/v0/postings/fixture/{ID}"),
        (
            "lever",
            LEVER_URL.replace("jobs.lever", "jobs.eu.lever"),
            LEVER,
            f"https://api.eu.lever.co/v0/postings/fixture/{ID}",
        ),
        ("ashby", ASHBY_URL, ASHBY, "https://api.ashbyhq.com/posting-api/job-board/fixture"),
    ],
)
def test_import_uses_only_fixed_official_endpoint_without_database(
    transport: Callable[[httpx2.Response], list[httpx2.Request]],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    provider: str,
    url: str,
    payload: object,
    endpoint: str,
) -> None:
    calls = transport(httpx2.Response(200, json=payload))
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with (
        TestClient(app) as client,
        patch("roleintel.database.create_engine", side_effect=AssertionError("Database accessed")),
    ):
        response = client.post(
            f"/api/jobs/import/{provider}", json={"source_url": url + "?track=drop"}
        )
    assert response.status_code == 200
    draft = response.json()
    assert draft["title"] == "Fixture role"
    assert draft["location"] == "Remote"
    assert draft["department"] == "Engineering; Platform"
    assert draft["source_url"] == url
    for field in [
        "company",
        "requisition_id",
        "technologies",
        "experience_requirements",
        "seniority",
    ]:
        assert draft[field] is None
    assert "id" not in draft and "application" not in draft
    assert len(calls) == 1 and str(calls[0].url) == endpoint
    assert calls[0].method == "GET"
    assert not {"cookie", "authorization"} & set(calls[0].headers)
    assert calls[0].headers["accept-encoding"] == "identity"


def test_lever_preserves_all_description_sections_without_duplicate_opening() -> None:
    result = lever.provider_draft(LEVER, ID, LEVER_URL)
    assert result.description == (
        "Opening.\n\nBody.\n\nRequirements\n\nSupplied requirement\n\n"
        "Closing.\n\nSupplied salary note."
    )


def test_lever_html_fallback_drops_active_markup() -> None:
    draft = lever.provider_draft(
        {"id": ID, "description": "<p>First &amp; second</p><script>hidden()</script><p>Next</p>"},
        ID,
        LEVER_URL,
    )
    assert draft.description == "First & second\n\nNext"
    assert draft.company is None and draft.title is None and draft.location is None


def test_ashby_selects_exact_job_ignoring_other_listed_and_unlisted_jobs() -> None:
    job = ASHBY["jobs"][0]
    data = {
        "jobs": [
            {**job, "jobUrl": ASHBY_URL.replace(ID, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")},
            {**job, "jobUrl": ASHBY_URL + "?tracking=drop"},
        ]
    }
    result = ashby.provider_draft(data, ASHBY_URL)
    assert result.description == job["descriptionPlain"]
    assert result.source_url is not None and str(result.source_url) == ASHBY_URL


def test_ashby_html_fallback_and_missing_optional_fields() -> None:
    result = ashby.provider_draft(
        {
            "jobs": [
                {
                    "jobUrl": ASHBY_URL,
                    "isListed": True,
                    "descriptionHtml": "<p>First</p><p>Second</p>",
                }
            ]
        },
        ASHBY_URL,
    )
    assert result.description == "First\n\nSecond"
    assert result.title is None and result.department is None


@pytest.mark.parametrize("provider,url", [("lever", LEVER_URL), ("ashby", ASHBY_URL)])
@pytest.mark.parametrize(
    "alter",
    [
        "http",
        "credentials",
        "port",
        "suffix-host",
        "fragment",
        "encoded-id",
        "extra-path",
        "traversal",
        "bad-id",
        "wrong-provider",
        "backslash",
        "control",
    ],
)
def test_invalid_urls_do_not_touch_network(provider: str, url: str, alter: str) -> None:
    host = "jobs.lever.co" if provider == "lever" else "jobs.ashbyhq.com"
    urls = {
        "http": url.replace("https:", "http:"),
        "credentials": url.replace("https://", "https://user:password@"),
        "port": url.replace(host, host + ":443"),
        "suffix-host": url.replace(host, host + ".evil.test"),
        "fragment": url + "#fragment",
        "encoded-id": url.replace(ID, "%31" + ID[1:]),
        "extra-path": url + "/apply",
        "traversal": url.replace("/fixture/", "/fixture/../"),
        "bad-id": url.replace(ID, "123"),
        "wrong-provider": url.replace(host, "boards.greenhouse.io"),
        "backslash": url.replace(host, host + "\\@evil.test"),
        "control": url.replace("/fixture/", "/fix\nture/"),
    }
    with (
        TestClient(app) as client,
        patch.object(common.httpx2, "AsyncClient", side_effect=AssertionError("Network accessed")),
    ):
        response = client.post(f"/api/jobs/import/{provider}", json={"source_url": urls[alter]})
    assert response.status_code == 422


@pytest.mark.parametrize("provider,url", [("lever", LEVER_URL), ("ashby", ASHBY_URL)])
@pytest.mark.parametrize("status,expected", [(301, 502), (404, 404), (429, 503), (500, 503)])
def test_provider_failures_are_explicit_and_redacted(
    transport: Callable[[httpx2.Response], list[httpx2.Request]],
    provider: str,
    url: str,
    status: int,
    expected: int,
) -> None:
    calls = transport(
        httpx2.Response(status, text="private", headers={"location": "http://127.0.0.1"})
    )
    with TestClient(app) as client:
        response = client.post(f"/api/jobs/import/{provider}", json={"source_url": url})
    assert response.status_code == expected
    assert "private" not in response.text
    assert len(calls) == 1


@pytest.mark.parametrize("provider,url", [("lever", LEVER_URL), ("ashby", ASHBY_URL)])
def test_new_providers_share_response_limit_and_timeout(
    transport: Callable[[httpx2.Response], list[httpx2.Request]],
    provider: str,
    url: str,
) -> None:
    transport(
        httpx2.Response(
            200,
            content=b"x" * (common.MAX_RESPONSE_BYTES + 1),
            headers={"content-type": "application/json"},
        )
    )
    with TestClient(app) as client:
        response = client.post(f"/api/jobs/import/{provider}", json={"source_url": url})
        assert response.status_code == 502
        with patch.object(common.httpx2, "AsyncClient", side_effect=httpx2.ReadTimeout("private")):
            response = client.post(f"/api/jobs/import/{provider}", json={"source_url": url})
            assert response.status_code == 504 and "private" not in response.text


@pytest.mark.parametrize(
    "data",
    [
        None,
        {},
        {"id": "wrong", "descriptionPlain": "Text"},
        {**LEVER, "categories": []},
        {**LEVER, "descriptionPlain": 42},
        {**LEVER, "lists": ["invalid"]},
        {**LEVER, "lists": [{"text": "Heading", "content": 42}]},
        {**LEVER, "descriptionPlain": "x" * 100_001},
        {**LEVER, "descriptionPlain": "private\x00text"},
        {"id": ID},
    ],
)
def test_invalid_lever_fields_fail(data: object) -> None:
    with pytest.raises(common.ProviderError) as error:
        lever.provider_draft(data, ID, LEVER_URL)
    assert error.value.status == 502


@pytest.mark.parametrize(
    "data,status",
    [
        (None, 502),
        ({}, 502),
        ({"jobs": []}, 404),
        ({"jobs": [42]}, 502),
        ({"jobs": [{**ASHBY["jobs"][0], "isListed": False}]}, 404),
        ({"jobs": [{**ASHBY["jobs"][0], "isListed": None}]}, 502),
        ({"jobs": [{**ASHBY["jobs"][0], "jobUrl": "https://evil.test/job"}]}, 502),
        ({"jobs": [ASHBY["jobs"][0], ASHBY["jobs"][0]]}, 502),
        ({"jobs": [{**ASHBY["jobs"][0], "descriptionPlain": 42}]}, 502),
        ({"jobs": [{**ASHBY["jobs"][0], "descriptionPlain": "x" * 100_001}]}, 502),
        ({"jobs": [{**ASHBY["jobs"][0], "descriptionPlain": "", "descriptionHtml": None}]}, 502),
    ],
)
def test_invalid_unlisted_or_missing_ashby_job_fails(data: object, status: int) -> None:
    with pytest.raises(common.ProviderError) as error:
        ashby.provider_draft(data, ASHBY_URL)
    assert error.value.status == status


def test_optional_oversized_fields_remain_null_with_warning() -> None:
    result = lever.provider_draft({**LEVER, "text": "x" * 1001}, ID, LEVER_URL)
    assert result.title is None and any("title" in warning for warning in result.warnings)
    result = ashby.provider_draft({"jobs": [{**ASHBY["jobs"][0], "title": "x" * 1001}]}, ASHBY_URL)
    assert result.title is None and any("title" in warning for warning in result.warnings)


@pytest.mark.integration
@pytest.mark.parametrize(
    "provider,url,payload", [("lever", LEVER_URL, LEVER), ("ashby", ASHBY_URL, ASHBY)]
)
def test_import_preview_only_persists_after_explicit_reviewed_save(
    transport: Callable[[httpx2.Response], list[httpx2.Request]],
    jobs_client: TestClient,
    postgres_engine: Engine,
    provider: str,
    url: str,
    payload: object,
) -> None:
    transport(httpx2.Response(200, json=payload))
    response = jobs_client.post(f"/api/jobs/import/{provider}", json={"source_url": url})
    assert response.status_code == 200
    with Session(postgres_engine) as session:
        assert session.scalar(select(func.count()).select_from(Job)) == 0
        assert session.scalar(select(func.count()).select_from(Application)) == 0
    draft = response.json()
    draft.pop("warnings")
    draft["company"] = "User reviewed company"
    saved = jobs_client.post("/api/jobs", json=draft)
    assert saved.status_code == 201
    detail = jobs_client.get(f"/api/jobs/{saved.json()['id']}").json()
    assert detail["company"] == "User reviewed company"
    assert detail["source_url"] == url
    assert detail["application"]["status"] == "interested"
