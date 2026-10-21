# RoleIntel

RoleIntel is an evolving job-intelligence and referral platform. This repository is being built in small, validated milestones. Phase 0 foundations are complete; Phase 1 begins with the job/application persistence schema, not the product dashboard or job workflows.

## Architecture

- `apps/api` — Python, FastAPI, Pydantic; currently exposes a health endpoint.
- `apps/api/src/roleintel/models.py` — typed SQLAlchemy job and application models.
- `apps/api/migrations` — versioned PostgreSQL schema managed by Alembic.
- `apps/web` — Next.js App Router, React, TypeScript, Tailwind CSS, and shadcn/ui; currently contains a foundation landing page and a reusable UI primitive.
- `docker-compose.yml` — local PostgreSQL service for future persistence work.
- `.github/workflows/ci.yml` — backend and frontend checks for pushes and pull requests targeting `main`.

Job APIs, dashboard workflows, and third-party providers remain deferred. The backend exposes interactive API documentation at `/docs` when running. Its health endpoint does not require database configuration or a running database.

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

Open `http://localhost:3000` for the web foundation, `http://localhost:8000/health` for the API health check, and `http://localhost:8000/docs` for OpenAPI documentation.

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
