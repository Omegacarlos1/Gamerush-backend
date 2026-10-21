# M03 milestone report

## Summary

- Milestone: M03 — Identity and access
- Date: 2026-10-19 (Africa/Lagos)
- Branch: `feature/B03-identity-access`
- Starting commit: `e9d8fa9`
- Implementation/docs commit verified by CI: `eb43907`
- Local runtime: Node.js 24.19.0, npm 11.17.0
- Local engine: XAMPP MariaDB 10.4.32
- Production/CI target: MySQL 8.4
- Status: **PASS**

## Scope delivered

- Strict validated registration, normalized email/username, final database uniqueness enforcement, generic duplicate identity response, and Argon2id password storage.
- Hashed, expiring, single-use email-verification tokens behind an injected delivery interface and deterministic test adapter.
- Verified/active-only login with non-enumerating invalid-credential responses and dedicated authentication throttling.
- Signed short-lived access JWTs in HttpOnly cookies with issuer, audience, algorithm, required-claim, expiry, backing-session, live-role, and live-account checks.
- Opaque 256-bit rotating refresh secrets, SHA-256-only persistence, row-lock serialization, replacement linkage, replay detection, family revocation, expiry, and bounded deadlock retry.
- Host-only Strict cookies, production Secure `__Host-` naming, signed session-bound double-submit CSRF tokens, immediate/idempotent logout, current user, and a minimal player/admin authorization probe.
- Modular application ports/service, MySQL repository, security adapters, controllers/routes, safe errors/logging, configuration, OpenAPI, Postman, security documentation, and M04 handoff.

No profile/XP behavior, gameplay, scoring, leaderboards, achievements, administration workflows, password reset, email-vendor integration, payments, staking, wallet, or cash rewards were added. M03 requires no schema change and does not edit any applied migration.

## API contract

| Method | Path                        | Purpose                                                             |
| ------ | --------------------------- | ------------------------------------------------------------------- |
| `POST` | `/api/v1/auth/register`     | Create a pending player account and request verification delivery   |
| `POST` | `/api/v1/auth/verify-email` | Consume one verification token and activate the account             |
| `POST` | `/api/v1/auth/login`        | Set access, refresh, and CSRF cookies for a verified active account |
| `POST` | `/api/v1/auth/refresh`      | Validate CSRF and rotate the refresh session/cookies                |
| `POST` | `/api/v1/auth/logout`       | Validate CSRF when cookie-backed, revoke, and clear cookies         |
| `GET`  | `/api/v1/auth/me`           | Return the current live account/session identity                    |
| `GET`  | `/api/v1/auth/admin-check`  | Minimal M03-only admin-role enforcement probe                       |

All errors keep the standardized request-ID envelope. Authentication and verification tokens are never returned in JSON.

## Security and policy decisions

- Argon2id parameters are 19,456 KiB memory, two iterations, one lane, and a 32-byte output, matching the current OWASP minimum recommendation.
- Default access, refresh, and verification lifetimes are 15 minutes, 30 days, and 24 hours respectively; validated environment values may shorten or adjust them within bounded ranges.
- Production configuration rejects non-Secure cookies. Production names use `__Host-playrush_*`; local explicit non-Secure mode uses unprefixed names.
- Refresh/logout require a CSRF cookie copied to `X-CSRF-Token`; the HMAC is bound to the refresh-session UUID. Cookie/header comparison and signature checks do not log token values.
- Pending accounts cannot log in. Suspended accounts are denied at login, refresh, and access. Deleted accounts receive generic invalid credentials and invalid sessions.
- JWT role claims must match the current database role. Logout and account-state changes take effect immediately because protected access checks persistence.
- Unknown email login performs Argon2 work before returning the same `INVALID_CREDENTIALS` response as a wrong password.

## Acceptance evidence

| Criterion                  | Verdict | Evidence                                                                                                 |
| -------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| Registration/normalization | PASS    | Normalized persistence, weak-input rejection, sequential duplicate, and concurrent uniqueness race tests |
| Password security          | PASS    | Argon2id PHC hash verifies; plaintext absent from database and response                                  |
| Verification lifecycle     | PASS    | Hash-only persistence, success, expiry, single use, and replay rejection tested                          |
| Login/enumeration/status   | PASS    | Unknown/wrong responses match; pending, suspended, deleted policies tested                               |
| Access token/current user  | PASS    | Valid, invalid, expired, revoked, changed-role, and suspended cases exercised                            |
| Refresh rotation/reuse     | PASS    | Replacement, expiry, replay-family revocation, and concurrent refresh tested                             |
| Logout                     | PASS    | Immediate revocation, cookie clearing, CSRF, and idempotent no-cookie retry tested                       |
| Authorization              | PASS    | Player denial and admin allow behavior demonstrated from live database roles                             |
| Rate limiting              | PASS    | Dedicated authentication limiter returns `AUTH_RATE_LIMIT_EXCEEDED`                                      |
| Cookie/CSRF policy         | PASS    | HttpOnly/Strict/local names plus Secure production `__Host-` names and signed CSRF tested                |
| Secret handling            | PASS    | Token fields absent from JSON, hashes only in persistence, expanded log redaction passes                 |
| M01/M02 regression         | PASS    | Complete 46-test suite passes, including migration lifecycle and append-only rules                       |
| MariaDB 10.4               | PASS    | Full suite passed locally on isolated `playrush_migrations_test`                                         |
| MySQL 8.4                  | PASS    | GitHub Actions run `39275617973` passed the complete workflow                                            |

