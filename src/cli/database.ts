import 'dotenv/config';

import { parseEnvironment } from '../config/environment.js';
import { createMySqlPool } from '../infrastructure/database/mysql-pool.js';
import { loadMigrations } from '../infrastructure/database/migrations/migration-loader.js';
import { MigrationRunner } from '../infrastructure/database/migrations/migration-runner.js';
import { seedCatalog } from '../infrastructure/database/seeds/catalog-seed.js';

async function run(): Promise<void> {
  const config = parseEnvironment(process.env);
  const pool = createMySqlPool(config);
  const safetyContext = { nodeEnv: config.nodeEnv, databaseName: config.database.name };

  try {
    const command = process.argv[2];
    const migrations = await loadMigrations();
    const runner = new MigrationRunner(pool, migrations, safetyContext);

    if (command === 'status') {
      const status = await runner.status();
      for (const migration of status) {
        process.stdout.write(`${migration.version} ${migration.state} ${migration.name}\n`);
      }
      return;
    }
    if (command === 'up') {
      const result = await runner.up();
      process.stdout.write(
        `Applied ${result.versions.length} migration(s): ${formatVersions(result.versions)}\n`,
      );
      return;
    }
    if (command === 'down') {
      const steps = parseSteps(process.argv.slice(3));
      const result = await runner.down(steps);
      process.stdout.write(
        `Rolled back ${result.versions.length} migration(s): ${formatVersions(result.versions)}\n`,
      );
      return;
    }
    if (command === 'seed') {
      const result = await seedCatalog(pool, safetyContext);
      process.stdout.write(`Seed completed: ${JSON.stringify(result)}\n`);
      return;
    }

    throw new Error('Expected one of: status, up, down, seed');
  } finally {
    await pool.end();
  }
}

function parseSteps(arguments_: readonly string[]): number {
  const option = arguments_.find((argument) => argument.startsWith('--steps='));
  if (option === undefined) return 1;
  const steps = Number(option.slice('--steps='.length));
  if (!Number.isSafeInteger(steps) || steps < 1) {
    throw new Error('--steps must be a positive integer');
  }
  return steps;
}

function formatVersions(versions: readonly string[]): string {
  return versions.length === 0 ? 'none' : versions.join(', ');
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown database command failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
