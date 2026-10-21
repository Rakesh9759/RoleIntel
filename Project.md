# Project: RoleIntel — AI-Powered Job Intelligence & Referral Platform

## Objective

Build a full-stack web application called **RoleIntel**, an AI-powered job discovery, hiring-team intelligence, and referral assistant.

The platform should eventually help job seekers discover relevant opportunities, identify potential recruiters and hiring managers, find employees who may provide referrals, retrieve publicly available professional contact information, and generate personalized outreach messages.

**Important: Start with a basic, functional MVP. Do not attempt to implement every feature immediately.**

**This document is the initial product baseline, not the complete or final definition of RoleIntel.** The application is intended to evolve continuously: new features, providers, workflows, integrations, user experience improvements, performance enhancements, and revisions to existing capabilities may be proposed and added after review. The Phase 1–5 descriptions are an initial scope and direction, not a permanent feature ceiling or an instruction to build all listed capabilities immediately.

### Sources of truth and document responsibilities

- `Project.md` (this file): product vision, current requirements, architecture constraints, high-level phases, and acceptance criteria.
- `.local/commit-plan.md`: **private, editable** milestone sequence, granular implementation tasks, candidate commit boundaries, scheduling assumptions, dependencies, and actual validation/commit tracking. Do not commit or publish it; `.local/` must be ignored in `.gitignore`.
- `.github/copilot-instructions.md`: engineering standards and reusable agent/Git rules, including code review, testing, branching, and authorization. Do not duplicate those operational rules here.
- `ROADMAP.md`: shareable, high-level status and future product capability proposals, without private commit scheduling details.

**Precedence:** use this file to determine *what* RoleIntel should deliver and its product constraints. Use the private commit plan to decide *what to work on next*, after reconciling it with actual code, Git history, tests, and user instructions. Follow Copilot instructions for *how* to implement and validate changes. When documents disagree, stop and identify the inconsistency rather than silently overwriting product requirements or claiming planned work was completed.


Design the application using a modular architecture so advanced capabilities can be added incrementally without major restructuring.

---

## Phase 1 — Build the Basic MVP (Implement Now)

### 1. Initialize the Project

Create a monorepo containing:

- Frontend: Next.js, TypeScript, Tailwind CSS, shadcn/ui
- Backend: Python, FastAPI, Pydantic
- Database: PostgreSQL, SQLAlchemy, Alembic
- Local development: Docker Compose
- Testing: Pytest for backend, Vitest for frontend
- Configuration: Environment variables stored in `.env`

Follow clean architecture principles and separate business logic, integrations, data models, and API routes.

### 2. Create the Initial Dashboard

Build a clean, responsive web application with a modern SaaS dashboard.

Include:

- Sidebar navigation
- Dashboard homepage
- Job search and job submission
- Saved jobs
- Job detail pages
- Potential contacts
- AI-generated messages
- Application tracker
- Settings

The initial navigation shell uses a light dashboard, persistent desktop sidebar,
and expandable mobile navigation. Dashboard metrics display "Not connected" until
real data is wired in; unfinished pages explicitly identify themselves as
placeholders. Do not display fabricated counts or activity. Any later sample data
must be clearly labeled as demonstration data.

All navigation should work, even if advanced pages display placeholder content.

The first API-connected workflow is Saved jobs: save optional title/company/location
with a required description or HTTP(S) URL, list real records, combine search,
company and status filters, and paginate in pages of 20. Show explicit loading,
empty, service-error and retry states. Successful saves reset the form and filters
to the newest page; failed saves retain user input. URLs are stored only, never
fetched in this workflow. Use a server-only API origin and same-origin frontend
GET/POST handlers.

Saved-job titles link to dedicated detail pages that support direct access and
reload through a single-job GET endpoint. Display all stored fields, safe source
links and timestamps; do not invent missing data or render submitted HTML.
Application status changes require an explicit Save status action, support all
seven statuses, and display only API-confirmed saved state. Preserve the selected
value on failure, prevent duplicate in-flight updates, and provide explicit
not-found/service-error states with retry for service errors. Missing tracking
stays visible as unavailable; it is never silently recreated.

