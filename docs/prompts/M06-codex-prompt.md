# M06 — Score verification and anti-cheat

CODEX PROMPT — COPY THIS ENTIRE SECTION

You are a principal backend engineer implementing PlayRush. Work only on M06 after M05 is explicitly approved and merged. First inspect `AGENTS.md`, the approved PRD, every prior milestone/report, all seven immutable migrations, `docs/security/authentication.md`, `docs/progression.md`, `docs/game-sessions.md`, the OpenAPI contract, current source/tests/CI, and Git status. Verify M05 locally and confirm its MySQL 8.4 CI result rather than assuming acceptance.

## Current foundation

- Node 24+, strict TypeScript/ESM, Express 5 modular monolith, MySQL/MariaDB repositories/transactions, safe errors/logging, and `/api/v1` routes.
- M03 provides verified accounts, live cookie/session authorization, refresh rotation, signed session-bound CSRF, and player/admin role checks.
- M04 provides deterministic profiles, private XP history, an active versioned progression policy, and internal idempotent/concurrency-safe XP awards. XP has no browser write route.
- M05 provides a public short-cacheable active/published game catalog, one open server-issued session per player/game/mode, fixed immutable version/rules, server UTC duration, owner-only retrieval, one-time 256-bit seed/nonce delivery with hash-only persistence, explicit lifecycle transitions, dedicated issuance throttling, and transaction-scoped `SessionVerificationPort` plus injected `ScoreVerificationPort` types.
- Seven migrations already define ordered session events, non-authoritative score submissions, authoritative verified scores, append-only progression, later leaderboards/rewards, and audit records. Never edit an applied migration; add an ordered migration only if the approved schema is demonstrably insufficient.

## Objective

Build the server-authoritative deterministic score-verification pipeline for the seeded endless runner. Accept bounded untrusted evidence, bind it to an owned ranked session and its issued seed/nonce/version, recompute the result under immutable rules, persist one authoritative result, and award gameplay XP exactly once only after acceptance. Do not implement character unlocks, leaderboards, achievements, weekly rewards, admin review workflows, payments, staking, wallets, or cash features.

## Implementation requirements

1. Define and document the versioned endless-runner evidence contract: ordered input events, simulation ticks, terminal condition, seed/nonce presentation, and canonical replay digest. Validate strict shapes, monotonically increasing sequence/ticks, duration bounds, event allowlist, payload sizes/counts, and rules-version compatibility.
2. Implement authenticated, CSRF-protected `POST /api/v1/game-sessions/:sessionId/scores` with a required bounded idempotency key. The path session must belong to the live player, be ranked, active, unexpired, and fixed to the evidence version. Hash the presented seed/nonce and compare safely with stored hashes; never log or persist plaintext material.
3. Treat claimed score/metres/coins, browser completion time, status, XP, version, owner, and replay result as untrusted. Use an injected deterministic verifier to replay evidence from the issued seed and immutable rules, derive server completion time, and calculate `score = whole metres + 10 * coins` for the approved rules version.
4. Persist ordered events, a non-authoritative submission record, the accepted/rejected outcome/reason, and at most one authoritative `verified_scores` row per session. Use the session lifecycle (`active -> submitted -> accepted|rejected`) under a row lock. Decide and document whether structurally valid rejected submissions are terminal and how retriable transport/server failures differ.
5. For an accepted ranked result, calculate XP from the active versioned progression policy and atomically/idempotently persist the verified score, gameplay XP ledger effect, cached profile total/level, and session/submission outcome. Repeated identical idempotency returns the original result without duplicate score or XP; payload drift conflicts. Do not award zero XP through the positive-only M04 award interface without an explicit documented no-op policy.
6. Add authenticated owner-scoped `GET /api/v1/score-submissions/:submissionId` for accepted/rejected processing state and safe public result fields. Do not expose replay evidence, raw/hash credentials, internal database IDs/metadata, another player's submission, or suspicious-rule details useful for bypassing controls.
7. Add submission-specific rate limiting, bounded JSON/evidence limits below the global body limit where practical, safe structured observability for acceptance/rejection categories, and stable public rejection codes. Do not log raw evidence, seed/nonce, hashes, cookies, or full anti-cheat diagnostics.
8. Make practice behavior explicit. Practice sessions must never create ranked authoritative scores, XP, leaderboard input, or achievements; either reject submission clearly or persist a separately safe non-rewarding verification outcome supported by the approved schema.

## Mandatory acceptance tests

- Valid deterministic evidence recomputes expected metres/coins/score, fixes server finish time, stores one verified score, awards exact floor(score/10) XP once, and returns/retrieves a safe result.
- Reject fabricated claimed score, wrong/tampered seed or nonce, altered/reordered/duplicate events, impossible actions/ticks/timing, wrong rules/version, oversized evidence, invalid event types, unowned session, practice misuse, expired/terminal session, and missing authentication/CSRF/idempotency.
- Identical replay returns the original result; changed payload under the same idempotency key conflicts; a second digest/session submission cannot create another verified score or XP effect.
- Concurrent identical and conflicting submissions serialize deterministically and cannot bypass one-result, nonce, session-state, or XP idempotency rules.
- Forced failures at event, submission, verified-score, XP-ledger, and profile-update stages roll back every authoritative effect and leave a documented retryable state.
- Responses/logs/persistence scans prove plaintext seed/nonce and private replay evidence do not leak; rejected public details do not disclose exploitable verifier internals.
- Existing M01–M05 tests remain passing on the isolated MariaDB schema. Run format, lint, strict typecheck, complete tests, production build, high-severity audit, OpenAPI/Postman parsing, focused concurrency repetition, and MySQL 8.4 CI; record exact commands, counts, failures, and fixes.

## Documentation and handoff

- Update OpenAPI and create `docs/postman/M06-examples.md` plus importable `docs/postman/M06.postman_collection.json` with accepted, rejected, duplicate, and ownership examples.
- Create `docs/milestones/M06.md`, `docs/reports/M06-report.md`, an evidence/threat-model document with known anti-cheat limits, and `docs/prompts/M07-codex-prompt.md` based on actual repository state.
- Update README, architecture, data-model/migration, progression, game-session, and security docs plus `AGENTS.md` only for durable behavior.
- Preserve unrelated user changes, use a dedicated M06 feature branch, make scoped conventional commits, push only after successful verification, provide a pull-request description, and stop.

Do not merge or begin M07 without explicit approval. Mark M06 PASS only when every acceptance criterion is evidenced; otherwise report FAIL or BLOCKED with corrective actions.
