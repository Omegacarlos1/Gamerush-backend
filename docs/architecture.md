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
