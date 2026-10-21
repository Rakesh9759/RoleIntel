# RoleIntel Engineering Instructions

## Sources of truth

- Read `Project.md` for product requirements, architectural constraints, and scope.
- Read `.local/commit-plan.md` for private milestone order and actual progress. Never add this file to Git or publish its contents.
- Use `ROADMAP.md` only for shareable, high-level future direction.
- Keep product requirements, engineering practices, and private scheduling in their respective documents; avoid copying their contents between files.

## Incremental delivery

- Work only on the first incomplete, authorized milestone. Do not implement later phases or infer approval from the roadmap.
- Before changing code, check repository status and relevant files; preserve existing work.
- Define the scope, dependencies, acceptance criteria, test coverage, and intended file boundary before implementation.
- Prefer the smallest complete change that fits the milestone. Keep domain logic, API boundaries, providers, and persistence concerns separable as product features are introduced.
- Update product requirements when product scope changes, and update the private plan with real status, checks, blockers, and actual commit details. Never fabricate dates, hashes, or completed work.

## Code quality and validation

- Follow the existing language and framework conventions; use explicit types, input validation, and clear error handling.
- Add or update focused tests for behavior changes. Run relevant tests, linters, formatters, type checks, and builds before proposing a commit.
- Keep local development reproducible and document required environment variables without committing credentials.
- Review the final diff and check ignored/private files and secrets before proposing a commit. Report checks that could not run; do not claim unexecuted checks passed.

## Security and privacy

- Keep API keys and secrets server-side. Use least privilege and safe defaults.
- Treat resumes, contact information, and user-generated content as sensitive.
- Do not invent people, employment details, shared connections, or candidate achievements.
- Use only authorized data sources. Do not add unauthorized scraping, unsolicited bulk messaging, or automatic LinkedIn interactions.
- Require explicit user approval before sending any communication.

## Git and GitHub

- Keep `main` usable and prefer focused, reviewable changes.
- Never commit, push, create a remote, merge, deploy, or rewrite history without explicit user approval.
- Use authentic commit timestamps and natural, specific commit messages. Do not create commits to satisfy a schedule.
- For explicitly approved history reconstruction, preserve the original history in a verified backup, split only real changes into approved milestone boundaries, record planned slots separately from actual implementation and Git timestamps, and never force-push without separate approval.
- GitHub Actions checks do not imply branch protection; configure repository settings only after a remote exists and with user approval.
