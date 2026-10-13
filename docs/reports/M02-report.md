# M02 milestone report

## Summary

- Milestone: M02 — Data model and migrations
- Date: 2026-10-13 (Africa/Lagos)
- Branch: `feature/B02-data-model-migrations`
- Starting commit: `947d772`
- Local runtime: Node.js 24.19.0, npm 11.17.0
- Local engine: XAMPP MariaDB 10.4.32
- Production/CI target: MySQL 8.4
- Status: **BLOCKED — implementation and MariaDB acceptance pass; MySQL 8.4 CI result is not yet verified**

## Scope delivered

- Seven ordered, reversible SQL migrations covering identity/access persistence, game/version configuration, profiles/progression, gameplay evidence and verified results, weekly competition, achievements/virtual rewards, moderation, and append-only administration audit history.
- SHA-256 migration checksums, drift detection, advisory locking, status/up/down commands, completed-only history recording, and explicit safe rollback strategy.
- Destructive-operation guard that rejects production and database names not explicitly scoped to development/test.
- Shared transaction helper and deterministic, transaction-backed, repeat-safe non-production catalog seeds.
- Versioned progression and weekly virtual-reward policies matching the approved PRD.
- Local lifecycle integration suite on the dedicated `playrush_migrations_test` schema, left fully migrated and seeded for phpMyAdmin inspection.
- MySQL 8.4 CI configuration, data-model/ER documentation, migration runbook, README, Postman smoke collection, and M03 handoff prompt.

No business HTTP API, authentication behavior, password library, score verification logic, XP award service, leaderboard worker, Socket.IO behavior, frontend, payment, staking, wallet, or cash-reward functionality was added.

## Schema and migration inventory

Migration versions:

1. `0001_identity` — roles, users, revocable auth sessions, single-use auth tokens
2. `0002_game_catalog` — games, immutable versions/rules, cosmetic characters
3. `0003_progression` — versioned progression policy, profiles, append-only XP ledger, character unlocks
4. `0004_gameplay` — server sessions, ordered events, non-authoritative submissions, authoritative verified scores
5. `0005_leaderboards` — UTC periods/grace, best entries, deterministic tie fields, finalized top-10 placements
6. `0006_achievements_rewards` — achievements, badges, versioned top-10 reward rules, idempotent virtual grants
7. `0007_administration` — moderation actions and append-only admin audit events

The migrated local schema contains 28 tables including `schema_migrations`. Seeded counts are: 2 roles, 1 game, 1 game version, 3 characters, 1 progression policy, 2 achievements, 3 badges, 1 reward policy, and 4 placement reward rules. It contains no usable accounts or credentials.

## Product and architecture decisions

- The approved PRD resolves progression as `floor(validated score / 10)` XP and level `1 + floor(total XP / 500)`. The schema versions this policy rather than embedding it in application code.
- Raw claimed scores and replay evidence remain separate from `verified_scores`; only the latter can feed rankings/progression.
- Ranking storage supports highest verified score, then server finish time, then session UUID.
- Top-10 rewards are virtual-only and versioned as 1000/750/500/250 XP with gold/silver/bronze badges for places 1–3.
- XP and admin audit corrections are new append-only records; update/delete triggers reject history mutation.
- Built-in `player` and `admin` roles are created by migration so production identity code does not depend on a prohibited general seed operation.
- No cash-phase entities were added.

## Acceptance evidence

| Criterion                | Local verdict | Evidence                                                                                                    |
| ------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------- |
| Fresh status/apply       | PASS          | Seven pending versions become seven applied versions on empty isolated schema                               |
| Repeat migration         | PASS          | Second up applies zero; history remains seven rows                                                          |
| Drift/failure protection | PASS          | Changed checksum is rejected; forced invalid SQL is not recorded                                            |
| Rollback/re-migrate      | PASS          | One-step and seven-step down pass; zero business tables remain; clean reapply succeeds                      |
| Constraints/indexes      | PASS          | FK, check, unique email, idempotency, verified-score structure, and ranking index tested                    |
| Append-only records      | PASS          | XP and admin-audit update/delete attempts fail                                                              |
| Transaction rollback     | PASS          | Forced DML exception leaves zero inserted user rows                                                         |
| Deterministic seeds      | PASS          | Consecutive runs return identical counts/content                                                            |
| Safety guard             | PASS          | Production and ambiguous target names are refused                                                           |
| M01 regression           | PASS          | Health/configuration/security/database tests remain passing                                                 |
| MariaDB 10.4             | PASS          | Complete 30-test suite and CLI lifecycle executed locally                                                   |
| MySQL 8.4                | PENDING       | CI service is configured, but Docker/MySQL is unavailable locally and remote CI status is not yet evidenced |

