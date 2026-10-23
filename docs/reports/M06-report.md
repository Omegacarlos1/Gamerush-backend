# M06 milestone report

## Summary

- Milestone: M06 — Score verification and anti-cheat
- Date: 2026-10-23 (Africa/Lagos)
- Branch: `feature/M06-score-verification`
- Starting merged M05 commit: `86ba28c`
- Implementation/docs commit verified by CI: `d8befc07f62f6ff8768f00fb121e89d3264d1a4b`
- Commits: `00f5599` implementation, `d6b24e3` tests, `d8befc0` documentation
- Local runtime: Node.js 24.19.0, npm 11.17.0
- Local engine: XAMPP MariaDB 10.4.32
- Production/CI engine: MySQL 8.4
- Status: **PASS**

## Prerequisite verification

GitHub `main` was independently confirmed at merge commit `86ba28c7775b77d084e94d5a61722bbb3c0cc83a` (PR #6, M05) before implementation. M05 workflow run `39587769907` was independently confirmed `completed/success` for `d805966fd2172136c5622dc04f0e7214c78d53b6`. The inherited M05 baseline passed locally: format, lint, strict typecheck, 65 tests, and production build.

## Scope delivered

- Strict bounded `runner-evidence-v1` with fixed version/credential presentation, contiguous event sequences, strictly increasing ticks, allowlisted empty-payload inputs, terminal condition, untrusted claims, 1,024-event bound, and 64 KiB route bound.
- Injected deterministic `runner-score-v1` verifier with 20 Hz simulation, seed-derived xorshift32 track generation, lane/jump plausibility, first-collision/timeout validation, server-derived finish time, impossible elapsed-time rejection, and authoritative `metres + 10 * coins` scoring.
- Authenticated, signed-CSRF-protected, separately rate-limited `POST /api/v1/game-sessions/:sessionId/scores` with required bounded `Idempotency-Key`, constant-time seed/nonce hash comparison, owner/ranked/active/unexpired checks, and no plaintext credential persistence/logging.
- One locked transaction for lifecycle, ordered events, non-authoritative submission, terminal outcome, verified score, active policy calculation, gameplay XP ledger, and cached profile progression. Five injectable persistence-stage failures demonstrate full rollback to retryable `active` state.
- Terminal safe rejection codes for structurally valid credential/version/replay/claim failures. Malformed transport input persists nothing. Practice returns an explicit non-rewarding conflict.
- Exactly-once accepted gameplay XP using `gameplay:<session UUID>`. Identical idempotency returns the original result; drift/subsequent submissions conflict. Zero calculated XP is an explicit no-ledger/profile-update no-op.
- Authenticated owner-only `GET /api/v1/score-submissions/:submissionId` with safe accepted/rejected fields and indistinguishable unknown/other-owner 404 behavior.
- OpenAPI 0.6.0, six-request Postman collection/examples, deterministic contract/threat model, architecture/data/progression/session/security/runbook updates, M06 specification, and M07 handoff.

No migration was added or changed. M06 adds no character unlock, leaderboard, achievement/reward, admin-review, payment, stake, wallet, or cash behavior.

## API contract

| Method | Path                                      | Authentication                                     | Result                                                           |
| ------ | ----------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| `POST` | `/api/v1/game-sessions/:sessionId/scores` | Access + refresh/CSRF cookies/header + idempotency | `201` accepted, `422` terminal rejection, `200` identical replay |
| `GET`  | `/api/v1/score-submissions/:submissionId` | Access cookie                                      | Owner-scoped safe processing/result state                        |

Structurally valid rejections are terminal. Server/policy failures roll back and may be retried with the same idempotency key. Practice submissions never persist evidence/result or create downstream effects.

## Acceptance evidence

| Criterion                  | Verdict | Evidence                                                                                                                                 |
| -------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic acceptance   | PASS    | Recomputed metres/coins/score, server tick-derived finish time, one score, exact `floor(score/10)` XP, and safe retrieval asserted       |
| Credential/version binding | PASS    | Wrong seed, wrong nonce, and wrong rules/version persist coarse terminal rejection with no score/XP                                      |
| Event/timing integrity     | PASS    | Reordered/duplicate/invalid events fail shape validation; impossible lane actions, terminal state, and too-fast simulation reject        |
| Boundary security          | PASS    | Missing auth/CSRF/idempotency, other owner, practice, expiry, terminal state, payload size, and rate limits asserted                     |
| Idempotency/replay         | PASS    | Identical request returns original result; drift conflicts; second key/digest creates no second effect                                   |
| Concurrency                | PASS    | Five identical requests serialize to one `201` plus four `200`; conflicting race yields one terminal result and one `409`                |
| Atomicity                  | PASS    | Forced failures after submission, events, verified score, XP ledger, and profile update leave session active and all effect counts zero  |
| Zero-XP policy             | PASS    | A score below the active policy ratio accepts with `xpAwarded: 0`, no ledger row, and no profile update                                  |
| Privacy/observability      | PASS    | Response/log scans exclude raw/hash credentials and evidence; retrieval omits claims/digest/internal fields; rejection logging is coarse |
| M01–M05 regression         | PASS    | Complete isolated MariaDB suite: 75 passing, 0 failing, 0 pending                                                                        |
| MySQL 8.4                  | PASS    | GitHub Actions run `39922819517` completed successfully for exact commit `d8befc0`                                                       |

## Executed checks

| Command/check                       | Exit | Result                                                                                                    |
| ----------------------------------- | ---: | --------------------------------------------------------------------------------------------------------- |
| M05 baseline `npm run format:check` |    0 | All matched files formatted                                                                               |
| M05 baseline `npm run lint`         |    0 | 0 errors, 0 warnings                                                                                      |
| M05 baseline `npm run typecheck`    |    0 | Strict TypeScript passed                                                                                  |
| M05 baseline `npm test`             |    0 | 65 passing                                                                                                |
| M05 baseline `npm run build`        |    0 | Production build passed                                                                                   |
| Final `npm run format:check`        |    0 | All matched files formatted                                                                               |
| Final `npm run lint`                |    0 | 0 errors, 0 warnings                                                                                      |
| Final `npm run typecheck`           |    0 | Strict TypeScript passed                                                                                  |
| Final `npm test`                    |    0 | 75 passing in 10 seconds; 0 failing, 0 pending                                                            |
| Final `npm run build`               |    0 | Production TypeScript build passed                                                                        |
| `npm audit --audit-level=high`      |    0 | 0 vulnerabilities with approved registry/cache access                                                     |
| OpenAPI/Postman checks              |    0 | OpenAPI 3.1/API 0.6.0 with 16 paths; Postman v2.1 with 6 requests; both Prettier-parse clean              |
| Focused M06 suite                   |    0 | 10 passing                                                                                                |
| Focused concurrency repetition      |    0 | Serialization case passed five consecutive executions on final committed code                             |
| `git diff --check`                  |    0 | No whitespace errors                                                                                      |
| GitHub Actions MySQL 8.4            |    0 | Run `39922819517`: install, trigger setup, format, lint, typecheck, tests, build, and audit all succeeded |

Coverage tooling is not configured, so no coverage percentage is claimed.

## Resolved failures and fixes

- Initial local `git fetch` could not write `.git/FETCH_HEAD` inside the sandbox. Approved Git access updated refs; the M06 branch was safely fast-forwarded to merged M05 while preserving unrelated worktree changes.
- The first focused concurrency test reused a five-request limiter before its conflicting-race half and received 429 instead of the expected terminal/conflict pair. The concurrency fixture now uses an explicit 20-request test limit; the production default remains five/minute.
- Final review found that deterministic duration was bounded but not compared with server elapsed time. M06 now rejects a derived finish later than receipt/session expiry; a regression case proves the too-fast submission is terminally rejected.
- The first timing-enabled focused rerun had three test-fixture expectation/config failures (double-counted finish time, timeout exactly at expiry, and test limiter exhaustion). The finish assertion now uses server start, zero-XP uses a high active policy ratio, and validation tests use a dedicated test limit. The rerun passed 10/10.
- The first sandboxed dependency audit could not reach the registry/cache and produced no vulnerability verdict. The identical approved-access command returned 0 vulnerabilities.

## Security and known risks

- Deterministic replay detects tampering, replay, incompatible versions, impossible input/timing, and fabricated claims; it cannot prove that valid input came from a human. Bot/behavior detection remains a launch hardening concern.
- Same-origin script compromise can observe the one-time seed/nonce. Frontend CSP, dependency integrity, TLS, and XSS hardening remain required.
- Score and session limiters are process-local. Horizontal deployment requires a shared store and reviewed proxy settings.
- Raw ordered input evidence is retained in the database for integrity/audit but has no public route. Formal retention/deletion policy remains a launch decision.
- `timeout` ends at the exact fixed session cap; the current active/unexpired receipt rule normally makes collision the practical online completion path. Any future grace policy must be explicit and cannot affect leaderboard period rules silently.

## Documentation and AGENTS.md changes

- OpenAPI remains authoritative; Postman provides runnable positive/negative examples without committed credential values.
- Added `docs/score-verification.md`, M06 specification/report, and the M07 handoff prompt.
- Updated README, architecture, data model/migrations, progression, game-session, authentication, and environment documentation.
- Added durable AGENTS.md conventions for deterministic trust boundaries, atomic score/XP effects, terminal/retryable outcomes, practice exclusion, and replay privacy.

## Reviewer checklist and verdict

- [x] M06 scope only; no forbidden future feature
- [x] M05 merge and MySQL 8.4 prerequisite independently verified
- [x] Strict evidence/version/credential/session boundary implemented
- [x] Required positive, negative, idempotency, concurrency, rollback, and leakage cases pass
- [x] Existing migrations remain byte-for-byte unchanged
- [x] MariaDB local and MySQL 8.4 CI evidence pass
- [x] OpenAPI, Postman, threat model, milestone docs, report, and M07 handoff supplied
- [x] Unrelated DOCX deletion/untracked Markdown preserved and excluded from commits

**Verdict: PASS.** M06 is ready for review. Do not merge or begin M07 until M06 is explicitly approved.

## Pull request description

### What changed

Implemented strict `runner-evidence-v1` submission and deterministic `runner-score-v1` replay for owned ranked sessions. Added credential/version/timing/action validation, canonical digest/idempotency, safe terminal rejection codes, one authoritative score per session, atomic gameplay XP/cached progression, zero-XP no-op, owner-only result retrieval, dedicated limits/observability, and five-stage rollback verification. Added 10 M06 integration scenarios plus OpenAPI, Postman, browser algorithm/threat model, architecture/security/data/progression docs, and the M07 handoff. No migration or out-of-scope reward/leaderboard/admin/payment feature was added.

### Validation

Locally on XAMPP MariaDB 10.4.32: formatting, lint, strict typecheck, 75 Mocha tests, production build, high-severity audit, OpenAPI/Postman parsing, and five repeated concurrent-submission checks pass. GitHub Actions run `39922819517` passes the complete workflow on MySQL 8.4 for `d8befc0`.

### Risks

Replay validation does not distinguish bots from humans; one-time browser credentials still depend on frontend XSS/CSP hardening; submission/session limiters need a shared store before horizontal scale; replay retention policy remains to be approved; and exact-cap timeout/grace behavior must remain explicit in any future change.
