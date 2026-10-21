# Authentication and token transport

## Credential storage

Passwords are hashed with Argon2id using 19,456 KiB memory, two iterations, one lane, and a 32-byte result. This meets the current OWASP minimum Argon2id configuration and uses the maintained `argon2` package tested on Node 22 and newer. Hashes use per-password salts encoded in the PHC string; plaintext passwords never enter persistence or logs.

Email-verification and refresh tokens have 256 random bits and are stored only as SHA-256 hashes. SHA-256 is appropriate here because these are high-entropy random bearer secrets, not human passwords.

## Session model

Login creates a refresh-session family and sets three host-only cookies:

- access: HttpOnly signed HS256 JWT, 15-minute default lifetime;
- refresh: HttpOnly opaque rotating token, 30-day default lifetime;
- CSRF: readable signed token bound to the refresh-session UUID.

All cookies use `Path=/` and `SameSite=Strict`. Production configuration must enable `Secure`; production cookie names then use the `__Host-` prefix and never set `Domain`. Local HTTP can explicitly set `AUTH_COOKIE_SECURE=false`, producing unprefixed cookie names.

JWT verification fixes the accepted algorithm, issuer, audience, and required claims. A valid signature alone is insufficient: each protected request loads the backing session and account, rejecting revoked/expired sessions, changed roles, unverified email, suspension, or deletion. Logout is therefore effective immediately rather than waiting for JWT expiry.

## Refresh rotation and replay response

Refresh locks the presented session row, verifies the token hash in constant time, inserts a replacement in the same family, and revokes/links the old row in one transaction. A concurrent or later presentation of the old token records `reuse_detected_at` and revokes every session in the family. This conservative response can invalidate a legitimate replacement when clients refresh concurrently; clients must serialize refresh requests and sign in again after a reuse response.

## CSRF policy

Refresh, cookie-backed logout, authenticated profile PATCH, and game-session creation require the CSRF cookie value in `X-CSRF-Token`. The value contains a random nonce and HMAC bound to the refresh-session UUID. The server verifies cookie/header equality and the HMAC without logging token values. `SameSite=Strict`, host-only cookies, and controlled credentialed CORS provide additional layers. Future cookie-authenticated mutation routes must reuse the same protection unless a stronger approved mechanism replaces it.

Registration, verification, and login do not rely on an existing authenticated cookie and use a dedicated rate limiter. A future frontend milestone must keep credentialed requests restricted to approved origins.

## Account-state policy

- `pending_verification`: verification only; login is denied.
- `active` with verified email: authentication is allowed.
- `suspended`: login, refresh, and protected access are denied.
- `deleted`: login uses the generic invalid-credentials response and protected access is invalid.

Players and administrators are authorized from the current database role. The JWT role must match the live role, forcing a fresh login after a role change.

## Email delivery boundary

No vendor is approved. The application invokes `VerificationDelivery`; tests inject a deterministic capturing adapter. The runtime adapter is intentionally unconfigured and does not print, return, or persist plaintext tokens outside the delivery call. Production release requires an approved provider or transactional outbox adapter, delivery/retry monitoring, and operational configuration without changing the application use case.

References: [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [`node-argon2`](https://github.com/ranisalt/node-argon2), and [`jose`](https://github.com/panva/jose).
