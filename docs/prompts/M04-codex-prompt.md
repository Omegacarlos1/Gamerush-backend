# M04 — Profiles and XP ledger

CODEX PROMPT — COPY THIS ENTIRE SECTION

You are a principal backend engineer implementing PlayRush. Work only on M04 after M03 is explicitly approved and merged. First inspect `AGENTS.md`, the approved PRD, all prior milestone reports, `docs/security/authentication.md`, the OpenAPI contract, every applied migration, current source/tests/CI, and Git status. Verify M03 locally and confirm its MySQL 8.4 CI result rather than assuming acceptance.

## Current foundation

- Node 24+, strict TypeScript/ESM, Express 5 modular monolith, MySQL/MariaDB repository/transaction infrastructure, safe errors/logging, security middleware, and `/api/v1` routing.
- Seven immutable migrations already define `player_profiles`, append-only `xp_ledger`, versioned progression policies, cosmetic unlock persistence, and all M02 entities. M03 added no migration.
- M03 provides normalized registration, hashed single-use email verification, Argon2id passwords, cookie-backed signed access tokens, rotating hashed refresh tokens, family replay revocation, signed CSRF protection, live account/session/role enforcement, logout, current user, and player/admin authorization.
- Authenticated application routes must use the existing middleware and cookie/CSRF policy. Do not return or log credentials or tokens.
- No email vendor is approved; automated identity tests use the deterministic verification-delivery adapter. Do not add a provider in M04.

## Objective

Implement player profiles and server-controlled XP progression with auditable, idempotent, concurrency-safe transactions. Do not implement gameplay score verification, public leaderboards, achievements, weekly rewards, administration workflows, password reset, or payments.

## Implementation requirements

1. Add authenticated `GET /api/v1/players/me` and `PATCH /api/v1/players/me` endpoints. Create the profile deterministically when appropriate and allow only approved display fields. Never accept role, status, total XP, level, scores, unlocks, or another user ID from the client.
2. Add authenticated, paginated `GET /api/v1/players/me/xp-history` with stable cursor/order semantics and no other player's private data.
3. Put progression calculation behind an injected policy service loaded from the active versioned database policy. Preserve the approved formulas: XP is awarded only from trustworthy server inputs; level is `1 + floor(total XP / 500)` for the M02 policy.
4. Implement an internal-only XP award use case. Validate an allowlisted server source, require a unique idempotency key, append one ledger record, and update the cached profile total/level in the same transaction.
5. Lock the profile row or use an equally strong atomic concurrency strategy so simultaneous awards cannot lose updates. A repeated idempotency key must return the original effect without another award.
6. Keep `xp_ledger` append-only. Corrections are new signed/authorized adjustment entries; M04 need not expose an administrator correction endpoint.
7. Decide and document profile field limits, privacy exposure, pagination bounds, progression-policy selection, and behavior for missing/retired policies. Add a new ordered migration only if the approved schema is demonstrably insufficient; never edit M01–M02 migrations.

## Mandatory acceptance tests

- Read and update the authenticated player's allowed profile fields.
- Reject unauthenticated access, unknown fields, attempts to edit XP/level/role/status/score/unlocks, and any other-player edit path.
- Profile creation is deterministic and race-safe.
- XP awards calculate level boundaries correctly at 0, 499, 500, and multiple-level totals.
- Duplicate idempotency keys do not award twice and return a consistent result.
- Concurrent distinct awards preserve the exact ledger sum, cached total, and level.
- Forced persistence failure rolls back both ledger and profile changes.
- Untrusted/unknown source types and client-facing XP award attempts are rejected or absent.
- XP update/delete remains blocked by append-only triggers.
- Pagination is stable, bounded, and does not leak another user's history.
- Existing M01–M03 tests remain passing on the isolated MariaDB schema. Run format, lint, strict typecheck, complete tests, production build, high-severity audit, Postman/OpenAPI parsing, and MySQL 8.4 CI; record exact commands, counts, failures, and fixes.

## Documentation and handoff

- Update OpenAPI and create `docs/postman/M04-examples.md` plus importable `docs/postman/M04.postman_collection.json` with positive and negative cookie-authenticated examples.
- Create `docs/milestones/M04.md`, `docs/reports/M04-report.md`, progression/privacy documentation, and `docs/prompts/M05-codex-prompt.md` based on actual repository state.
- Update README, architecture, data-model/migration docs, and `AGENTS.md` only where durable behavior changes.
- Inspect Git state/remotes, preserve unrelated user changes, use a dedicated M04 feature branch and scoped conventional commits, push only after successful verification, provide a pull-request description, and stop.

Do not merge or begin M05 without explicit approval. Mark M04 PASS only when every acceptance criterion is evidenced; otherwise report FAIL or BLOCKED with corrective actions.
