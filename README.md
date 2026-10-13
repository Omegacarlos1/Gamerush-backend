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

3. Copy `.env.example` to `.env`, then set the local database username and password. `.env` is ignored by Git.
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
- Any unknown route — standardized `404` JSON error

See [architecture](docs/architecture.md), [data model](docs/database/data-model.md), [migration operations](docs/database/migrations.md), [OpenAPI](docs/api/openapi.yaml), and [M02 examples](docs/postman/M02-examples.md).
