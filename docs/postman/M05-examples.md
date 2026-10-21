# M05 game catalog and session examples

OpenAPI is the authoritative contract. The M05 Postman collection provides runnable positive and negative examples against a local server. Start with a verified M03 account, set `email` and the non-committed `password` collection value, then run the requests in order so Postman retains cookies and captures `gameId` and `sessionId`.

## Public catalog

```http
GET /api/v1/games
```

The response is public with `Cache-Control: public, max-age=60, stale-while-revalidate=30`. It includes only active games whose selected active version is published with `publishedAt`; draft/retired records return no distinguishing data. Active cosmetic characters are included with their unlock levels.

```http
GET /api/v1/games/10000000-0000-4000-8000-000000000001
```

Unknown and hidden games return the standardized `404 GAME_NOT_FOUND` envelope.

## Create a server-issued session

Copy the readable `playrush_csrf` cookie (or production `__Host-playrush_csrf`) into `X-CSRF-Token`; access and refresh cookies remain in the cookie jar.

```http
POST /api/v1/games/10000000-0000-4000-8000-000000000001/sessions
Content-Type: application/json
X-CSRF-Token: <signed session-bound CSRF value>

{
  "mode": "ranked"
}
```

`201` returns the fixed game/version, server timestamps, active status, and 256-bit base64url `seed` and `nonce`. The browser must keep both values only for the current run. They are returned once, are marked `no-store`, and cannot be recovered from the retrieval endpoint. Persistence contains only SHA-256 hashes.

The only accepted body field is `mode`, with value `practice` or `ranked`. Client version, status, timestamps, score, XP, owner, seed, and nonce fields are rejected as `400 INVALID_REQUEST`.

## Retrieve an owned session

```http
GET /api/v1/game-sessions/<session UUID>
```

The endpoint requires the current access cookie, uses `Cache-Control: no-store`, and returns owner-visible game/version/mode/lifecycle/timestamp data. It omits credentials and hashes. Unknown and another player's session both return `404 GAME_SESSION_NOT_FOUND`. An issued/active session at or beyond its server expiry is atomically marked and returned as `expired` with `200`.

## Duplicate, rate, and lifecycle policy

- One open session (`issued`, `active`, or `submitted`) is allowed per player, game, and mode. A second same-mode request returns `409 GAME_SESSION_ALREADY_ACTIVE`; practice and ranked are independent.
- Session creation has a dedicated process-local default limit of 10 requests per 60 seconds, returning `429 GAME_SESSION_RATE_LIMIT_EXCEEDED`.
- Creation starts the server clock immediately and fixes expiry to the selected version's duration cap.
- Internal transitions are `issued -> active|expired|abandoned`, `active -> submitted|expired|abandoned`, and `submitted -> accepted|rejected`. Terminal states cannot transition.
- M05 has no score/evidence submission route. `POST /api/v1/game-sessions/<id>/scores` returns the standard route-not-found response.

The collection intentionally does not save seed or nonce values into collection variables. Do not export live passwords, cookies, seeds, nonces, or tokens.
