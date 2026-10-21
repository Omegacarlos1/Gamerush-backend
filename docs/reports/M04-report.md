# M04 milestone report

## Summary

- Milestone: M04 — Profiles and XP ledger
- Date: 2026-10-21 (Africa/Lagos)
- Branch: `feature/B04-profiles-xp-ledger`
- Starting commit: `1bb894d`
- Implementation/docs commit verified by CI: `64e7250`
- Local runtime: Node.js 24.19.0, npm 11.17.0
- Local engine: XAMPP MariaDB 10.4.32
- Production/CI target: MySQL 8.4
- Status: **PASS**

## Scope delivered

- Authenticated deterministic `GET /api/v1/players/me` profile creation/read and CSRF-protected `PATCH /api/v1/players/me` for only `displayName` and `bio`.
- Strict rejection of unknown/protected fields, other-player routes, missing authentication, and missing/invalid CSRF.
- Private `GET /api/v1/players/me/xp-history` with stable newest-first `(created_at, id)` cursor ordering, default 20/max 100 bounds, user scoping, and no ledger IDs/metadata exposure.
- Injected active database progression-policy service implementing floor score-to-XP and cumulative level calculations.
- Internal-only XP award use case with trusted-source allowlist, validated global idempotency keys, original-effect replay, payload-drift conflict, row-lock serialization, bounded deadlock retry, and atomic ledger/cache writes.
- Policy/level provenance stored in ledger metadata so later idempotent replay does not reinterpret the original effect.
- OpenAPI 0.4.0, nine-request Postman collection, progression/privacy documentation, architecture/data-model/migration/README updates, M04 specification, and M05 handoff.

No gameplay score verification, public XP write endpoint, character unlock processing, achievements, leaderboards, weekly rewards, administration workflow, password reset, email provider, payment, staking, wallet, or cash reward behavior was added. M04 requires no schema change and does not edit migrations `0001`–`0007`.

## API contract

| Method  | Path                            | Purpose                                                                        |
| ------- | ------------------------------- | ------------------------------------------------------------------------------ |
| `GET`   | `/api/v1/players/me`            | Create/read the authenticated player's own profile                             |
| `PATCH` | `/api/v1/players/me`            | Update only approved display fields with access authentication and signed CSRF |
| `GET`   | `/api/v1/players/me/xp-history` | Read the authenticated player's private stable XP history page                 |

XP award behavior exists only as an injected internal `PlayerService.awardXp` use case. There is deliberately no HTTP route.

## Policy, privacy, and integrity decisions

- Writable fields are trimmed `displayName` (1–80 or null) and `bio` (0–500 or null). XP, level, scores, roles, statuses, unlocks, character selection, user IDs, and unknown fields are rejected.
- Existing profiles remain readable/editable without an active progression policy. New profile creation and XP awards return controlled service unavailability rather than guessing a policy.
- The active policy is the latest effective non-retired row, deterministically ordered by effective time then database ID. Only the supported floor mode and positive safe-integer ratios are accepted.
- Standard internal awards allow `gameplay`, `leaderboard_reward`, and `achievement`. Adjustment/correction sources are reserved for a future explicitly authorized/audited path and are rejected by M04.
- A duplicate idempotency key returns the stored original effect only when user, amount, source, and reference match; otherwise it conflicts.
- Cursor payloads are versioned/opaque. Every history query is independently scoped to the authenticated user, and responses omit internal IDs and metadata.
- Application/API numeric values are bounded to JavaScript safe integers to prevent silent precision loss against BIGINT storage.

## Acceptance evidence

| Criterion                  | Verdict | Evidence                                                                                                              |
| -------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| Own profile read/update    | PASS    | Supertest creates, reads, trims, updates, and clears approved fields                                                  |
| Authorization/field guards | PASS    | Authentication, CSRF, protected/unknown/empty fields, and other-player paths rejected                                 |
| Creation race              | PASS    | Concurrent first reads return 200 and one profile row                                                                 |
| Policy boundaries          | PASS    | Database policy plus score 9/10 and total XP 0/499/500/1500 assertions                                                |
| Award idempotency          | PASS    | Same key returns original effect; changed payload conflicts; one ledger row remains                                   |
| Award concurrency          | PASS    | Twenty distinct simultaneous awards preserve ledger sum, cached XP, and level; focused test passed five repeated runs |
| Atomic rollback            | PASS    | Forced profile update trigger rolls back prior ledger insert and leaves XP/level unchanged                            |
| Trusted sources/no route   | PASS    | Client and unauthorized adjustment sources rejected; attempted HTTP award route is 404                                |
| Append-only ledger         | PASS    | Existing migration integration assertions reject XP update/delete                                                     |
| Stable private pagination  | PASS    | Same-timestamp ID tie, inserted-newer-row stability, bounds, cursor validation, and cross-player isolation tested     |
| Missing/retired policy     | PASS    | Existing profile remains readable while creation/award fail safely                                                    |
| M01–M03 regression         | PASS    | Complete 56-test MariaDB suite passes                                                                                 |
| MariaDB 10.4               | PASS    | Complete suite passes on isolated `playrush_migrations_test`                                                          |
| MySQL 8.4                  | PASS    | GitHub Actions run `39583211513` passed the complete workflow                                                         |

## Executed checks

