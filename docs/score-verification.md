# Deterministic score verification and threat model

## Trust boundary

Only an authenticated player's live, owned, unexpired, active **ranked** session can accept evidence. Seed and nonce are one-time 256-bit values issued by M05; M06 hashes the presented values and compares them in constant time with the stored hashes. The browser's owner, status, version, timestamps, terminal claim, metres, coins, score, XP, and replay outcome are never authoritative.

Practice submissions return `409 SCORE_RANKED_SESSION_REQUIRED` and create no submission, authoritative score, XP, leaderboard input, achievement input, or other reward effect.

## `runner-evidence-v1`

The strict request contains:

- `contractVersion: "runner-evidence-v1"`;
- the fixed `gameVersionId` and `rulesVersion` from session creation;
- the one-time 43-character base64url `seed` and `nonce`;
- `simulationTicks` and a terminal `{ type, tick }`, where tick equals `simulationTicks`;
- at most 1,024 ordered input events `{ sequence, tick, type, payload: {} }`;
- non-authoritative claimed whole-number `metres`, `coins`, and `score`.

Sequences are contiguous from 1. Event ticks are strictly increasing, positive, and no later than the terminal tick. Allowed input types are `jump`, `moveLeft`, and `moveRight`. Unknown fields, payload properties, duplicate/reordered ticks, unsupported events, and values outside safe-integer/rules bounds are rejected before persistence. The dedicated payload bound is 65,536 bytes, below the global 100 KiB JSON limit.

## `runner-score-v1` deterministic rules

- Fixed simulation: 20 ticks/second; rendering frame rate and browser wall clock do not participate.
- Distance: 250 millimetres/tick; verified metres are `floor(ticks * 250 / 1000)`.
- Three lanes numbered 0–2; the player starts in lane 1.
- Events are applied before the generated entity for their tick. Moving beyond lanes 0/2 is impossible.
- A jump is airborne for 12 ticks and has a 16-tick cooldown. A jump before the cooldown expires is impossible.
- PRNG state is the first unsigned big-endian 32 bits of `SHA-256(seed)`, substituting `0x9e3779b9` for zero. Each tick applies xorshift32: `x ^= x << 13; x ^= x >>> 17; x ^= x << 5`, with unsigned 32-bit coercion after the step.
- The first 80 ticks are hazard-free. Later, `roll = state & 0xff` and `lane = (state >>> 8) % 3`. Roll 0–4 creates a coin; roll 5–8 creates an obstacle; other values create neither.
- A coin in the current lane is collected. A same-lane obstacle collides unless the player is airborne. The first collision is terminal.
- `collision` must name the first deterministic collision tick. `timeout` is valid only with no collision at exactly `maxSessionSeconds * 20` ticks.
- Score is `whole metres + 10 * coins`. Server finish time is `session.startedAt + simulationTicks * 50ms`.

The immutable database rules must remain exactly one point/metre, ten points/coin, and a duration equal to the fixed session version. Unsupported server rules cause a retryable service failure, not a player rejection.

## Digest, persistence, and idempotency

The canonical replay digest is SHA-256 over a fixed-order JSON object containing contract/session/version fields, SHA-256 credential hashes, ticks, terminal, normalized events, and claimed values. Plain seed/nonce values are never included in the digest or persisted by M06.

`Idempotency-Key` is required, ASCII-safe, and at most 191 characters. An identical key and canonical payload returns the original accepted/rejected result. Payload drift returns `409 SCORE_IDEMPOTENCY_CONFLICT`. Session row locking plus unique submission/session/verified-score/XP keys permits at most one terminal result and gameplay XP effect.

Ordered events, the non-authoritative claims, digest, and terminal decision persist for structurally valid submissions. Public reads never expose events, claims, digests, credentials/hashes, internal IDs/metadata, or another player's existence.

## Transaction and failure policy

One database transaction performs `active -> submitted -> accepted|rejected`, event/submission writes, accepted verified score, active progression-policy calculation, gameplay XP ledger append, and cached total/level update. Structurally valid credential, version, replay, and claim failures persist one terminal rejection with a coarse public code:

- `CREDENTIAL_MISMATCH`
- `VERSION_MISMATCH`
- `REPLAY_INVALID`
- `CLAIM_MISMATCH`

Malformed HTTP evidence is not a gameplay decision and persists nothing. Infrastructure/policy failures roll back every write and leave the session `active` for retry. Accepted XP is `floor(score / activePolicy.scorePointsPerXp)`. If that result is zero, acceptance records no ledger row and performs no profile update; the response explicitly reports `xpAwarded: 0`.

## Known limits

Deterministic replay detects altered claims, malformed/impossible inputs, wrong session material, replay, and incompatible versions; it cannot prove that a human generated valid inputs. A compromised same-origin script can observe one-time credentials, and sophisticated bots can produce valid deterministic play. The process-local limiter needs a shared store before horizontal deployment. TLS, CSP/dependency integrity, telemetry aggregation, behavior/bot detection, retention policy, and higher-value prize anti-cheat review remain launch controls. M06 deliberately adds no admin review workflow, character unlock, leaderboard, achievement, reward, payment, stake, wallet, or cash behavior.