### 3. Job URL Input and Extraction

Allow users to paste a job posting URL.

Extract and display:

- Company name
- Job title
- Job ID / requisition ID
- Job description
- Location
- Required technologies
- Experience requirements
- Seniority
- Team or department, if identifiable
- Original job posting URL

Start with supported public APIs such as Greenhouse, Lever, and Ashby.

Provide a fallback allowing users to paste a job description manually.

Do not fabricate missing fields. Display "Not available" when information cannot be verified.

The manual fallback accepts plain text up to 100,000 characters. Normalize line
endings and whitespace while preserving paragraph boundaries and the complete
description. Extract only explicit single-line `Label: value` facts; do not infer
company/title from prose or scan for technology keywords. Supported labels are
Company / Company name, Title / Job title, Job ID / Requisition ID, Location,
Technologies / Required technologies, Experience requirements, Seniority, and
Department / Team. Label matching is case-insensitive. Technologies must be an
explicit comma- or semicolon-separated list. Blank, conflicting or oversized
values stay null with review warnings. Missing values stay null; submitted facts
are not independently verified. Source URLs are not extracted from the text.

`POST /api/jobs/parse` returns a normalized draft and warnings without accessing
the database, fetching URLs or creating records. The Job search page presents an
editable preview. Users may correct/add fields, including an optional source
URL, then explicitly save through the existing job-creation endpoint. Keep
original text on normalization failures and preview edits on save failures.
Provider URL imports remain separate increments.

### 4. Job Management

Users should be able to:

- Add a job
- View job details
- Save or remove jobs
- Search saved jobs
- Filter by company and status
- Assign application status

Statuses:

- Interested
- Planning to Apply
- Applied
- Referral Requested
- Interviewing
- Offer
- Rejected

Persist data in PostgreSQL.

For the single-user local MVP, each saved job has one application-tracking record,
initially Interested. Users may change freely between the seven statuses above;
no transition sequence is enforced. Unknown job details remain null in storage
rather than storing invented values or display placeholders. The database enforces
at most one tracking record per job and removes it when the job is deleted; the
job-saving workflow will create the pair together. Multi-user ownership remains
deferred until authentication and tenant isolation are introduced.

### 5. Basic People Discovery Interface

Create a reusable contact-discovery module.

For Phase 1, use seeded mock contact records and clearly label them as demonstration data.

Each contact card should display:

- Name
- Job title
- Company
- Potential relationship to the job
- Professional profile URL, when available
- Contact source
- Match explanation
- Verification status

Contact categories:

- Recruiter
- Potential Hiring Manager
- Engineering Manager
- Team Member
- Potential Referral Contact

Implement a provider interface so external people-search APIs can be connected later.

Do not claim a person is the actual hiring manager unless supported by evidence.

### 6. AI Message Generator

Create a message-generation feature that accepts:

- Job title
- Company
- Job ID
- Job description
- Contact role
- Candidate experience or uploaded resume

Generate four types of messages:

1. Referral request
2. LinkedIn connection request
3. Recruiter outreach
4. Hiring manager outreach

Messages should be personalized, concise, professional, and factually grounded in the candidate's provided experience.

Allow the user to edit and copy each message.

Build the provider interface for an LLM API, with a template-based fallback when no API key is configured.

Do not invent employee names, shared connections, experience, or accomplishments.

### 7. Resume Upload

Support PDF and DOCX resume uploads.

Extract and save:

- Technical skills
- Work experience
- Education
- Projects
- Certifications

Use this information to personalize outreach and explain job relevance.

Apply appropriate file-size limits, file-type validation, safe parsing, and access controls.

### 8. Basic Application Tracking

Allow users to track:

- Jobs saved
- Application status
- Potential contacts
- Draft messages
- Outreach status
- Personal notes
- Follow-up dates

Do not send messages automatically.

### 9. API Endpoints

Create REST endpoints for:

