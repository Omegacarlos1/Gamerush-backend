# Player profiles, privacy, and XP progression

## Profile contract

The authenticated self-profile endpoints expose the account public UUID and username plus profile display/progression values. They do not expose email, role, account status, another player's profile, or any authentication secret.

Only these fields are writable:

- `displayName`: trimmed, 1–80 characters, or `null` to clear.
- `bio`: trimmed, 0–500 characters, or `null` to clear.

PATCH bodies are strict and non-empty. XP, level, scores, role, status, unlocks, equipped character, user IDs, and unknown properties are rejected. Because browser authentication uses cookies, PATCH requires the signed CSRF cookie value in `X-CSRF-Token` in addition to a valid access session.

A missing profile is created using an idempotent insert inside a transaction. A locking/current read after the insert makes concurrent first requests return the same row. Existing profiles remain readable and editable if no progression policy is active; creating a profile requires an active policy so its starting level is not guessed.

## Active progression policy

The application selects the most recent policy whose `effective_at` is not in the future and whose `retired_at` is null or later than the operation time. Ties are deterministic by database ID. The policy must use the supported `floor` mode and positive safe-integer values.

The seeded `progression-v1` policy is:

- gameplay XP: `floor(validated score / 10)`;
- level: `1 + floor(total XP / 500)`.

If no valid policy is active, new profile creation and XP awards fail with a controlled `503 SERVICE_UNAVAILABLE`; existing profile reads/updates remain available. Historical idempotent award replays use the policy version and level stored in the original ledger metadata and therefore do not silently reinterpret an earlier effect.

## Internal XP award transaction

XP cannot be submitted through HTTP. The internal use case accepts a player public UUID, positive safe-integer amount, source reference, globally unique idempotency key, and one of these trusted server sources:

- `gameplay`
- `leaderboard_reward`
- `achievement`

`admin_adjustment` and `correction` remain reserved for a future explicitly authorized and audited adjustment service. They are rejected by the M04 award use case. Clients, browser claims, and unknown source types are rejected.

For a new award, one transaction:

1. loads the active versioned policy;
2. locks the player's profile row, creating it safely when absent;
3. rechecks the idempotency key after serialization;
4. calculates the new safe-integer balance and level;
5. appends one XP ledger record with policy/level provenance;
6. updates the cached profile total and level;
7. commits both effects together.

The repository retries bounded deadlocks. A repeated key with the same player, amount, source, and reference returns the original balance, level, policy, and timestamp without a second write. Reusing a key for different input returns `XP_IDEMPOTENCY_CONFLICT`. Database update/delete triggers keep the ledger append-only; corrections must be new records rather than mutations.

## XP history and cursor privacy

History is ordered by `(created_at DESC, id DESC)`. The opaque base64url cursor carries a version plus the last timestamp/database ID solely for stable continuation. Every query is still scoped by the authenticated user's public UUID, so editing a cursor cannot select another player's rows.

The default page size is 20 and the accepted range is 1–100. Responses expose amount, balance after, source type, opaque source reference, and UTC creation time. Internal ledger IDs and metadata are omitted. Values outside JavaScript's safe integer range are treated as invalid stored state rather than serialized imprecisely.
