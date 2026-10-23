# M06 Postman examples

Import `M06.postman_collection.json`. OpenAPI remains the interface source of truth; this collection adds runnable request examples and assertions.

## Local setup

1. Register, verify, and log in with the M03 collection so Postman holds the access/refresh/CSRF cookies.
2. Create a **ranked** session with the M05 collection.
3. Copy the response session ID and version ID into `sessionId` and `gameVersionId`.
4. Put the readable CSRF cookie in `csrfToken`.
5. Put the one-time seed and nonce in local/environment values named `scoreSeed` and `scoreNonce`. Do not persist or export those values.
6. Generate the exact `runner-evidence-v1` terminal tick, ordered events, metres, coins, and score with the matching deterministic client module. Update the collection variables before sending the accepted example.

The committed collection intentionally contains no usable account, cookie, CSRF, seed, or nonce value.

## Expected cases

| Request                               | Expected result                                             |
| ------------------------------------- | ----------------------------------------------------------- |
| Accepted deterministic score          | `201`, `accepted`, server-derived result, `replayed: false` |
| Rejected fabricated claim             | `422`, terminal `rejected`, `CLAIM_MISMATCH`, no score/XP   |
| Duplicate accepted submission         | `200`, original submission/result, `replayed: true`         |
| Idempotency payload drift             | `409 SCORE_IDEMPOTENCY_CONFLICT`                            |
| Get owned score submission            | `200`, safe status/result without evidence or credentials   |
| Get unknown/other player's submission | `404 SCORE_SUBMISSION_NOT_FOUND`                            |

Structurally invalid payloads return `400` and create no submission. Practice, expired, or terminal sessions return `409`. Missing authentication is `401`; missing/invalid CSRF is `403`; evidence above the dedicated 64 KiB bound is `413`; and the process-local submission limit returns `429`.

Accepted score and XP effects are atomic. A server/infrastructure failure returns a safe `500`/`503`, rolls back the session to its prior `active` state, and is retryable with the same idempotency key. A structurally valid anti-cheat rejection is terminal and must not be retried as a new attempt.