- `/api/jobs`
- `/api/jobs/{id}`
- `/api/jobs/parse`
- `/api/contacts`
- `/api/jobs/{id}/contacts`
- `/api/messages/generate`
- `/api/resumes/upload`
- `/api/applications`

Use proper validation, structured error responses, and OpenAPI documentation.

The initial job-submission API accepts user-supplied structured fields with at
least a nonblank description or an HTTP(S) source URL. URLs are stored only;
submission must not fetch or parse them. Each successful submission atomically
creates a job and its Interested tracking record. Listing returns a JSON array,
newest first with a stable ID tiebreaker, using limit/offset pagination (20 jobs
by default, at most 100 per request). It supports a case-insensitive exact
company filter, a single application-status filter, and literal case-insensitive
substring search across title, company and description; supplied filters combine
with AND. Status updates accept any documented status and return the updated job;
missing jobs or tracking records return 404. Supported-provider URL parsing
remains a separate increment.

### 10. Testing and Local Deployment

Provide:

- Database migrations
- Docker Compose configuration
- Sample environment variables
- Seed data
- Unit and integration tests
- README with setup and execution instructions

Ensure the MVP can run locally without paid API subscriptions.

Use mock adapters and template-based generation wherever external credentials are unavailable.

---

## Phase 2 — Hiring Intelligence (Document Only)

Create a roadmap for the following features but do not implement them yet:

- Apollo or licensed professional-contact API integration
- Professional email discovery and verification
- Recruiter and hiring manager search
- Job-to-team identification
- Contact relevance scoring
- Evidence-based confidence levels
- Employee referral recommendations
- Matching using embeddings and graph relationships
- Contact deduplication
- Source provenance and verification
- Caching and API rate-limit management

The architecture should support these integrations through replaceable provider adapters.

---

## Phase 3 — Automated Job Discovery (Document Only)

Plan support for:

- Scheduled job ingestion
- Multiple ATS and authorized job-board sources
- Job deduplication
- New job notifications
- Job freshness tracking
- Resume-to-job matching
- User-specific job recommendations
- Filters for location, technology, compensation, seniority, and visa sponsorship where reliable information exists

Do not implement unauthorized LinkedIn scraping or automated account interactions.

---

## Phase 4 — Advanced AI and Referral Intelligence (Document Only)

Plan the following enhancements:

- Multi-signal recruiter and hiring manager identification
- Evidence-based contact rankings
- Candidate-to-job relevance scoring
- Personalized outreach using resume and job details
- Outreach quality scoring
- Referral likelihood estimation, only if supported by suitable data
- AI-assisted job research
- Application timeline summaries
- Follow-up draft suggestions
- Feedback-based recommendation improvements

Ensure inferred relationships are distinguished from verified relationships.

---

## Phase 5 — Production SaaS Features (Document Only)

Plan:

- User authentication
- User profiles
- Multi-tenant data isolation
- Subscription billing
- API usage limits
- Admin dashboard
- Audit logging
- Secrets management
- OAuth integrations
- User-approved email sending
- Privacy controls and data deletion
- Monitoring and alerting
- Background processing
- Cloud deployment
- CI/CD
- Scaling and cost optimization

---

## Architectural Requirements

Design the application so that:

1. Each external service is implemented behind a provider interface.
2. Mock providers can be replaced with real providers without rewriting application logic.
3. Data ingestion is separate from normalization and analysis.
4. AI-generated outputs use structured schemas and are validated.
5. Contact matching stores its supporting evidence.
6. Long-running tasks can eventually move to asynchronous workers.
7. API credentials are never exposed to the frontend.
8. Personally identifiable information is handled securely.
9. Unauthorized scraping, unsolicited bulk messaging, and automatic LinkedIn connection requests are excluded.
10. The MVP remains simple and functional before introducing complex infrastructure.

## Incremental Delivery and Commit-Plan Alignment

