# M05 milestone report

## Summary

- Milestone: M05 — Games and sessions
- Date: 2026-10-21 (Africa/Lagos)
- Branch: `feature/B05-games-sessions`
- Starting/merged M04 commit: `2e01742`
- Implementation/docs commit verified by CI: `d805966`
- Local runtime: Node.js 24.19.0, npm 11.17.0
- Local engine: XAMPP MariaDB 10.4.32
- Production/CI target: MySQL 8.4
- Status: **PASS**

## Prerequisite verification

GitHub PR #5 was confirmed closed and merged at `2e017423d76ee626099f1b360f0eac180500b677` on 2026-10-21. Its merge-commit `backend-ci` run `39585348483` completed successfully before M05 implementation. The inherited M04 baseline also passed locally: format, lint, strict typecheck, 56 tests, and production build.

## Scope delivered

- Public `GET /api/v1/games` and `GET /api/v1/games/:gameId` with active-game/published-active-version filtering, immutable rules/duration metadata, active cosmetic characters, hidden-record 404 behavior, and bounded public cache headers.
- Authenticated, signed-CSRF-protected `POST /api/v1/games/:gameId/sessions` accepting only `practice` or `ranked`, with dedicated issuance throttling.
- Server-selected and transaction-locked active version, server UTC start/expiry, application-issued UUID, independent 256-bit seed/nonce values, SHA-256-only persistence, and one-time `no-store` credential delivery.
- One open session per player/game/mode through active-user row serialization, stale open-session expiry, explicit duplicate conflict, and concurrency-safe creation without a schema-specific partial index.
- Authenticated owner-only `GET /api/v1/game-sessions/:sessionId`, safe allowlisted fields, automatic boundary expiry, `no-store`, and indistinguishable unknown/other-owner 404 behavior.
- Explicit internal lifecycle transition rules plus transaction-scoped M06 `SessionVerificationPort` and injected `ScoreVerificationPort` contracts.
- Environment configuration, safe structured-log redaction, OpenAPI 0.5.0, importable Postman examples, Phaser/browser contract and state diagram, architecture/data/security/runbook updates, M05 specification, and M06 handoff.

No score/evidence submission, score acceptance, gameplay XP, character unlock, personal-best update, leaderboard, achievement, weekly reward, administration workflow, password reset, payment, staking, wallet, or cash behavior was added. M05 requires no schema change and leaves migrations `0001`–`0007` unchanged.

## API contract and decisions

| Method | Path                               | Authentication                       | Purpose                                                 |
| ------ | ---------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| `GET`  | `/api/v1/games`                    | Public                               | List active games with selected published rules/version |
| `GET`  | `/api/v1/games/:gameId`            | Public                               | Read one visible game configuration                     |
| `POST` | `/api/v1/games/:gameId/sessions`   | Access + refresh/CSRF cookies/header | Issue/start a fixed practice or ranked session          |
| `GET`  | `/api/v1/game-sessions/:sessionId` | Access cookie                        | Read only the current player's safe session state       |

- Catalog responses use `public, max-age=60, stale-while-revalidate=30`. Creation always re-reads the current database selection, so cached discovery never chooses a version.
- Creation transitions `issued -> active` inside one transaction; the browser observes an immediately running `active` session.
- Open duplicate scope is player + game + mode and includes `issued`, `active`, and `submitted`. Practice and ranked can coexist.
- Seed and nonce are returned only by creation. Retrieval after credential loss does not replay them.
- Owned expiry is returned as `200` with `status: expired`; unknown and another owner's UUID both return `404 GAME_SESSION_NOT_FOUND`.
- Allowed internal transitions are `issued -> active|expired|abandoned`, `active -> submitted|expired|abandoned`, and `submitted -> accepted|rejected`. Terminal states reject transitions.
- Session responses never include database IDs, seed/nonce hashes, another owner, or credentials after creation. M05 deliberately has no score route.

## Acceptance evidence

