# M01 milestone report

## Summary

- Milestone: M01 — Foundation and developer experience
- Date: 2026-10-13 (Africa/Lagos)
- Branch: `feature/B01-backend-development-foundation`
- Starting commit: `9765c6f`
- Local runtime: Node.js 24.19.0, npm 11.17.0
- Local database: XAMPP MariaDB 10.4.32
- Status: PASS

## Scope delivered

- Strict TypeScript 6 ECMAScript-module project on Express 5, with an app factory separate from server startup.
- Versioned `/api/v1` routing and database-backed `GET /api/v1/health`.
- Zod environment validation with production-safe checks and a non-secret `.env.example`.
- `mysql2` promise pool, startup connectivity probe, health probe, UTC/UTF-8 settings, bounded pool, and graceful shutdown.
- UUID request IDs, structured/redacted Pino logs, centralized safe errors, 404 handling, Helmet, allowlisted credentialed CORS, rate limiting, and body-size limits.
- Mocha, Chai, Supertest, strict lint/type/build tooling, isolated real-database connectivity test, and MySQL 8.4 CI starter.
- README, architecture, OpenAPI, milestone plan, Postman/manual examples, and M02 handoff prompt.

No business modules, tables, migrations, auth, gameplay, score, XP, reward, payment, frontend, or Socket.IO behavior was added.

## Acceptance evidence

| Criterion                   | Verdict | Evidence                                                                                                     |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| Healthy response/status     | PASS    | Supertest verifies 200, exact healthy shape, timestamp, DB-up state, request ID, and security headers        |
| Unknown-route response      | PASS    | Supertest verifies standardized 404 envelope and request-ID correlation                                      |
| Invalid environment failure | PASS    | Tests cover missing DB name and three unsafe production conditions                                           |
| Database unavailable        | PASS    | Injected driver failure becomes controlled 503 without driver details or secret leakage                      |
| Real local connectivity     | PASS    | Read-only `SELECT 1` succeeds against isolated `playrush_test` on XAMPP MariaDB 10.4.32                      |
| Secure defaults             | PASS    | Tests cover CORS denial, 413, invalid JSON, rate limiting, header hardening, request IDs, and log redaction  |
| Quality commands            | PASS    | Format, lint, typecheck, 13-test suite, production build, and high-severity audit pass                       |
| Required artifacts          | PASS    | M01 milestone/report/Postman collection and examples, architecture/OpenAPI, CI, README, and M02 prompt exist |

## API and database changes

### `GET /api/v1/health`

- Authentication: none
- `200`: `{ "status": "ok", "timestamp": "<ISO-8601>", "checks": { "database": "up" } }`
- `503`: standardized `SERVICE_UNAVAILABLE` error when the database probe fails
- All responses have `X-Request-Id`; errors contain the same request ID.

Unknown routes return `404 ROUTE_NOT_FOUND`. Disallowed origins return `403 CORS_ORIGIN_DENIED`; throttled clients return `429 RATE_LIMIT_EXCEEDED`.

M01 adds no schema, migration, table, or fixture. The only integration query is `SELECT 1 AS health_check`. A local empty `playrush_test` database was created for the isolated probe; it is outside Git and contains no tables.

## Executed checks

Final verification was performed from the repository root:

| Command                        | Exit | Result                                                                  |
| ------------------------------ | ---: | ----------------------------------------------------------------------- |
| `npm run format:check`         |    0 | All matched files use Prettier style                                    |
| `npm run lint`                 |    0 | 0 errors, 0 warnings                                                    |
| `npm run typecheck`            |    0 | Strict TypeScript check passed                                          |
| `npm test`                     |    0 | 13 passing, 0 failing, 0 pending                                        |
| `npm run build`                |    0 | Production TypeScript build passed                                      |
| `npm audit --audit-level=high` |    0 | 0 vulnerabilities                                                       |
| Postman JSON parse check       |    0 | Collection parsed successfully; 2 requests                              |
| Compiled-server smoke test     |    0 | HTTP 200 against live XAMPP MariaDB; DB `up` and `X-Request-Id` present |

### Resolved implementation-time failures

- The first dependency install stalled before creating `node_modules`; only that spawned installer was stopped, installation was retried with a workspace-local ignored cache, and dependency installation then completed.
- An early test run reported 12 passing and 1 failing because a Chai 6 error assertion used obsolete chaining. The assertion was rewritten to inspect the thrown error explicitly; the application behavior was already correct.
- The first full parallel gate had 13 passing tests but lint reported 31 errors because the generated `dist-test` tree was not ignored. The lint ignore was corrected and the complete gate was rerun with 0 lint errors.
- The first selected rate-limiter version produced 2 high-severity audit findings. It was upgraded to patched 8.7.1 before acceptance; the final audit reports 0 vulnerabilities.
- `tsx` initially hit a restricted-execution Windows user-info error. The installed runner was verified outside that restriction as `tsx 4.23.15` on Node 24.19.0.

## Security notes

- Configuration error messages contain field paths and safe validation text, not environment values.
- Database exceptions are converted to generic responses and logged only by error type; passwords, tokens, authorization, and cookies have explicit Pino redaction paths.
- Production configuration rejects wildcard CORS, blank DB passwords, and root DB users.
- The body limit defaults to 100 KB, the global in-memory rate limit defaults to 120 requests/minute, and Express identification is disabled.
- Client scores, XP, roles, rewards, and completion timestamps remain unimplemented and untrusted by policy.
- No secrets or `.env` files were added. The Postman and CI credentials are explicitly isolated test examples.

## Known risks and limitations

- Local MariaDB success is not proof of all future schema compatibility with production MySQL; CI is prepared for MySQL 8.4, and M02 must exercise both engines.
- The in-memory limiter is suitable for one process only. A shared store and trusted-proxy configuration must be selected before horizontal production deployment.
- Health currently combines application readiness and database readiness; a separate liveness endpoint may be added only with an approved operational requirement.
- The branch name predates the documented shorter convention (`feature/B01-backend-foundation`) but remains a dedicated feature branch; it was not renamed or force-pushed.
- The repository already contained unrelated user changes to the consolidated prompt document and a deleted DOCX prompt artifact; M01 preserves them and does not include them in scoped commits.

## AGENTS.md changes

Preserved the existing policies and Git workflow. Updated the stack wording to explicitly name local XAMPP MariaDB and added durable foundation conventions for Node 24+, ECMAScript modules, app/startup separation, standardized request-ID errors, isolated test databases, and mandatory MySQL compatibility verification.

## Reviewer checklist and verdict

- [x] M01 scope only
- [x] Acceptance tests and real MariaDB probe pass
- [x] Security and secret-leakage paths tested
- [x] Postman and OpenAPI examples supplied
- [x] Documentation and M02 handoff supplied
- [x] No unresolved blocking defect

**Verdict: PASS.** Await explicit approval before M02.

## Pull request description

### What changed

Established the PlayRush Node 24/strict TypeScript/Express foundation, versioned health API, validated configuration, XAMPP MariaDB/MySQL pool, secure middleware, structured logging, centralized errors, deterministic tests, CI, and M01 documentation.

### Validation

Format, lint, strict typecheck, 13 Mocha tests (including real XAMPP MariaDB connectivity), build, dependency audit, and Postman collection JSON parsing pass.

### Risks

Future SQL must be exercised on both MariaDB and MySQL. The current rate limiter is process-local. No business schema or APIs are included.