**The project must be developed as a production-style, evolving repository, not generated as one large implementation.** Before implementing work, read `Project.md`, `.github/copilot-instructions.md` (when present), and the private `.local/commit-plan.md` (when present). Inspect the actual repository state before relying on planning assumptions.

Use the **P0 → P1.1–P1.9 → P2 → P3 → P4 → P5** milestone structure in `.local/commit-plan.md`. The plan refines the high-level phases here; it does not replace the requirements or authorize the implementation of later phases. Phase 0 establishes repository and development foundations. Phase 1 delivers the working local MVP as individually validated feature slices. Phases 2–5 remain planned until explicitly authorized.

For each milestone, identify its scope, prerequisites, intended behavior, tests, acceptance criteria, and reasonable commit boundaries. Implement only the approved milestone; keep `main` stable and the application runnable. Group related implementation, tests, migration, and documentation changes into meaningful commits rather than committing every edit. Validate changes and review the diff before proposing commits, following `.github/copilot-instructions.md`. Do not commit, push, deploy, merge, or modify Git history without required user approval.

**Planning dates versus recorded history:** the commit plan's dates are planned slots, not evidence that work happened at those times. Preserve authentic Git author/committer timestamps; never assign a planned slot to a commit created later. If history reconstruction is explicitly approved, preserve the original history in a verified backup, split only existing meaningful changes into the approved milestone boundaries, and record the planned slot separately from actual implementation and Git timestamps.

After each meaningful session, reconcile the private plan against repository state and update milestone status, blockers, actual test results, and next tasks. Reflect material public-facing capability changes in `ROADMAP.md` and relevant documentation. Keep the private schedule, dates, and commit ledger outside version control.

### Future enhancements and scope evolution

RoleIntel is **not limited to the initial feature list**. As we learn from implementation, user feedback, reliability needs, and available integrations, we may add brand-new phases or extend existing ones. Enhancements could involve discovery quality, integrations, search and filtering, matching intelligence, outreach assistance, analytics, workflow automation, accessibility, security, scale, and user experience. These are possibilities—not approved features or implied requirements.

For every proposed addition or enhancement:

1. Describe the user problem, expected outcome, and how the change fits RoleIntel.
2. Assess privacy, source authorization/licensing, security, operational cost, and architectural impact.
3. Define scope, dependencies, acceptance criteria, tests, and a minimal incremental delivery path.
4. Get approval for substantive scope or architecture changes before implementation.
5. Update `Project.md` when the product requirement changes; update `ROADMAP.md` for public planning; update `.local/commit-plan.md` for private work sequencing and proposed commit boundaries.
6. Do not retroactively mark planned work as complete. Reconstruct commit boundaries only with explicit approval and a verified backup; do not fabricate Git timestamps or rewrite a remote without separate approval.

Protect the core constraints: do not fabricate people or job facts; distinguish demo, inferred, and verified information; use authorized data sources; exclude unauthorized scraping and unsolicited automated outreach; require explicit user approval before sending messages; safeguard uploaded resumes and personal data.

## Expected Deliverables

- Working full-stack MVP
- Complete project directory structure
- PostgreSQL schema and migrations
- Functional REST endpoints
- Responsive dashboard
- Working job submission and tracking
- Basic AI message generator
- Demo contact discovery interface
- Resume upload and extraction
- Tests and local startup instructions
- `README.md`
- `.env.example`
- `ROADMAP.md`

## Definition of Done

The MVP is complete when a user can:

1. Start the application locally.
2. Paste a supported job URL or enter a description manually.
3. View extracted job information.
4. Save and manage the job.
5. Upload a resume.
6. View clearly identified demonstration contacts.
7. Generate and edit personalized outreach messages.
8. Copy messages for manual use.
9. Track application progress.
10. Restart the application without losing persisted data.

All these workflows must function without requiring paid third-party APIs.

**Begin with the first incomplete, authorized milestone in `.local/commit-plan.md` (normally P0 for a new repository), after verifying the real workspace state. Implement and validate one milestone at a time. The MVP is the first release target, not the final product; expand capabilities through reviewed enhancements and future phases.**