| Criterion                | Verdict | Evidence                                                                                                                                                    |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visible catalog          | PASS    | List/detail return seeded active game, published rules/version, and three active cosmetics                                                                  |
| Hidden catalog records   | PASS    | Draft/retired games and draft/retired selected versions all return no public listing/detail                                                                 |
| Server-issued sessions   | PASS    | Ranked/practice assertions cover unique UUIDs, fixed version, exact server start, 300-second expiry, and independent 43-character credentials               |
| Strict creation boundary | PASS    | Missing auth/CSRF, hidden/unknown game, invalid mode, and client version/status/start/finish/score/XP fields are rejected                                   |
| Hash-only persistence    | PASS    | Stored SHA-256 values match delivered material while raw values differ and are absent from persistence-shaped responses                                     |
| Secret/log safety        | PASS    | Creation/retrieval response scans and structured-log capture contain neither stored hashes nor delivered credentials; redaction tests cover new field names |
| Duplicate/reuse policy   | PASS    | Same-mode open duplicate conflicts; practice/ranked coexist; credential replay is unavailable                                                               |
| Concurrency              | PASS    | Five simultaneous same-mode creates yield exactly one 201 and four 409 responses; focused case passed five repeated runs                                    |
| Ownership isolation      | PASS    | Owner gets safe state; second authenticated player and missing auth cannot retrieve it                                                                      |
| Expiry                   | PASS    | Exact expiry boundary atomically returns `expired`, persists the state, and allows a replacement                                                            |
| Lifecycle                | PASS    | Active → submitted → accepted succeeds internally; terminal → abandoned conflicts; score route remains 404                                                  |
| Rate limiting            | PASS    | Configured one-request limit returns `GAME_SESSION_RATE_LIMIT_EXCEEDED` on the next otherwise valid create                                                  |
| M01–M04 regression       | PASS    | Complete local suite reports 65 passing, 0 failing, 0 pending                                                                                               |
| MariaDB 10.4             | PASS    | Complete suite passed on isolated `playrush_migrations_test`                                                                                                |
| MySQL 8.4                | PASS    | GitHub Actions run `39587769907` passed the complete workflow for `d805966`                                                                                 |

## Executed checks

| Command                          | Exit | Result                                                                            |
| -------------------------------- | ---: | --------------------------------------------------------------------------------- |
| Inherited `npm run format:check` |    0 | M04 baseline formatting passed                                                    |
| Inherited `npm run lint`         |    0 | M04 baseline: 0 errors, 0 warnings                                                |
| Inherited `npm run typecheck`    |    0 | M04 baseline strict TypeScript passed                                             |
| Inherited `npm test`             |    0 | M04 baseline: 56 passing                                                          |
| Inherited `npm run build`        |    0 | M04 baseline production build passed                                              |
| Focused M05 Mocha run            |    0 | 9 passing                                                                         |
| `npm run format:check`           |    0 | All matched files use Prettier style                                              |
| `npm run lint`                   |    0 | 0 errors, 0 warnings                                                              |
| `npm run typecheck`              |    0 | Strict TypeScript check passed                                                    |
| `npm test`                       |    0 | 65 passing, 0 failing, 0 pending in 11 seconds                                    |
| `npm run build`                  |    0 | Production TypeScript build passed                                                |
| `npm audit --audit-level=high`   |    0 | 0 vulnerabilities after approved live registry/cache access                       |
| OpenAPI/Postman parse command    |    0 | OpenAPI 3.1/version 0.5.0 with 14 paths; Postman v2.1 collection with 12 requests |
| Focused concurrency repetition   |    0 | Five-create serialization case passed five consecutive executions                 |
| `git diff --check`               |    0 | No whitespace errors                                                              |

