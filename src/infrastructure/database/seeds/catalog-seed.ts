import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

import { assertSafeDatabaseOperation } from '../database-safety.js';
import type { DatabaseSafetyContext } from '../migrations/migration.js';
import { withTransaction } from '../transaction.js';

interface IdRow extends RowDataPacket {
  readonly id: number;
}

export interface SeedResult {
  readonly roles: number;
  readonly games: number;
  readonly gameVersions: number;
  readonly characters: number;
  readonly progressionPolicies: number;
  readonly achievements: number;
  readonly badges: number;
  readonly rewardPolicies: number;
  readonly rewardRules: number;
}

export async function seedCatalog(
  pool: Pool,
  safetyContext: DatabaseSafetyContext,
): Promise<SeedResult> {
  assertSafeDatabaseOperation('seed', safetyContext);

  return await withTransaction(pool, async (connection) => {
    await seedRoles(connection);
    const gameId = await seedGame(connection);
    const gameVersionId = await seedGameVersion(connection, gameId);
    await seedCharacters(connection, gameId);
    await seedProgressionPolicy(connection);
    await seedAchievements(connection);
    await seedBadges(connection);
    await seedRewardPolicy(connection);
    await connection.execute('UPDATE games SET active_version_id = ?, status = ? WHERE id = ?', [
      gameVersionId,
      'active',
      gameId,
    ]);

    return await readSeedCounts(connection);
  });
}

async function seedRoles(connection: PoolConnection): Promise<void> {
  await connection.execute(
    `INSERT INTO roles (code, description) VALUES
      (?, ?),
      (?, ?)
    ON DUPLICATE KEY UPDATE description = VALUES(description)`,
    ['player', 'Standard player account', 'admin', 'Administrator account'],
  );
}

async function seedGame(connection: PoolConnection): Promise<number> {
  await connection.execute(
    `INSERT INTO games (public_id, slug, name, description, status)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`,
    [
      '10000000-0000-4000-8000-000000000001',
      'endless-runner',
      'PlayRush Endless Runner',
      'Release 1 deterministic endless runner',
      'active',
    ],
  );
  return await selectId(connection, 'SELECT id FROM games WHERE slug = ?', ['endless-runner']);
}

async function seedGameVersion(connection: PoolConnection, gameId: number): Promise<number> {
  const rules = JSON.stringify({
    metresPerPoint: 1,
    pointsPerCoin: 10,
    sessionDurationSeconds: 300,
  });
  await connection.execute(
    `INSERT INTO game_versions
      (public_id, game_id, version_number, rules_version, scoring_rules, max_session_seconds, status, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE rules_version = VALUES(rules_version), scoring_rules = VALUES(scoring_rules),
       max_session_seconds = VALUES(max_session_seconds), status = VALUES(status), published_at = VALUES(published_at)`,
    [
      '20000000-0000-4000-8000-000000000001',
      gameId,
      '1.0.0',
      'runner-score-v1',
      rules,
      300,
      'published',
      new Date('2026-10-13T00:00:00.000Z'),
    ],
  );
  return await selectId(
    connection,
    'SELECT id FROM game_versions WHERE game_id = ? AND version_number = ?',
    [gameId, '1.0.0'],
  );
}

async function seedCharacters(connection: PoolConnection, gameId: number): Promise<void> {
  const characters = [
    ['30000000-0000-4000-8000-000000000001', 'starter', 'Starter', 1],
    ['30000000-0000-4000-8000-000000000002', 'level-three', 'Level Three', 3],
    ['30000000-0000-4000-8000-000000000003', 'level-five', 'Level Five', 5],
  ] as const;

  for (const [publicId, slug, name, unlockLevel] of characters) {
    await connection.execute(
      `INSERT INTO characters
        (public_id, game_id, slug, name, unlock_level, is_cosmetic_only, status)
       VALUES (?, ?, ?, ?, ?, 1, 'active')
       ON DUPLICATE KEY UPDATE name = VALUES(name), unlock_level = VALUES(unlock_level),
         is_cosmetic_only = 1, status = 'active'`,
      [publicId, gameId, slug, name, unlockLevel],
    );
  }
}

async function seedProgressionPolicy(connection: PoolConnection): Promise<void> {
  await connection.execute(
    `INSERT INTO progression_policy_versions
      (version, score_points_per_xp, xp_per_level, starting_level, rounding_mode, effective_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE score_points_per_xp = VALUES(score_points_per_xp),
       xp_per_level = VALUES(xp_per_level), starting_level = VALUES(starting_level),
       rounding_mode = VALUES(rounding_mode), effective_at = VALUES(effective_at)`,
    ['progression-v1', 10, 500, 1, 'floor', new Date('2026-10-13T00:00:00.000Z')],
  );
}

