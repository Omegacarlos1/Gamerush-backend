import { expect } from 'chai';

import {
  MigrationDefinitionError,
  loadMigrations,
  splitSqlStatements,
} from '../../src/infrastructure/database/migrations/migration-loader.js';

describe('migration definitions', () => {
  it('loads ordered migrations with checksums and reversible statements', async () => {
    const migrations = await loadMigrations();

    expect(migrations.map((migration) => migration.version)).to.deep.equal([
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
    ]);
    for (const migration of migrations) {
      expect(migration.checksum).to.match(/^[a-f0-9]{64}$/);
      expect(migration.upStatements.length).to.be.greaterThan(0);
      expect(migration.downStatements.length).to.be.greaterThan(0);
    }
  });

  it('does not split semicolons inside quoted values', () => {
    const statements = splitSqlStatements(
      "INSERT INTO example (value) VALUES ('one;two'); SELECT `semi;colon` FROM example;",
    );

    expect(statements).to.deep.equal([
      "INSERT INTO example (value) VALUES ('one;two')",
      'SELECT `semi;colon` FROM example',
    ]);
  });

  it('rejects unterminated SQL', () => {
    expect(() => splitSqlStatements("SELECT 'unterminated")).to.throw(MigrationDefinitionError);
  });
});