GitHub Actions run [`39587769907`](https://github.com/Omegacarlos1/Gamerush-backend/actions/runs/39587769907) passed dependency installation, MySQL trigger setup, format, lint, strict typecheck, the complete 65-test suite, production build, and high-severity audit against MySQL 8.4 for commit `d805966`.

## Closeout re-verification — 2026-10-23

Before committing this report, the current `d805966` worktree was verified again on Node.js 24.19.0 and XAMPP MariaDB 10.4.32:

| Command or check                                 |            Exit | Result                                                                                                                                  |
| ------------------------------------------------ | --------------: | --------------------------------------------------------------------------------------------------------------------------------------- |
| Initial `npm run format:check`                   |               1 | Found formatting drift only in this previously untracked report; the report was formatted with Prettier                                 |
| `npm run format:check` after formatting          |               0 | All matched files use Prettier style                                                                                                    |
| `npm run lint`                                   |               0 | 0 errors and 0 warnings                                                                                                                 |
| `npm run typecheck`                              |               0 | Strict TypeScript check passed                                                                                                          |
| `npm run build`                                  |               0 | Production TypeScript build passed                                                                                                      |
| Initial `npm test` while MariaDB was stopped     | 8 test failures | 18 tests passed; all eight failures were setup/cleanup/connectivity failures with `ECONNREFUSED 127.0.0.1:3306`, not assertion failures |
| `npm test` after starting XAMPP MariaDB          |               0 | 65 passing, 0 failing, 0 pending in 8 seconds                                                                                           |
| Initial sandboxed `npm audit --audit-level=high` |               1 | Registry/cache access failed, so this produced no vulnerability verdict                                                                 |
| Approved-access `npm audit --audit-level=high`   |               0 | 0 vulnerabilities                                                                                                                       |
| OpenAPI/Postman structure check                  |               0 | OpenAPI 3.1.0/API 0.5.0 with 14 paths; Postman v2.1 with 12 requests                                                                    |
| `git diff --check`                               |               0 | No whitespace errors                                                                                                                    |

This closeout run exercised the local MariaDB target. The MySQL 8.4 evidence remains GitHub Actions run `39587769907` for implementation/docs commit `d805966`; the report-only closeout commit does not change runtime code or the API contract.

## Resolved implementation-time failures

- The first post-implementation lint reported unused database-ID destructuring and unsafe/type-import patterns in the new tests. Public mapping was changed to explicit allowlisted construction, the log stream conversion was type-guarded, and `ResultSetHeader` became a normal type import; the rerun had zero lint findings.
- The first dependency audit could not access the restricted registry/npm cache and returned an audit-endpoint error without a vulnerability result. The identical command was rerun with approved registry/cache access and reported zero vulnerabilities.
- A documentation patch initially missed the exact existing authentication paragraph and made no change. It was reapplied in smaller verified patches; formatting and parsing then passed.

## Security and integrity notes

- Live M03 account/session state is checked before every protected request; session creation also locks and rechecks that the account is active and verified.
- Strict request schemas reject browser control over owner, version, state, timestamps, score, XP, and cryptographic material.
- Server randomness uses Node's cryptographic generator. Seed and nonce are independent 32-byte values; SHA-256 is appropriate for these high-entropy secrets.
- Raw credential values cross the response boundary once and are marked `no-store`. Pino HTTP does not log bodies, application events contain only public IDs/mode, and explicit field redaction covers seed/nonce/hash names.
- User-row locking plus transactional stale expiry/open lookup/insert prevents concurrent duplicate issuance on both MariaDB and MySQL.
- Retrieval scopes the SQL query by owner before mapping, preventing enumeration of another player's private session state.
- Browser evidence remains entirely untrusted. The M06 interfaces do not accept or persist anything in M05.

## Documentation and AGENTS.md changes

- OpenAPI remains authoritative; Postman supplies runnable cookie/CSRF positive and negative examples without storing seed/nonce collection variables.
- Added the browser/Phaser integration contract and Mermaid lifecycle state diagram, M05 specification, this report, and the copy-ready M06 score-verification prompt.
- Updated architecture, authentication, data-model/migration, README, and environment documentation.
- Added durable AGENTS.md conventions for visible catalog filtering, server-owned session fields, one-time/hash-only credentials, transactional duplicate/ownership/expiry controls, and non-authoritative browser evidence.

## Known risks and limitations

- The issuance limiter is process-local. Horizontal deployment requires a shared store and reviewed trusted-proxy settings.
- Losing one-time seed/nonce material prevents the browser from completing that run. M05 has no abandon endpoint, so a same-mode replacement becomes available only after server expiry.
- A future `submitted` session is considered open and does not age out automatically; M06 must resolve it to accepted/rejected or add an explicit safe recovery policy so interrupted verification cannot block indefinitely.
- Catalog cache staleness is bounded but intentional. The creation response, not cached catalog data, is authoritative for the run.
- Browser-held credentials remain exposed to same-origin script compromise. Frontend CSP, dependency integrity, and XSS hardening remain release requirements.
- No anti-cheat or deterministic replay is implemented yet; an issued session is not a verified score and cannot award XP or enter rankings.

## Reviewer checklist and verdict

- [x] M05 scope only
- [x] Mandatory public/session/security/concurrency paths tested on isolated MariaDB
- [x] M01–M04 regression suite remains passing
- [x] MySQL 8.4 CI passes for the pushed implementation/docs commit
- [x] OpenAPI, Postman, browser/state contract, report, and M06 handoff supplied
- [x] No applied migration modified and no unresolved blocking defect

**Verdict: PASS.** M05 is ready for review. Do not merge or begin M06 until M05 is explicitly approved.

## Pull request description

### What changed

Added a public active/published game catalog and owner-scoped server game sessions with strict practice/ranked input, signed CSRF, a dedicated rate limiter, server UTC duration, fixed immutable rules/version, one-time 256-bit seed/nonce delivery, SHA-256-only persistence, transactionally serialized duplicate policy, automatic expiry, explicit internal lifecycle transitions, and M06 verification ports. Added 9 M05 integration scenarios, OpenAPI/Postman, browser/state-machine documentation, architecture/security/runbook updates, and the M06 handoff. No score, XP, leaderboard, reward, admin, payment, or cash feature was added.

### Validation

Locally on XAMPP MariaDB 10.4.32: formatting, lint, strict typecheck, 65 Mocha tests, production build, high-severity audit, OpenAPI/Postman parsing, and five repeated concurrent-creation checks pass. GitHub Actions run `39587769907` passes the complete workflow on MySQL 8.4.

### Risks

Rate limiting remains process-local; lost one-time credentials require waiting for expiry; future submitted-session recovery must be defined in M06; browser credential safety depends on frontend XSS/CSP hardening; deterministic anti-cheat verification is intentionally not part of M05.
