# M02 — Data model and migrations

CODEX PROMPT — COPY THIS ENTIRE SECTION

You are a principal backend engineer implementing PlayRush. Work only on M02 after explicit approval. First inspect `AGENTS.md`, the approved PRD, `docs/milestones/M01.md`, `docs/reports/M01-report.md`, `docs/architecture.md`, `docs/api/openapi.yaml`, the current Git branch/status, package scripts, source, tests, and CI. Do not assume M01 passed without verifying its artifacts and rerunning the relevant checks.

## Current verified foundation

- Node 24+, ECMAScript modules, TypeScript 6 strict mode, Express 5 app/server separation.
- Routes live under `/api/v1`; `GET /api/v1/health` performs an injected MySQL/MariaDB `SELECT 1` probe.
- `mysql2` pool uses UTC and `utf8mb4`; local development uses XAMPP MariaDB 10.4 while CI uses MySQL 8.4.
- Zod configuration validation, Pino structured/redacted logging, request IDs, Helmet, controlled CORS, rate limiting, request-size limits, standardized errors, and graceful shutdown exist.
- Mocha/Chai/Supertest tests compile to `dist-test`; the full suite requires an isolated database whose name contains `test`.
- M01 intentionally created no tables or migrations. Preserve the health contract unless an approved API change is documented.

## Objective

Implement a normalized, production-MySQL-compatible data model and reliable versioned SQL migrations for the PlayRush Release 1 domain without implementing business APIs or future real-money features.

## Scope

1. Confirm PRD rules and unresolved decisions before schema design. Model users/roles and revocable sessions or tokens, player profiles, games and immutable game versions, game sessions, score submissions/events and verified results, XP ledger, characters/unlocks, leaderboard periods/entries, achievements, virtual rewards, moderation actions, and append-only admin audit events.
2. Use explicit primary/foreign keys, uniqueness constraints, checks where supported, indexes for access/ranking paths, UTC timestamps, idempotency keys, and InnoDB-compatible transaction boundaries. Do not add cash, staking, payment, wallet, or settlement tables.
3. Build a versioned migration runner with status, up, and an explicit safe rollback/reversible strategy. Migrations must be repeat-safe at the runner level and must fail atomically where the engine permits.
4. Add non-production-only deterministic seed fixtures. Refuse destructive migration/seed commands against databases not explicitly scoped for development or test.
5. Test both local XAMPP MariaDB compatibility and selected production MySQL compatibility. Do not silently use MariaDB-only or MySQL-only syntax. Document any unavoidable divergence.
6. Update architecture/data-model documentation, migration operations, OpenAPI only if the health contract changes, and README commands.

## Product rules to encode or preserve

- Score baseline: one point per whole metre plus ten points per coin, but client values are never authoritative.
- Gameplay XP: floor of validated score divided by ten; level starts at 1 and is `1 + floor(total XP / 500)` according to the PRD. Document the earlier milestone-plan wording discrepancy before encoding a final policy.
- Cosmetic character unlock levels are 3 and 5 with no competitive advantage.
- Weekly periods start Monday 00:00 UTC; best validated score ranks; earliest server-recorded completion breaks score ties, then session ID resolves an exact tie per the PRD.
- Top-10 rewards are virtual and granted idempotently; weekly state never removes permanent progress.
- No real-money functionality is in scope.

## Mandatory acceptance tests

- Fresh migration on an empty isolated database.
- Migration status before and after apply.
- Repeat apply is a no-op and does not duplicate schema/history.
- Safe rollback strategy and re-migration on a disposable test database.
- Foreign-key, unique, check/index, and idempotency constraints demonstrated.
- Deterministic non-production seed behavior and production seed refusal.
- Transaction rollback leaves no partial state on a forced failure.
- Tests refuse non-test databases and never modify production data.
- Existing M01 health, error, configuration, security, and MariaDB connectivity tests remain passing.
- Format check, lint, strict typecheck, full tests, build, and `npm audit --audit-level=high` all pass with exact outputs/counts recorded.

Use MySQL 8.4 in CI and XAMPP MariaDB locally. If both engines cannot be executed in the implementation environment, do not claim cross-engine acceptance passed; mark the missing engine verification as BLOCKED or an explicit acceptance gap.

## Required artifacts

- Versioned migration files and migration/status/rollback/seed commands.
- `docs/milestones/M02.md` with assumptions, dependencies, criteria, and test matrix.
- `docs/reports/M02-report.md` with scope, changed files, database/API changes, exact executed commands/results/counts, security notes, risks, and PASS/FAIL/BLOCKED verdict.
- `docs/postman/M02-examples.md` and an updated/importable Postman collection where applicable; include migration CLI/SQL verification because M02 adds no business HTTP APIs.
- Data model/ER documentation and updated README/architecture.
- `docs/prompts/M03-codex-prompt.md` based on the actual resulting repository state.
- Update `AGENTS.md` only for durable policies and summarize the change.

At milestone completion, inspect Git status/remotes, commit only scoped work using conventional commits, push the current feature branch after successful verification, provide a pull-request description, and stop. Do not merge or begin M03 without explicit approval. Mark M02 PASS only when every acceptance criterion is evidenced; otherwise report FAIL or BLOCKED with corrective actions.
