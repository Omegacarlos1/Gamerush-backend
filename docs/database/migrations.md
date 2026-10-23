# Migration and seed operations

## Files and history

Migration definitions live in `database/migrations` and use ordered filenames plus explicit sections:

```sql
-- migrate:up
-- forward SQL

-- migrate:down
-- reverse SQL
```

The runner normalizes line endings, calculates SHA-256 checksums, acquires the `playrush_schema_migrations` advisory lock, and records a version only after all its forward statements finish. It refuses changed or missing applied definitions.

## Commands

Use the database selected by `.env`:

```powershell
npm run db:migrate:status
npm run db:migrate:up
npm run db:migrate:down -- --steps=1
npm run db:seed
```

`up` is valid for controlled deployment environments. `down` and `seed` are deliberately stricter: they refuse `NODE_ENV=production` and require a database name visibly containing `dev`, `development`, or `test` as its own underscore-delimited segment.

Always back up persistent data before rollback. MySQL and MariaDB implicitly commit DDL, so a multi-statement schema migration cannot be transactionally undone as a unit. If a DDL statement fails, the migration is not recorded; inspect the database and use its down section or restore procedure before retrying. DML services and seeds use explicit transactions.

The migration account needs normal DDL privileges plus `TRIGGER`. When MySQL binary logging is enabled, an administrator must also set `log_bin_trust_function_creators=1` before applying migrations with the least-privilege migration account. This permits the append-only XP/audit triggers without granting that account `SUPER`; the CI MySQL service configures the setting explicitly. This is an infrastructure prerequisite, not an application runtime privilege.

## Local XAMPP verification

The automated lifecycle suite defaults to `playrush_migrations_test`. It may roll back every known M02 table and must never point at development, staging, or production data. Configure a dedicated test account through:

- `TEST_DB_HOST`
- `TEST_DB_PORT`
- `TEST_DB_USER`
- `TEST_DB_PASSWORD`
- `TEST_DB_NAME`

After a successful suite, the test schema is left fully migrated and seeded for inspection in phpMyAdmin.

M03 requires no new migration: the approved `0001_identity` tables already support credential hashes, verification tokens, refresh-token families, replacement linkage, revocation, reuse detection, and expiry. M03 adds application behavior only and does not modify any applied SQL file.

M04 also requires no new migration. The immutable `0003_progression` definition already supplies bounded profile fields, cached XP/level values, versioned policies, the global XP idempotency key, stable history ordering index, JSON provenance metadata, and append-only update/delete triggers. M04 consumes those structures through parameterized transactional repository operations without changing migrations `0001`–`0007`.

M05 requires no new migration. `0002_game_catalog` already links each active game to an immutable version with rules and a bounded duration; `0004_gameplay` already fixes session owner/version/mode, hash-only seed and nonce material, server timestamps, and lifecycle states. The portable duplicate policy is transactionally serialized with a user-row lock rather than a MySQL-specific partial index. Applied migrations `0001`–`0007` remain byte-for-byte unchanged.

M06 also requires no new migration. `0004_gameplay` already separates ordered evidence/non-authoritative claims from the unique authoritative score, and `0003_progression` already supplies the globally idempotent append-only XP effect and cached profile fields. A session row lock serializes submission, while existing unique keys enforce idempotency, session digest, one verified score per session/submission, and one gameplay XP key. All seven applied migrations remain byte-for-byte unchanged.

## Seed contents

Seeds are deterministic and repeat-safe. They contain two roles, one endless-runner game/version, three cosmetic characters, one progression policy, two achievement definitions, three weekly placement badges, and four top-10 virtual reward rules. They contain no usable accounts, passwords, sessions, or tokens.
