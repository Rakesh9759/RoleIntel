# RoleIntel

RoleIntel is an evolving job-intelligence and referral platform. This repository is being built in small, validated milestones; the current scope is the Phase 0 development foundation, not the product dashboard or job workflows.

## Architecture

- `apps/api` — Python, FastAPI, Pydantic; currently exposes a health endpoint.
- `apps/web` — Next.js App Router, React, TypeScript, Tailwind CSS, and shadcn/ui; currently contains a foundation landing page and a reusable UI primitive.
- `docker-compose.yml` — local PostgreSQL service for future persistence work.
- `.github/workflows/ci.yml` — backend and frontend checks for pushes and pull requests targeting `main`.

Business features, database models, migrations, and third-party providers are intentionally deferred to later milestones. The backend exposes interactive API documentation at `/docs` when running.

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

## Checks

Backend (from `apps/api`):

```powershell
python -m ruff check src tests
python -m ruff format --check src tests
python -m pytest
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
