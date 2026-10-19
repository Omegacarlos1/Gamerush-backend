# Backend architecture

## M01 baseline

PlayRush is a modular monolith. `src/app.ts` is the composition root for HTTP middleware and routes; `src/server.ts` owns configuration, infrastructure creation, startup, and graceful shutdown. This separation keeps route tests independent of a listening port.

```text
src/
  config/                 validated runtime configuration
  infrastructure/         external adapters such as MySQL/MariaDB
  modules/<module>/
    application/          use cases and orchestration
    presentation/         Express controllers and routes
  shared/
    errors/               application error types
    http/                 cross-cutting HTTP middleware
    logging/              structured logger configuration
```

Dependencies point inward: presentation calls application services; application code receives infrastructure behavior through injected functions or interfaces. Business repositories and domain modules begin only in their approved milestones.

## Request path

Requests receive a UUID request ID, structured request logging, Helmet security headers, allowlisted CORS handling, rate limiting, and bounded JSON/form parsing. Versioned routers run next. Unknown routes and errors use one JSON envelope and never expose stack traces or infrastructure error messages.

## Database compatibility

Local development uses XAMPP MariaDB. The adapter uses the `mysql2` promise pool and portable options: UTF-8, UTC sessions, parameterized-query support, bounded connections, and connection timeouts. Health checks execute `SELECT 1`; M01 creates no business tables or migrations.

Production remains MySQL. CI starts MySQL 8.4 so future migrations can be checked against the production engine. MariaDB and MySQL behavior must be tested separately where SQL dialect, constraints, JSON, collations, or transaction behavior can differ.

## Operational behavior

Environment variables are parsed before infrastructure is created. Production rejects wildcard CORS, blank database passwords, and a root database account. Failed startup connectivity logs a safe degraded event; the server remains available for controlled health responses. SIGINT and SIGTERM close the HTTP server and pool.

## M02 persistence architecture

Versioned SQL lives outside application modules in `database/migrations`. The infrastructure migration loader parses explicit up/down sections and checksums normalized contents. The runner serializes changes with a database advisory lock and owns the `schema_migrations` history table. Applied-file drift is a hard failure.

Destructive commands receive the validated environment and database name and refuse production or ambiguous targets. Seeds and future multi-write use cases use the shared `withTransaction` helper. Schema DDL is not described as transaction-atomic because both supported engines implicitly commit it; recovery uses unrecorded-failure detection, explicit down SQL, backups, and restore procedures.

The schema is organized around identity, immutable game/rules versions, gameplay evidence versus verified results, append-only progression, weekly competition snapshots, idempotent virtual rewards, and auditable administration. See `docs/database/data-model.md` for relationships and retention boundaries.

## M03 identity architecture

The identity module follows domain/application/infrastructure/presentation boundaries. `AuthService` owns account and session rules through injected repository, password-hashing, token-delivery, clock, and logging dependencies. `MySqlAuthRepository` implements parameterized queries and exposes explicit transaction-scoped operations; controllers only validate HTTP input, manage cookies, and map service results.

Registration and verification reuse the M02 identity tables without editing applied migrations. Authentication uses Argon2id password hashes, signed short-lived access JWTs, hashed rotating refresh tokens, live session/account checks, and signed session-bound CSRF tokens. Refresh row locks make replacement/replay outcomes deterministic under concurrency. See `docs/security/authentication.md` for the transport and account-state policy.