## Executed checks

Final local verification from the repository root:

| Command                              | Exit | Result                                                                      |
| ------------------------------------ | ---: | --------------------------------------------------------------------------- |
| `npm run format:check`               |    0 | All matched files use Prettier style                                        |
| `npm run lint`                       |    0 | 0 errors, 0 warnings                                                        |
| `npm run typecheck`                  |    0 | Strict TypeScript check passed                                              |
| `npm test`                           |    0 | 30 passing, 0 failing, 0 pending                                            |
| `npm run build`                      |    0 | Production build passed, including database CLI                             |
| `npm audit --audit-level=high`       |    0 | 0 vulnerabilities                                                           |
| M02 Postman JSON parse               |    0 | Collection parsed successfully; 2 requests                                  |
| MariaDB schema inspection            |    0 | 28 tables, seven history rows, expected seed counts                         |
| Migration CLI status/up/down/up/seed |    0 | 7 applied; repeat 0; rollback 0007; reapply 0007; deterministic seed counts |

MySQL 8.4 CI is not listed as passing because it has not been observed.

### Resolved implementation-time failures

- The inherited format check reported 35 CRLF files although lint/typecheck/tests/build passed. `.gitattributes` now fixes repository text files to LF and the final formatting check passes.
- The first manual CLI check selected the private `.env` password after PowerShell removed an empty password variable; all five commands failed with access denied before schema changes. The rerun explicitly disabled dotenv for that process, used the XAMPP blank local test password, and completed status/up/down/up/seed successfully. No secret value was printed or changed.

## Security and data-integrity notes

- SQL migration definitions are trusted repository artifacts; runtime values and seeds use parameterized queries.
- Migration history detects changed applied files and is serialized with `GET_LOCK`.
- Down/seed refuse production before destructive work and validate underscore-delimited dev/test database names.
- Token/session columns store hashes, never plaintext values. Actual cryptographic generation begins in M03.
- Foreign keys and uniqueness enforce ownership/replay/idempotency boundaries, while application transactions remain required for multi-table business effects.
- MySQL/MariaDB DDL implicitly commits. Failed migrations are not recorded, but partially completed DDL may require the documented down/restore procedure; no false atomic-DDL claim is made.
- Tests operate only on `playrush_migrations_test`. No development, staging, or production data was modified.

## Documentation and API changes

- Added `docs/database/data-model.md` and `docs/database/migrations.md`.
- Updated README and architecture with setup, CLI, recovery, and persistence structure.
- Added M02 Postman/manual smoke examples. No endpoint or OpenAPI contract changed; `/api/v1/health` remains the only implemented endpoint.
- Added the M03 identity/access prompt based on the actual schema and remaining dependencies.

## AGENTS.md changes

- Replaced the progression ambiguity with the approved floor/cumulative formula used by the versioned M02 policy.
- Added durable rules prohibiting edits to applied migrations, restricting rollback/seed targets, acknowledging implicit DDL commits, and preserving append-only XP/audit history.

## Known risks and blockers

- **Blocking acceptance gap:** MySQL 8.4 execution is not locally available and the remote CI result must be confirmed. MariaDB-only success is insufficient under the PRD.
- DDL recovery depends on explicit down migrations/backups because neither supported engine provides transaction-wide DDL rollback.
- Data retention, replay archival, and user-deletion/anonymization periods remain launch decisions.
- The `VALUES(column)` upsert form is portable to MariaDB 10.4 and MySQL 8.4 but deprecated by MySQL; replace it when the project raises its minimum MariaDB version to one supporting the same alias syntax.
- Pre-existing deletion/addition of the consolidated prompt DOCX/Markdown files remains unrelated and excluded from M02 commits.

## Reviewer actions and verdict

- [x] M02 implementation scope complete
- [x] Local MariaDB migration and regression suite pass
- [x] Documentation, Postman, report, and M03 prompt complete
- [ ] Confirm the pushed MySQL 8.4 GitHub Actions run passes

**Verdict: BLOCKED pending MySQL 8.4 CI evidence.** Do not merge or start M03 until the CI result is green and M02 is explicitly approved.

## Pull request description

### What changed

Added the normalized Release 1 schema, seven checksum-verified migrations, safe status/up/down CLI, transactional deterministic seeds, destructive-target guards, full MariaDB lifecycle tests, CI database update, and data/migration documentation.

### Validation

Locally: format, lint, strict typecheck, build, audit, Postman parse, CLI lifecycle, and 30 Mocha tests pass on XAMPP MariaDB 10.4.32. MySQL 8.4 CI confirmation remains required.

### Risks

DDL is implicitly committed, MySQL CI is pending, retention policy is not finalized, and seed upsert syntax will need modernization when MariaDB compatibility permits.
