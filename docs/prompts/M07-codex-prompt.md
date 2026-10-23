# M07 — Characters and cosmetic unlocks

CODEX PROMPT — COPY THIS ENTIRE SECTION

You are a principal backend engineer implementing PlayRush. Work only on M07 after M06 is explicitly approved and merged. First inspect `AGENTS.md`, the approved PRD, all prior milestone/report artifacts, all seven immutable migrations, `docs/progression.md`, `docs/game-sessions.md`, `docs/score-verification.md`, the OpenAPI contract, current source/tests/CI, and Git status. Verify the merged M06 baseline locally and confirm its MySQL 8.4 CI result rather than assuming acceptance.

## Current foundation

- M03 provides verified accounts, live cookie/session authorization, refresh rotation, signed session-bound CSRF, and player/admin role checks.
- M04 provides deterministic profiles, private XP history, active versioned progression policy, and internal idempotent/concurrency-safe XP awards.
- M05 provides the public active/published game catalog and server-issued practice/ranked sessions with fixed versions, one-time seed/nonce delivery, hash-only persistence, ownership, expiry, and lifecycle controls.
- M06 provides strict `runner-evidence-v1`, injected deterministic `runner-score-v1` replay, authenticated/CSRF/idempotent score submission, terminal safe rejection outcomes, owner-only result retrieval, one authoritative score/session, and atomic exactly-once gameplay XP. Practice never earns a score or XP.
- Seven immutable migrations already define cosmetic characters, player ownership/unlocks, equipped character, and append-only progression. Never edit an applied migration; add an ordered migration only if the approved schema is demonstrably insufficient.

## Objective

Implement the cosmetic character catalog, deterministic permanent unlock evaluation at levels 3 and 5, authenticated ownership-aware inventory, and safe equip behavior. Characters must never affect deterministic gameplay, scoring, hitboxes, speed, physics, session rules, verification, XP, or competitive outcomes.

## Required behavior

1. Define public character/inventory contracts using active catalog records and safe player ownership fields.
2. Grant the starter character and level-3/level-5 unlocks transactionally and idempotently from trustworthy progression changes. Preserve the source reference and never infer unlocks from client-supplied XP/level.
3. Integrate unlock evaluation with accepted gameplay XP and existing internal XP sources without duplicating ledger, score, or unlock effects under retries/concurrency.
4. Add authenticated inventory and CSRF-protected equip endpoints. A player may equip only an owned active cosmetic character for the relevant game.
5. Keep unlock history permanent across weekly resets and later policy changes. Do not remove ownership on level/policy changes without a separately approved correction workflow.
6. Add strict validation, authorization, idempotency/concurrency tests, rollback tests, and response/log privacy checks.
7. Do not implement leaderboards, achievements, weekly rewards, admin workflows, payments, staking, wallets, cash, or gameplay advantages.

## Handoff

Update OpenAPI/Postman and architecture/data/progression/security docs; create `docs/milestones/M07.md`, `docs/reports/M07-report.md`, and `docs/prompts/M08-codex-prompt.md`. Run format, lint, strict typecheck, complete Mocha tests, production build, high-severity audit, contract parsing, focused concurrency repetition, local MariaDB, and MySQL 8.4 CI. Record exact evidence. Commit and push only after successful verification, provide a PR description, and stop without merging or starting M08.