| Command                        | Exit | Result                                                                                             |
| ------------------------------ | ---: | -------------------------------------------------------------------------------------------------- |
| `npm run format:check`         |    0 | All matched files use Prettier style                                                               |
| `npm run lint`                 |    0 | 0 errors, 0 warnings                                                                               |
| `npm run typecheck`            |    0 | Strict TypeScript check passed                                                                     |
| `npm test`                     |    0 | 56 passing, 0 failing, 0 pending                                                                   |
| `npm run build`                |    0 | Production TypeScript build passed                                                                 |
| `npm audit --audit-level=high` |    0 | 0 vulnerabilities after approved live registry access                                              |
| OpenAPI/Postman parse command  |    0 | OpenAPI 3.1/version 0.4.0 parsed with 10 paths; M04 Postman v2.1 collection parsed with 9 requests |
| Focused concurrency repetition |    0 | Twenty-award serialization test passed five consecutive executions                                 |
| `git diff --check`             |    0 | No whitespace errors before commit                                                                 |

The inherited M03 baseline was also run before implementation: format, lint, typecheck, all 46 tests, and build passed. GitHub's public Actions API independently confirmed M03 MySQL 8.4 run `39275617973` completed successfully for commit `eb43907`.

GitHub Actions run [`39583211513`](https://github.com/Omegacarlos1/Gamerush-backend/actions/runs/39583211513) passed `npm ci`, MySQL trigger prerequisite configuration, format, lint, strict typecheck, all 56 tests, production build, and high-severity audit against MySQL 8.4 for commit `64e7250`.

## Resolved implementation-time failures

- The first full M04 run stopped in test cleanup because MariaDB does not support `DROP TRIGGER` through the prepared-statement protocol. Test-only DDL now uses the query protocol.
- The next run correctly hit the production append-only XP trigger during fixture cleanup. Cleanup now temporarily drops and recreates the exact XP immutability triggers only in the isolated test database; the migration regression still independently proves update/delete rejection.
- The initial concurrent first-profile test produced one 200 and one 404 because the losing transaction reused an older repeatable-read snapshot after its duplicate-key upsert. The post-upsert read is now a locking/current read.
- Twenty concurrent awards initially created avoidable deadlock pressure because every call issued a duplicate profile upsert before locking. Awards now lock existing profiles directly and create only when absent; the focused test subsequently passed five consecutive runs.
- The first documentation parse command referenced an unavailable `yaml` package. The corrected command used the installed transitive `js-yaml` namespace API and parsed both artifacts successfully.
- The first dependency audit could not reach the registry in the restricted environment. The identical command was rerun with approved network access and returned zero vulnerabilities.

## Documentation and Postman

- OpenAPI remains the authoritative HTTP contract. The Postman v2.1 collection retains runnable cookie/CSRF examples and negative assertions without creating a competing API definition.
- The collection uses only local/example identity defaults; its password and transient cookie values are not populated or committed.
- `docs/progression.md` documents field limits, privacy, active/retired policy behavior, source authorization, idempotency, locking, rollback, cursor semantics, and safe-integer handling.

## AGENTS.md changes

Added durable profile/progression rules: allowlisted browser fields, internal source-allowlisted XP awards, atomic ledger/cache updates under row locks, active versioned policy loading, original-effect idempotent replay, and private history boundaries.

## Known risks and limitations

- XP history cursor contents are opaque rather than signed. User scoping prevents cross-player access, but future public/shared pagination may require authenticated cursors.
- `sourceReference` is returned to the owning player and must remain an opaque non-secret value in later producers.
- The policy table relies on operational discipline to avoid overlapping active policies; deterministic latest-effective selection prevents ambiguity at runtime, but a future management workflow should validate schedule overlap.
- Internal application methods are a trust boundary. Later gameplay/reward modules must pass only server-validated amounts and stable namespaced idempotency keys.
- Adjustment/correction awards are intentionally unavailable until an authorized, audited administrator workflow exists.
- The inherited process-local rate limiter still requires a shared store before horizontal deployment.

## Reviewer checklist and verdict

- [x] M04 scope only
- [x] All mandatory local profile/progression paths tested on isolated MariaDB
- [x] M01–M03 regression suite remains passing
- [x] MySQL 8.4 CI passes for the pushed M04 implementation
- [x] OpenAPI, Postman, privacy/progression docs, report, and M05 handoff supplied
- [x] No unresolved local blocking defect

**Verdict: PASS.** M04 is ready for review. Do not merge or begin M05 until M04 is explicitly approved.

## Pull request description

### What changed

Implemented authenticated self-profile creation/read/update, CSRF-protected strict display-field changes, private stable XP history, active versioned progression policy calculation, and an internal trusted-source XP award transaction with row locking, global idempotency, original-effect replay, and rollback safety. Added OpenAPI, Postman, progression/privacy documentation, acceptance tests, and M05 handoff. No migration or out-of-scope gameplay/reward feature was added.

### Validation

Locally on XAMPP MariaDB 10.4.32: format, lint, strict typecheck, 56 Mocha tests, build, high-severity audit, OpenAPI/Postman parsing, and five repeated 20-award concurrency tests pass. GitHub Actions run `39583211513` passes the complete workflow on MySQL 8.4.

### Risks

Cursor payloads are unsigned but always user-scoped; source references must remain non-secret; policy schedule overlap is controlled by deterministic selection rather than a database exclusion constraint; future internal callers remain responsible for trustworthy server-derived XP inputs.
