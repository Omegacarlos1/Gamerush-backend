# M02 migration and API verification examples

M02 adds database schema and CLI operations but no business HTTP endpoints. The existing health endpoint remains the API smoke test.

## Environment

- `baseUrl`: `http://127.0.0.1:3000`
- Authentication: none for health
- Application database: a migrated `playrush_dev`
- Destructive verification database: an isolated name such as `playrush_migrations_test`

## Migration CLI

With `.env` pointing at the intended development or test database:

```powershell
npm run db:migrate:status
npm run db:migrate:up
npm run db:migrate:up
npm run db:seed
npm run db:seed
npm run db:migrate:down -- --steps=1
npm run db:migrate:up
```

Expected behavior:

- Initial status shows versions `0001`–`0007` as pending on an empty schema.
- First up reports seven applied migrations; second up reports zero.
- Both seed runs finish with the same counts.
- One-step down reports `0007`; the following up reapplies only `0007`.
- A production environment or ambiguous database name rejects down/seed before destructive work.

## Health after migration

```http
GET {{baseUrl}}/api/v1/health
```

Expected status: `200 OK`

```json
{
  "status": "ok",
  "timestamp": "2026-10-13T08:00:00.000Z",
  "checks": {
    "database": "up"
  }
}
```

The timestamp varies. `X-Request-Id` must be present.

## Negative API example

```http
GET {{baseUrl}}/api/v1/not-found
```

Expected status: `404 Not Found` with `ROUTE_NOT_FOUND`, a matching request ID, and no stack trace.

Import `docs/postman/M02.postman_collection.json` for reproducible health and unknown-route checks. CLI behavior is outside Postman and is covered by the automated migration suite.
