# M04 Postman and manual examples

Import `M04.postman_collection.json` after applying and seeding all seven migrations. Create and verify the example player through the M03 flow, set the collection `email` and transient `password`, then run **Login verified player** so Postman retains the server cookies.

## Positive sequence

1. **Login verified player** returns `200` and stores access, refresh, and signed CSRF cookies without putting tokens in JSON.
2. **Get my profile** returns `200`; a missing profile is created once with XP `0` and the active policy's starting level.
3. **Update my profile** copies the readable CSRF cookie into `X-CSRF-Token` and updates only `displayName` and `bio`.
4. **Get my XP history** returns a newest-first private page. Save `pagination.nextCursor` only when it is non-null, then run the next-page request.

XP awards are intentionally absent from the collection and API. M04 exposes the award operation only as an injected internal application service for later trusted score/reward workers.

## Negative examples

- Missing or invalid access cookies return `401 AUTHENTICATION_REQUIRED` or `401 SESSION_INVALID`.
- A cookie-authenticated PATCH without the matching signed CSRF header returns `403 CSRF_VALIDATION_FAILED`.
- Unknown fields and attempts to set `totalXp`, `level`, role, status, scores, unlocks, or a user ID return `400 INVALID_REQUEST`.
- Empty PATCH bodies, display names over 80 characters, and biographies over 500 characters return `400 INVALID_REQUEST`.
- XP history limits outside `1..100` and malformed/unsupported cursors return `400 INVALID_REQUEST`.
- Routes for another player's profile/history and client-facing XP awards do not exist and return the standardized `404 ROUTE_NOT_FOUND` envelope.

## Privacy and credentials

The profile response omits email and role. XP history omits database IDs and ledger metadata; `sourceReference` is an opaque server provenance value. Authentication cookies remain in Postman's cookie jar. Do not commit passwords, tokens, cookie values, or a populated cursor from private production data.
