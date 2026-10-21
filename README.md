# RoleIntel

RoleIntel is an evolving job-intelligence and referral platform. This repository is being built in small, validated milestones. Phase 0 foundations are complete; Phase 1 currently includes job/application persistence, job APIs and a responsive dashboard/navigation shell. Frontend job workflows are not connected yet.

## Architecture

- `apps/api` — Python, FastAPI, Pydantic; exposes health, job submission, filtered listing and status updates.
- `apps/api/src/roleintel/models.py` — typed SQLAlchemy job and application models.
- `apps/api/migrations` — versioned PostgreSQL schema managed by Alembic.
- `apps/web` — Next.js App Router, React, TypeScript, Tailwind CSS, and shadcn/ui; includes a responsive dashboard shell, shared navigation, placeholder routes and a reusable UI primitive.
- `docker-compose.yml` — local PostgreSQL service for future persistence work.
- `.github/workflows/ci.yml` — backend and frontend checks for pushes and pull requests targeting `main`.

Additional job APIs, dashboard workflows, and third-party providers remain deferred. The backend exposes interactive API documentation at `/docs` when running. Its health endpoint does not require database configuration or a running database.

## Prerequisites

- Python 3.12 or newer
- Node.js 22 or newer and npm
- Docker Desktop (only if running PostgreSQL with Compose)

## Local development

From the repository root, create a Python virtual environment and install the API with its development tools:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e "apps/api[dev]"
```

Start the API in one terminal:

```powershell
python -m uvicorn roleintel.main:app --app-dir apps/api/src --reload --port 8000
```

Start the frontend in another terminal:

```powershell
Set-Location apps\web
npm ci
npm run dev
```

Open `http://localhost:3000` for the dashboard shell, `http://localhost:8000/health` for the API health check, and `http://localhost:8000/docs` for OpenAPI documentation.

### Frontend preview

The dashboard at `/` has persistent desktop navigation and an expandable mobile
menu. Keyboard users can skip to main content or close the open menu with Escape.
Navigation links resolve to `/search` (job search), `/jobs` (saved jobs),
`/contacts`, `/messages`, `/applications` (application tracker), and `/settings`.
These six destinations are explicitly labeled placeholders, not functional
workflows. Dashboard metrics read **Not connected**, not fabricated counts.
The frontend does not call the job API, submit jobs, change statuses or send
messages yet; it runs without the API or database.

## Local PostgreSQL

Copy the example settings and start the database service:

```powershell
Copy-Item .env.example .env
docker compose up -d db
```

The Compose service publishes PostgreSQL on `localhost:5432` and uses a named volume for local data. Its example credentials are for local development only. Do not reuse them outside a local environment. Docker Desktop must be running before starting the service.

Stop the database without deleting its data:

```powershell
docker compose down
```

## Database schema and migrations

Reinstall the API after dependency changes using the command above. From the
repository root, with the virtual environment active and PostgreSQL running:

```powershell
python -m alembic -c apps\api\alembic.ini upgrade head
python -m alembic -c apps\api\alembic.ini current
python -m alembic -c apps\api\alembic.ini check
```

Migration commands load `DATABASE_URL` from environment variables or `.env` in the
current working directory; run them from the repository root to use the root
`.env`. Environment variables take precedence. The URL must use the
`postgresql+psycopg` driver and include a database name. Keep its credentials
consistent with the Compose `POSTGRES_*` settings and URL-encode special characters.
No engine is created or migration run automatically when the API is imported.

The schema stores job details as nullable fields when unknown. Applications
reference jobs through a unique foreign key, allowing at most one tracking record
per saved job. Tracking defaults to `interested` and permits any of the seven
statuses in [Project.md](./Project.md); the database rejects other values. Deleting
a job cascades to its tracking record. The future save-job service will create
both records together. Timestamps are timezone-aware; SQLAlchemy updates
`updated_at` on ORM updates. This is a local single-user schema, not a tenant-isolated
public service.

Use migrations rather than `Base.metadata.create_all()` to change the schema.
To reverse the baseline **only in a disposable database** (this deletes all job
and application data):

```powershell
python -m alembic -c apps\api\alembic.ini downgrade base
```

## Job API

After configuring `DATABASE_URL` and applying migrations, start the API from the
repository root so it can load the root `.env`.

- `POST /api/jobs` accepts a JSON object and returns `201` with the saved job,
  IDs, timestamps, and nested Interested application record. Both records are
  committed atomically. At least `description` or `source_url` is required.
- `GET /api/jobs` returns `200` with a JSON array of saved jobs, newest first,
  ordered by creation timestamp and then ID descending. An empty database returns
  `[]`. **Listing is now bounded by default**, unlike the initial unpaginated
  endpoint: `limit` defaults to 20, accepts 1–100, and `offset` defaults to 0
  (nonnegative, at most 9,223,372,036,854,775,807). Offsets beyond the result set return
  `[]`. Responses remain arrays, with no total-count envelope. Concurrent inserts
  or deletes can shift offset-based pages; pagination is not a snapshot.
