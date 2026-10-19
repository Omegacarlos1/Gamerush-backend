# M03 Postman and manual examples

Import `M03.postman_collection.json`, keep `baseUrl` at the local default, and change the example password before use. Postman must retain the server cookies between requests.

## Prerequisites

- Apply all seven M02 migrations and start the API with the M03 authentication environment values.
- No email vendor is approved. Registration invokes an injected delivery interface; automated tests use a deterministic capturing adapter. Set `verificationToken` from that adapter before running **Verify email**.
- Never place a real password, access token, refresh token, CSRF secret, or verification token in a committed environment or collection.

## Positive sequence

1. **Register player** returns `201` with a pending user and no secrets.
2. Obtain the token from the test delivery adapter and set `verificationToken`.
3. **Verify email** returns `204`; the same token then returns `401`.
4. **Login** returns `200` and sets access, refresh, and readable CSRF cookies. Token values are not returned in JSON.
5. **Current user** returns `200` from the cookie-backed session.
6. **Rotate session** copies the CSRF cookie into `X-CSRF-Token`, rotates the refresh session, and replaces all three cookies.
7. **Logout** supplies the same CSRF header, revokes the session, clears cookies, and returns `204`.

## Negative examples

- Weak or malformed registration returns `400 INVALID_REQUEST`.
- Duplicate normalized email or username returns generic `409 ACCOUNT_ALREADY_EXISTS`.
- Unknown email and wrong password both return `401 INVALID_CREDENTIALS`.
- Pending verification returns `403 EMAIL_VERIFICATION_REQUIRED`; suspended accounts return `403 ACCOUNT_SUSPENDED`.
- Refresh or cookie-backed logout without a matching signed CSRF header returns `403 CSRF_VALIDATION_FAILED`.
- Replaying an already rotated refresh token returns `401 SESSION_REUSE_DETECTED` and revokes the whole family.
- A player calling the M03-only admin probe receives `403 ROLE_REQUIRED`.

The collection is intentionally local and uses collection variables for non-secret defaults. Authentication cookies remain in Postman's cookie jar rather than variables. The verification token variable is transient and must be cleared after the run.
