# PlayRush Backend

Production-oriented TypeScript/Express backend for PlayRush. The codebase is a modular monolith with versioned routes under `/api/v1`.

## Prerequisites

- Node.js 24 or newer and npm 11 or newer
- XAMPP MariaDB for local development (verified with MariaDB 10.4.32)
- Production and CI must use the selected MySQL version; MariaDB compatibility is not assumed automatically

## Local setup with XAMPP MariaDB

1. Start the XAMPP database service.
2. Create separate application and test databases and least-privilege users in phpMyAdmin or the MariaDB client. Replace the example passwords before running these statements:

```sql
CREATE DATABASE playrush_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE playrush_migrations_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'playrush_app'@'localhost' IDENTIFIED BY '<choose-a-local-password>';
CREATE USER 'playrush_test'@'localhost' IDENTIFIED BY '<choose-a-different-test-password>';
GRANT ALL PRIVILEGES ON playrush_dev.* TO 'playrush_app'@'localhost';
GRANT ALL PRIVILEGES ON playrush_migrations_test.* TO 'playrush_test'@'localhost';
FLUSH PRIVILEGES;
```

3. Copy `.env.example` to `.env`, set the local database username/password, and generate independent `AUTH_ACCESS_TOKEN_SECRET` and `AUTH_CSRF_SECRET` values of at least 32 characters. Local HTTP may keep `AUTH_COOKIE_SECURE=false`; production validation requires it to be `true`. `.env` is ignored by Git.
4. Install and run:

```powershell
npm ci
npm run db:migrate:status
npm run db:migrate:up
npm run db:seed
npm run dev
```

The server defaults to `http://127.0.0.1:3000`. A database outage does not crash the HTTP process: startup is logged as degraded and `GET /api/v1/health` returns a controlled `503` until connectivity is restored.

## Commands

```powershell
npm run dev           # watched development server
npm run format:check  # verify formatting
npm run lint          # strict typed linting
npm run typecheck     # strict TypeScript check
npm run test          # compile and run all Mocha tests, including DB connectivity
npm run test:db       # isolated MariaDB/MySQL connectivity test only
npm run db:migrate:status # show applied and pending migration versions
npm run db:migrate:up     # apply pending migrations
npm run db:migrate:down -- --steps=1 # rollback on dev/test only
npm run db:seed           # deterministic dev/test catalog fixtures
npm run build         # production output in dist/
npm start             # run the production build
```

The integration suite defaults to `playrush_migrations_test`, `root`, and a blank local password to match a fresh XAMPP installation. Prefer setting `TEST_DB_USER`, `TEST_DB_PASSWORD`, and related `TEST_DB_*` variables to a dedicated account. The suite refuses a database name that is not visibly test-scoped, exercises full migrate/rollback/re-migrate behavior, and leaves the schema migrated and seeded after success.

## API

- `GET /api/v1/health` — database-backed liveness/readiness response
- `POST /api/v1/auth/register` — create a pending player account
- `POST /api/v1/auth/verify-email` — consume a single-use verification token
- `POST /api/v1/auth/login` — set access, rotating refresh, and signed CSRF cookies
- `POST /api/v1/auth/refresh` — rotate the cookie session with `X-CSRF-Token`
- `POST /api/v1/auth/logout` — revoke the session and clear cookies
- `GET /api/v1/auth/me` — return the current verified active account
- `GET /api/v1/auth/admin-check` — M03-only role-enforcement probe
- `GET /api/v1/players/me` — create/read the authenticated player's profile
- `PATCH /api/v1/players/me` — update only approved display fields with `X-CSRF-Token`
- `GET /api/v1/players/me/xp-history` — read private cursor-paginated XP history
- `GET /api/v1/games` — list active games with published immutable rules
- `GET /api/v1/games/:gameId` — read one public active game configuration
- `POST /api/v1/games/:gameId/sessions` — create a CSRF-protected practice/ranked session
- `GET /api/v1/game-sessions/:sessionId` — read only the authenticated player's session state
- `POST /api/v1/game-sessions/:sessionId/scores` — submit CSRF/idempotency-protected deterministic ranked evidence
- `GET /api/v1/score-submissions/:submissionId` — read only the authenticated player's safe result state
- Any unknown route — standardized `404` JSON error

Authentication cookies are host-only and `SameSite=Strict`; production requires Secure `__Host-` names. Refresh, cookie-backed logout, profile PATCH, game-session creation, and score submission require the readable CSRF cookie value in `X-CSRF-Token`. Session creation fixes server UTC start/expiry and returns seed/nonce material once. Ranked submission uses strict `runner-evidence-v1`, a required `Idempotency-Key`, a dedicated 64 KiB evidence bound/rate limit, deterministic server replay, one authoritative score, and atomic gameplay XP. Practice creates no score or XP. No email vendor is configured; tests inject a deterministic verification-delivery adapter.

See [architecture](docs/architecture.md), [authentication security](docs/security/authentication.md), [profile/progression policy](docs/progression.md), [game/session browser contract](docs/game-sessions.md), [score verification/threat model](docs/score-verification.md), [data model](docs/database/data-model.md), [migration operations](docs/database/migrations.md), [OpenAPI](docs/api/openapi.yaml), and [M06 examples](docs/postman/M06-examples.md).
