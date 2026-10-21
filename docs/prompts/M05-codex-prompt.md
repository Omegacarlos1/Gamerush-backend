# M05 — Games and sessions

CODEX PROMPT — COPY THIS ENTIRE SECTION

You are a principal backend engineer implementing PlayRush. Work only on M05 after M04 is explicitly approved and merged. First inspect `AGENTS.md`, the approved PRD, every prior milestone/report, all seven immutable migrations, `docs/security/authentication.md`, `docs/progression.md`, the OpenAPI contract, current source/tests/CI, and Git status. Verify M04 locally and confirm its MySQL 8.4 CI result rather than assuming acceptance.

## Current foundation

- Node 24+, strict TypeScript/ESM, Express 5 modular monolith, MySQL/MariaDB repositories/transactions, safe errors/logging, and `/api/v1` routes.
- M03 provides verified accounts, live cookie/session authorization, refresh rotation, signed session-bound CSRF, and player/admin role checks.
- M04 provides deterministic self-profiles, strict display-field updates, private stable XP history, an active database progression policy service, and internal idempotent/concurrency-safe XP awards. XP awards have no HTTP route.
- Seven migrations already define games, immutable game versions/rules, characters, game sessions/events, score submissions, verified scores, progression, leaderboards, rewards, and audit records. Never edit an applied migration; add an ordered migration only if the approved schema is demonstrably insufficient.

## Objective

Provide a versioned public game catalog and authenticated server-issued game sessions with secure ownership and state transitions. Prepare score-verification interfaces without implementing score acceptance, XP awards from gameplay, leaderboards, achievements, weekly rewards, admin management workflows, payments, or cash features.

## Implementation requirements

1. Add public `GET /api/v1/games` and `GET /api/v1/games/:gameId` endpoints that expose only active games and published immutable version/rules metadata. Draft/retired games and versions must not leak.
2. Add authenticated `POST /api/v1/games/:gameId/sessions` with CSRF protection. Select only the game's active published version and issue a cryptographically random seed/nonce while persisting only approved hashes where the schema requires them.
3. Add authenticated `GET /api/v1/game-sessions/:sessionId`, strictly scoped to the owning player. Define the response fields needed by a Phaser/browser client without exposing hashes or another player's private state.
4. Enforce server-side UTC start/expiry using the immutable version duration cap, allowed mode values, account/session ownership, rate limits, and explicit lifecycle transitions. Never accept browser start/completion timestamps, game version overrides, scores, XP, or status.
5. Define injected session/score-verification ports for M06, but do not create a score submission endpoint or treat any browser score/evidence as authoritative in M05.
6. Decide and document duplicate active-session behavior, session retrieval after expiry, public catalog cache semantics, nonce/seed delivery rules, and any schema gap. Preserve M04 profile/progression behavior.

## Mandatory acceptance tests

- List/detail returns active game plus published active version and hides draft/retired records.
- Create a ranked/practice session for the authenticated owner with server time, bounded expiry, unique public ID, cryptographic material, and fixed game/version.
- Reject unauthenticated or non-CSRF creation, unknown/hidden game, client version/status/time/score/XP fields, and invalid mode.
- Enforce duplicate/reuse policy, ownership isolation, expired-session behavior, and valid/invalid lifecycle transitions.
- Prove persisted hashes do not reveal delivered seed/nonce material and responses/logs contain no stored secret hashes.
- Concurrent session creation cannot bypass the chosen duplicate/rate policy.
- Existing M01–M04 tests remain passing on the isolated MariaDB schema. Run format, lint, strict typecheck, complete tests, production build, high-severity audit, OpenAPI/Postman parsing, and MySQL 8.4 CI; record exact commands, counts, failures, and fixes.

## Documentation and handoff

- Update OpenAPI and create `docs/postman/M05-examples.md` plus importable `docs/postman/M05.postman_collection.json` with positive and negative examples.
- Create `docs/milestones/M05.md`, `docs/reports/M05-report.md`, a browser/session integration contract and state diagram, and `docs/prompts/M06-codex-prompt.md` based on actual repository state.
- Update README, architecture, data-model/migration docs, and `AGENTS.md` only for durable behavior.
- Preserve unrelated user changes, use a dedicated M05 feature branch, make scoped conventional commits, push only after successful verification, provide a pull-request description, and stop.

Do not merge or begin M06 without explicit approval. Mark M05 PASS only when every acceptance criterion is evidenced; otherwise report FAIL or BLOCKED with corrective actions.