## Executed checks

Final verification from the repository root:

| Command                        | Exit | Result                                                      |
| ------------------------------ | ---: | ----------------------------------------------------------- |
| `npm run format:check`         |    0 | All matched files use Prettier style                        |
| `npm run lint`                 |    0 | 0 errors, 0 warnings                                        |
| `npm run typecheck`            |    0 | Strict TypeScript check passed                              |
| `npm test`                     |    0 | 46 passing, 0 failing, 0 pending                            |
| `npm run build`                |    0 | Production TypeScript build passed                          |
| `npm audit --audit-level=high` |    0 | 0 vulnerabilities                                           |
| OpenAPI/Postman parse command  |    0 | OpenAPI 3.1 parsed; M03 collection parsed with 10 requests  |
| `git diff --check`             |    0 | No whitespace errors                                        |
| Focused concurrency repetition |    0 | Refresh concurrency test passed five consecutive executions |

GitHub Actions run [`39275617973`](https://github.com/Omegacarlos1/Gamerush-backend/actions/runs/39275617973) passed `npm ci`, MySQL trigger prerequisite configuration, format, lint, strict typecheck, all 46 tests, production build, and high-severity audit against MySQL 8.4.

## Resolved implementation-time failures

- The first focused M03 run reported 14 passing and 2 failing because email validation ran before whitespace normalization. The schema now trims/lowercases before email validation; the rerun reported 16 passing.
- The first complete run reported 45 passing and 1 failing: simultaneous refresh returned one 200 and one 500 with `ER_LOCK_DEADLOCK`. The repository now narrows the lock to the session record and retries deadlocked identity transactions up to three times. The losing request then observes committed rotation, records reuse, revokes the family, and returns 401. The focused race passed five consecutive runs and the full suite passed afterward.
- The first dependency audit could not reach npm from the restricted environment. The identical command was rerun with network permission and returned 0 vulnerabilities.
- The first read-only OpenAPI check used an invalid default ESM import for the transitive YAML parser. The corrected namespace import parsed OpenAPI and the 10-request Postman collection successfully; no artifact change was required for that failure.

## Documentation and Postman

- OpenAPI is the authoritative interface contract. The importable Postman v2.1 JSON is retained for compatibility with the repository's required artifact convention and adds runnable assertions/examples without replacing OpenAPI.
- Collection variables supply only target/example identity defaults. Password and verification-token values are empty for runtime injection; authentication tokens remain in Postman's cookie jar.
- Added the M03 milestone specification, security/token transport guide, examples, collection, architecture/migration/README updates, this report, and the copy-ready M04 prompt.

## AGENTS.md changes

Added durable authentication conventions: Argon2id/no plaintext secrets, production Secure host-only cookie transport, signed session-bound CSRF, transactional refresh rotation/family revocation, concurrency safety, and live database authorization rather than JWT-only trust.

## Known risks and limitations

- No email provider is approved. The runtime delivery adapter intentionally does not send or expose tokens; production registration needs an approved provider or outbox adapter plus delivery/retry monitoring.
- Password reset is required by the broader PRD but is not part of the approved M03 scope and remains unimplemented.
- HS256 secret rotation/key identifiers are not implemented; deployment must protect independent access/CSRF secrets and define rotation before production launch.
- The inherited in-memory rate limiter is process-local and needs a shared store before horizontal deployment.
- Conservative refresh replay response revokes a legitimate replacement after accidental concurrent refresh. Clients must serialize refresh and sign in again after `SESSION_REUSE_DETECTED`.
- Privacy retention, account anonymization/deletion execution, and session-retention periods remain launch decisions.

## Reviewer checklist and verdict

- [x] M03 scope only
- [x] All mandatory identity/security paths tested on isolated MariaDB
- [x] M01/M02 regression suite remains passing
- [x] MySQL 8.4 CI passes
- [x] OpenAPI, Postman, security docs, report, and M04 handoff supplied
- [x] No unresolved blocking defect

**Verdict: PASS.** M03 is ready for review. Do not merge or begin M04 until M03 is explicitly approved.

## Pull request description

### What changed

Implemented normalized player registration, Argon2id passwords, hash-only single-use email verification, non-enumerating login, signed cookie access tokens, rotating hash-only refresh sessions with transactional replay-family revocation, signed session-bound CSRF, immediate logout, current-user access, live account/role enforcement, dedicated auth throttling, and a minimal admin authorization probe. Added OpenAPI, Postman, security/architecture docs, acceptance tests, and M04 handoff. No migration or out-of-scope business feature was added.

### Validation

Locally on XAMPP MariaDB 10.4.32: format, lint, strict typecheck, 46 Mocha tests, build, audit, OpenAPI/Postman parsing, and repeated concurrent-refresh verification pass. GitHub Actions run `39275617973` passes the complete workflow on MySQL 8.4.

### Risks

Email delivery remains an injected but unconfigured production dependency; password reset is not in M03; rate limiting is process-local; secret rotation and privacy retention need production decisions; conservative refresh replay invalidates the whole family.