- Optional listing filters: `company` is a case-insensitive exact match, `status`
  accepts one documented lowercase status value, and `q` is case-insensitive
  substring search over title/company/description. Text filters are trimmed,
  nonblank and limited to 1,000 characters. `%`, `_`, `/` and backslashes are
  literal search characters, not wildcards. Supplied filters combine with AND,
  before pagination. Unknown query parameters are rejected with `422`.
- `PATCH /api/jobs/{job_id}/status` accepts only `{"status":"applied"}` and returns
  `200` with the updated job and tracking record. Any of the seven statuses is
  allowed, including repeated or backwards changes. Only application status and
  its update timestamp change; repeating the same status is a no-op. A missing
  job or tracking record returns structured `404` with code `job_not_found`;
  malformed UUIDs or invalid bodies return `422`. Missing tracking is not silently
  repaired.

Example:

```powershell
$body = @{
    description = "Paste the actual job description here."
    title = "User-supplied job title"
    source_url = "https://example.com/jobs/42"
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/jobs -ContentType "application/json" -Body $body
Invoke-RestMethod -Uri http://localhost:8000/api/jobs
Invoke-RestMethod -Uri "http://localhost:8000/api/jobs?company=Example%20Co&status=applied&q=python&limit=10&offset=0"
# Replace the ID with one returned by job submission or listing.
$statusBody = @{ status = "applied" } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "http://localhost:8000/api/jobs/<job-id>/status" -ContentType "application/json" -Body $statusBody
```

Optional fields are `company`, `title`, `requisition_id`, `location`,
`technologies`, `experience_requirements`, `seniority`, and `department`.
Unknown fields remain null; clients cannot set IDs, timestamps, or initial status.
Strings are trimmed and cannot be blank when supplied. Short fields and each
technology are limited to 1,000 characters; descriptions and experience
requirements to 100,000 characters; technologies to 100 entries; and source URLs
to 2,048 characters. Source URLs must be HTTP(S) without embedded credentials.
They are **stored only, never fetched**, and need not identify a supported
provider yet. Each submission creates a new job; deduplication is not implemented.

Invalid bodies return `422` with structured validation details without echoing
input values. Database/configuration failures return `503` with
`{"detail":{"code":"database_unavailable","message":"Database is unavailable"}}`;
server logs report a redacted error rather than credentials or submitted content.
Database engines are created lazily and disposed on application shutdown.
Restart the API after changing database connection settings.

This is a local single-user API with no authentication. Do not expose it publicly.
Detail routes, deletion endpoints, URL parsing and UI integration are not
implemented in this increment.

## Checks

Backend (from `apps/api`):

```powershell
python -m ruff check src tests migrations
python -m ruff format --check src tests migrations
python -m pytest
```

The root `pyrightconfig.json` supplies the API source path and basic type-checking
configuration for Pylance in the monorepo. Select the API virtual environment in
VS Code after installing dependencies.

The PostgreSQL integration tests are skipped unless `TEST_DATABASE_URL` is set.
Point it at a **dedicated disposable PostgreSQL database**, never a production
database or the normal development database. The test uses a uniquely named
temporary schema, checks upgrade/downgrade/re-upgrade and ORM/schema consistency,
then removes its schema. Persistence tests migrate a separate schema per test
and verify real commits and reconnects, all 49 status pairs, invalid values,
foreign-key/uniqueness constraints, deletion cascades, rollback, and update timestamps.
Those tests commit to the disposable database and remove their schemas in teardown.
CI supplies PostgreSQL and runs these checks on each supported Python version.
Job API tests also verify submission/listing contracts, atomic rollback, input
limits and redaction, and persistence through an application restart. Configuration,
OpenAPI and unavailable-database tests run without a PostgreSQL test database.
Filtering/status tests cover bounded pagination with stable ties, combined filters,
literal search characters, invalid query/body values, persisted status changes,
missing records and rollback after a failed status write.

Example, assuming a separate `roleintel_test` database has already been created:

```powershell
$env:TEST_DATABASE_URL = "postgresql+psycopg://roleintel:roleintel_dev_only@localhost:5432/roleintel_test"
python -m pytest -m integration
Remove-Item Env:\TEST_DATABASE_URL
```

Frontend (from `apps/web`):

```powershell
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

## Project guidance

- [`Project.md`](./Project.md) defines the product, architecture constraints, and feature phases.
- [`.github/copilot-instructions.md`](./.github/copilot-instructions.md) defines engineering and repository practices.
- [`.local/commit-plan.md`](./.local/commit-plan.md) contains private milestone sequencing and progress; `.local/` is excluded from Git.
- [`ROADMAP.md`](./ROADMAP.md) is the shareable, high-level product roadmap.

GitHub Actions run the API and web checks on pushes and pull requests targeting `main`. Configure branch protection separately if required; a passing workflow does not enable it automatically.
