# PlayRush Backend — AGENTS.md

## Mission

Implement the PlayRush browser-gaming backend using the approved PRD and milestone plan. Work only on the current approved milestone.

## Stack

Node.js 24+, strict TypeScript, Express.js, Socket.IO when required, MySQL production and XAMPP MariaDB local. Verify compatibility against the selected production MySQL version in CI/staging. Backend tests: Mocha, Chai, Supertest. Postman for API samples. Jest is reserved for frontend work.

## Architecture

Use a modular monolith. Separate routes/controllers, application services, repositories, domain rules and shared infrastructure. Keep API versioned at `/api/v1`. Validate input; use standardized errors, structured logging, dependency injection where helpful, parameterized SQL, transactions and versioned migrations.

## Product invariants

- Score: 1 point per metre, 10 points per coin, subject to trustworthy validation.
- XP: floor of validated score divided by 10; Level = 1 + floor(total XP / 500), as approved from the PRD for the versioned M02 progression policy.
- Cosmetic characters unlock at levels 3 and 5; no competitive advantage.
- Weekly leaderboard: Monday 00:00 UTC reset; highest validated weekly score; earliest completion breaks ties.
- Top 10: virtual XP/badge rewards, granted idempotently.
- No cash staking, entry fees, real-money rewards or payment integration in initial release.

## Security and integrity

Do not trust client scores, XP, rewards, roles or completion timestamps. Reject duplicate/replayed sessions and invalid requests. Protect secrets, use least privilege, rate limiting and authorization. Do not expose stack traces in production. No unapproved production changes.

## Milestone workflow

1. Read the PRD, this file, milestone specification and latest report.
2. List assumptions, dependencies, acceptance criteria and test matrix.
3. Implement only the approved milestone.
4. Run formatting, lint, typecheck, build and relevant automated tests.
5. Generate Postman samples (positive and negative) for new endpoints.
6. Update architecture/API/migration docs and milestone report.
7. Provide the exact commands, results, counts, failures and known risks.
8. Update this AGENTS.md only if needed; summarize changes.
9. Write a copy-ready prompt for the next milestone based on actual repo state.
10. STOP and wait for explicit approval. Never claim unrun tests passed.

## Definition of done

A milestone is PASS only when its acceptance criteria are demonstrated with evidence, required tests and quality checks pass, API examples are documented, and there are no unresolved blocking defects. Otherwise report FAIL or BLOCKED.

## Required artifacts

`docs/milestones/Mxx.md`, `docs/reports/Mxx-report.md`, `docs/postman/Mxx.postman_collection.json` (when APIs exist), `docs/prompts/Mnext.md`, plus updated README/architecture/OpenAPI as needed.

## Git and GitHub Development Workflow

All backend development must follow a milestone-based Git workflow.

### Branch Management

- The `main` branch represents reviewed and accepted work.
- Each milestone must be developed on a separate feature branch.
- Branch naming convention: `feature/B01-backend-foundation`, `feature/B02-authentication`, etc.
- Never push unfinished milestone changes directly to `main`.

### Commit Standards

Use clear, descriptive conventional commits.

Examples:

- `chore: configure Express and TypeScript`
- `feat: implement database connection`
- `test: add health endpoint integration tests`
- `docs: update B01 milestone summary`
- `fix: resolve database migration error`

### GitHub Push Requirements

- Make small commits after completing meaningful tasks.
- Push the current feature branch to GitHub after successful local verification.
- Never commit `.env`, API keys, database passwords or other secrets.
- Never force-push or overwrite remote changes without explicit approval.
- Do not automatically merge a feature branch into `main`.

### Milestone Completion

At the end of each milestone:

1. Run lint, type checking and relevant automated tests.
2. Generate the milestone summary and actual test results.
3. Update the Postman collection and API documentation.
4. Update the milestone tracker and AGENTS.md.
5. Commit the completed milestone work.
6. Push the feature branch to GitHub.
7. Provide a pull request description with changes, tests, risks and remaining issues.
8. Wait for explicit milestone approval before merging or starting the next milestone.

### Safety Rules

Before performing Git operations, inspect the current branch, working tree and remote configuration. Preserve unrelated changes. Never automatically delete branches, discard uncommitted work or force-push.

## Foundation conventions

- Use ECMAScript modules and keep the Express app factory separate from server startup.
- All API errors use the standardized JSON error envelope and include the response request ID.
- Automated database tests must use an explicitly test-scoped database and must never target development, staging or production data.
- Local MariaDB success does not replace production MySQL compatibility testing.

## Database migration conventions

- Never edit an applied migration; add a new ordered migration. The runner rejects checksum drift.
- Migration rollback and seed commands must refuse production and databases not explicitly named for development/test.
- MySQL/MariaDB DDL is implicitly committed; document recovery through down migrations and backups instead of claiming transaction-wide DDL rollback.
- Keep XP ledger and administrator audit history append-only. Corrections are new traceable records.