async function seedAchievements(connection: PoolConnection): Promise<void> {
  const achievements = [
    [
      '40000000-0000-4000-8000-000000000001',
      'first-verified-run',
      'First Verified Run',
      'Complete one validated ranked run.',
      { type: 'verified_run_count', threshold: 1 },
    ],
    [
      '40000000-0000-4000-8000-000000000002',
      'coin-collector-100',
      'Coin Collector',
      'Collect 100 validated coins across ranked runs.',
      { type: 'verified_coin_total', threshold: 100 },
    ],
  ] as const;

  for (const [publicId, code, name, description, criteria] of achievements) {
    await connection.execute(
      `INSERT INTO achievements (public_id, code, name, description, criteria, status)
       VALUES (?, ?, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description),
         criteria = VALUES(criteria), status = 'active'`,
      [publicId, code, name, description, JSON.stringify(criteria)],
    );
  }
}

async function seedBadges(connection: PoolConnection): Promise<void> {
  const badges = [
    ['weekly-gold', 'Weekly Gold', 'Awarded for first place in a finalized weekly period.'],
    ['weekly-silver', 'Weekly Silver', 'Awarded for second place in a finalized weekly period.'],
    ['weekly-bronze', 'Weekly Bronze', 'Awarded for third place in a finalized weekly period.'],
  ] as const;

  for (const [code, name, description] of badges) {
    await connection.execute(
      `INSERT INTO badges (code, name, description)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`,
      [code, name, description],
    );
  }
}

async function seedRewardPolicy(connection: PoolConnection): Promise<void> {
  await connection.execute(
    `INSERT INTO reward_policy_versions (version, status, effective_at)
     VALUES (?, 'active', ?)
     ON DUPLICATE KEY UPDATE status = 'active', effective_at = VALUES(effective_at)`,
    ['weekly-rewards-v1', new Date('2026-10-13T00:00:00.000Z')],
  );
  const policyId = await selectId(
    connection,
    'SELECT id FROM reward_policy_versions WHERE version = ?',
    ['weekly-rewards-v1'],
  );
  const goldBadgeId = await selectId(connection, 'SELECT id FROM badges WHERE code = ?', [
    'weekly-gold',
  ]);
  const silverBadgeId = await selectId(connection, 'SELECT id FROM badges WHERE code = ?', [
    'weekly-silver',
  ]);
  const bronzeBadgeId = await selectId(connection, 'SELECT id FROM badges WHERE code = ?', [
    'weekly-bronze',
  ]);
  const rules = [
    [1, 1, 1000, goldBadgeId],
    [2, 2, 750, silverBadgeId],
    [3, 3, 500, bronzeBadgeId],
    [4, 10, 250, null],
  ] as const;

  for (const [placementFrom, placementTo, xpAmount, badgeId] of rules) {
    await connection.execute(
      `INSERT INTO leaderboard_reward_rules
        (reward_policy_version_id, placement_from, placement_to, xp_amount, badge_id)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE xp_amount = VALUES(xp_amount), badge_id = VALUES(badge_id)`,
      [policyId, placementFrom, placementTo, xpAmount, badgeId],
    );
  }
}

async function selectId(
  connection: PoolConnection,
  sql: string,
  parameters: readonly (string | number | Date)[],
): Promise<number> {
  const [rows] = await connection.execute<IdRow[]>(sql, [...parameters]);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('Seeded record could not be read back');
  return id;
}

async function readSeedCounts(connection: PoolConnection): Promise<SeedResult> {
  const [rows] = await connection.query<
    (RowDataPacket & { table_name: keyof SeedResult; row_count: number })[]
  >(`
    SELECT 'roles' AS table_name, COUNT(*) AS row_count FROM roles
    UNION ALL SELECT 'games', COUNT(*) FROM games
    UNION ALL SELECT 'gameVersions', COUNT(*) FROM game_versions
    UNION ALL SELECT 'characters', COUNT(*) FROM characters
    UNION ALL SELECT 'progressionPolicies', COUNT(*) FROM progression_policy_versions
    UNION ALL SELECT 'achievements', COUNT(*) FROM achievements
    UNION ALL SELECT 'badges', COUNT(*) FROM badges
    UNION ALL SELECT 'rewardPolicies', COUNT(*) FROM reward_policy_versions
    UNION ALL SELECT 'rewardRules', COUNT(*) FROM leaderboard_reward_rules
  `);
  const values = Object.fromEntries(rows.map((row) => [row.table_name, row.row_count]));
  return values as unknown as SeedResult;
}
