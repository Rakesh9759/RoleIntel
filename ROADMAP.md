# RoleIntel Roadmap

This roadmap describes high-level product direction, not delivery promises. Product scope may evolve as requirements, provider authorization, privacy, and operating costs become clearer. The detailed development schedule is maintained privately and is not published here.

## Current

- **Phase 0 — Project foundation complete:** repository, API and web skeletons, validated local PostgreSQL service, tests, and CI checks.
- **Phase 1 — Local MVP in progress:** job/application schema, reversible migrations, persistence/status tests, job submission, paginated search/filtering and application-status updates. A responsive dashboard/navigation shell is available with clearly labeled placeholder pages; frontend data workflows are not connected yet.

## Planned

- **Remaining Phase 1 — Local MVP:** connect dashboard and saved-job workflows to the API; job detail/removal workflows and UI; supported ATS and manual job parsing; validated resume handling; clearly labeled demonstration contacts; and grounded, editable outreach drafts. Features will be delivered as tested increments.
- **Phase 2 — Hiring intelligence:** authorized contact providers, provenance, verification, deduplication, and evidence-based relevance.
- **Phase 3 — Job discovery:** authorized sources, freshness, deduplication, opt-in notifications, and explainable recommendations.
- **Phase 4 — AI and referral intelligence:** evidence-backed summaries, relevance signals, and evaluated outreach assistance.
- **Phase 5 — Production SaaS:** authentication, tenant isolation, privacy controls, operations, billing, and deployment readiness.

## Product safeguards

- Distinguish demonstration, inferred, and verified information; do not fabricate job or people facts.
- Use authorized data sources and respect provider licensing and terms.
- Do not implement unauthorized scraping, automated LinkedIn interactions, or unsolicited bulk messaging.
- Keep credentials server-side and protect resumes and personal information.
- Require user approval before any message is sent.

Phases 2–5 are planning only. Scope and sequencing are subject to review and approval.
