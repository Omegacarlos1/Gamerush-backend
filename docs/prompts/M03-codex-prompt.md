# M03 — Identity and access

CODEX PROMPT — COPY THIS ENTIRE SECTION

You are a principal backend engineer implementing PlayRush. Work only on M03 after explicit approval. First inspect `AGENTS.md`, the approved PRD, `docs/reports/M01-report.md`, `docs/reports/M02-report.md`, `docs/database/data-model.md`, every applied migration, current source/tests/CI, and Git status. Verify M02 acceptance rather than assuming it passed, including the MySQL 8.4 CI result if it was previously an acceptance gap.

## Current foundation

- Node 24+, strict TypeScript 6, ECMAScript modules, Express 5 modular monolith, versioned `/api/v1`, validated configuration, structured/redacted Pino logs, safe errors, request IDs, security headers, controlled CORS, rate limits, and body limits.
- `mysql2` pool and explicit transactions are available. Local development is XAMPP MariaDB 10.4; production/CI target is MySQL 8.4.
- Seven checksum-verified migrations define roles/users, hashed auth sessions/tokens, profiles, game/version/session evidence, verified scores, append-only XP, weekly competition, achievements/rewards, moderation, and append-only admin audits.
- Migration status/up/down and deterministic seed commands exist. Down/seed refuse production and non-development/test database names.
- M02 contains no identity HTTP behavior and seeds no usable accounts or credentials.

## Objective

Implement secure account registration, email-verification token lifecycle boundaries, login, refresh rotation, logout, current-user access, role authorization, and account-state enforcement using the existing schema. Do not implement profiles, XP awarding, gameplay, leaderboards, or administration features beyond one minimal protected authorization probe if required for acceptance.

## Implementation requirements

1. Add validated schemas and versioned routes for register, login, refresh, logout, and current user. Normalize email/username consistently and preserve database uniqueness as the final race-safe enforcement.
2. Hash passwords using a currently supported adaptive password hashing library with documented parameters. Never store or log plaintext passwords or tokens.
3. Use short-lived signed access tokens and random rotating refresh tokens. Store only refresh-token hashes in `auth_sessions`; enforce expiry, revocation, token-family reuse detection, and replacement linkage transactionally.
4. Use Secure, HttpOnly cookie transport with an explicit SameSite/CSRF strategy. Development exceptions must be configuration-controlled and may not weaken production defaults.
5. Implement single-use email-verification token persistence using hashed values and expiry. If no email provider is approved, expose the delivery dependency through an interface and deterministic test adapter; do not invent or integrate a vendor.
6. Enforce account status and verified-email requirements where the PRD requires them. Add player/admin authorization middleware and a minimal authorization test route only if needed to prove denial; do not build the admin module.
7. Prevent user enumeration through login/reset-style responses, add login/registration throttling, and log only safe security event metadata.
8. Use repositories/services/controllers with parameterized SQL and transactions. Add a new ordered migration only if the approved M02 schema is insufficient; never edit an applied migration.

## Mandatory acceptance tests

- Registration success, normalized uniqueness, duplicate email/username races, weak/invalid input, and secret non-disclosure.
- Password hashes verify correctly and plaintext never persists.
- Login success; wrong email/password responses do not enumerate users; suspended/deleted/unverified behavior matches the documented policy.
- Access token valid/invalid/expired cases and current-user endpoint.
- Refresh success, rotation, old-token replay detection, family revocation, expiry, and concurrent refresh safety.
- Logout revokes the session and is idempotent.
- Player/admin allow/deny behavior and account-status enforcement.
- Rate-limit behavior for abuse-sensitive endpoints.
- Email-verification token is hashed, expires, and works once using a test delivery adapter.
- All database tests use the isolated test schema, preserve migration integrity, and leave no production data changes.
- Existing M01/M02 tests remain passing. Run format, lint, strict typecheck, complete tests, build, high-severity audit, MariaDB integration, and MySQL 8.4 CI; record exact results/counts and failures.

## Documentation and handoff

- Update OpenAPI and create `docs/postman/M03-examples.md` plus an importable M03 Postman collection with positive/negative cases, cookie handling, variables, and prerequisites.
- Create `docs/milestones/M03.md`, `docs/reports/M03-report.md`, security/token transport documentation, and `docs/prompts/M04-codex-prompt.md` based on actual repository state.
- Update README, architecture, migrations, and `AGENTS.md` only where durable policies change.
- Inspect Git state/remotes, preserve unrelated changes, make scoped conventional commits, push the M03 feature branch after successful verification, provide a pull-request description, and stop.

Do not merge or begin M04 without explicit approval. Mark M03 PASS only when every acceptance criterion is evidenced; otherwise report FAIL or BLOCKED with corrective actions.
