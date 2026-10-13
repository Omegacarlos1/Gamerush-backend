# M01 Postman and manual examples

## Environment

- `baseUrl`: `http://127.0.0.1:3000`
- Authentication: none
- Required server variables: copy `.env.example` to `.env` and set the XAMPP MariaDB connection
- Content type: no request body is required for either example

## Healthy service

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

The timestamp varies. The response also contains `X-Request-Id` and security headers.

## Database unavailable

Stop MariaDB or temporarily point `DB_PORT` at an unused port, then restart the server and repeat the health request.

Expected status: `503 Service Unavailable`

```json
{
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "Service temporarily unavailable",
    "requestId": "<uuid>"
  }
}
```

No database host, username, password, stack trace, or driver message is returned.

## Unknown route

```http
GET {{baseUrl}}/api/v1/not-found
```

Expected status: `404 Not Found`

```json
{
  "error": {
    "code": "ROUTE_NOT_FOUND",
    "message": "Route not found",
    "requestId": "<uuid>"
  }
}
```

Import `docs/postman/M01.postman_collection.json`. Its tests validate status codes, response shape, request-ID correlation, security headers, and absence of common secret fields.
