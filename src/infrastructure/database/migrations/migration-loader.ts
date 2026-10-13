import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Migration } from './migration.js';

const migrationFilenamePattern = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const upMarker = '-- migrate:up';
const downMarker = '-- migrate:down';

export class MigrationDefinitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MigrationDefinitionError';
  }
}

export function defaultMigrationsDirectory(): string {
  return resolve(process.cwd(), 'database', 'migrations');
}

export async function loadMigrations(
  directory = defaultMigrationsDirectory(),
): Promise<Migration[]> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .sort((left, right) => left.name.localeCompare(right.name));
  const migrations: Migration[] = [];
  const versions = new Set<string>();

  for (const entry of entries) {
    const match = migrationFilenamePattern.exec(entry.name);
    if (match === null) {
      throw new MigrationDefinitionError(`Invalid migration filename: ${entry.name}`);
    }

    const version = match[1];
    const name = match[2];
    if (version === undefined || name === undefined) {
      throw new MigrationDefinitionError(`Unable to parse migration filename: ${entry.name}`);
    }
    if (versions.has(version)) {
      throw new MigrationDefinitionError(`Duplicate migration version: ${version}`);
    }

    const rawSql = await readFile(resolve(directory, entry.name), 'utf8');
    const normalizedSql = rawSql.replaceAll('\r\n', '\n');
    const sections = parseMigrationSections(normalizedSql, entry.name);
    migrations.push({
      version,
      name,
      checksum: createHash('sha256').update(normalizedSql).digest('hex'),
      upStatements: splitSqlStatements(sections.up),
      downStatements: splitSqlStatements(sections.down),
    });
    versions.add(version);
  }

  if (migrations.length === 0) {
    throw new MigrationDefinitionError(`No migration files found in ${directory}`);
  }

  return migrations;
}

function parseMigrationSections(sql: string, filename: string): { up: string; down: string } {
  const upIndex = sql.indexOf(upMarker);
  const downIndex = sql.indexOf(downMarker);

  if (upIndex === -1 || downIndex === -1 || downIndex <= upIndex) {
    throw new MigrationDefinitionError(
      `${filename} must contain ordered ${upMarker} and ${downMarker} sections`,
    );
  }

  return {
    up: sql.slice(upIndex + upMarker.length, downIndex),
    down: sql.slice(downIndex + downMarker.length),
  };
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: "'" | '"' | '`' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (character === undefined) continue;

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      current += character;
      if (character === '\\' && next !== undefined) {
        current += next;
        index += 1;
      } else if (character === quote) {
        if (next === quote) {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if ((character === '-' && next === '-') || character === '#') {
      lineComment = true;
      if (next === '-') index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      current += character;
      continue;
    }
    if (character === ';') {
      const statement = current.trim();
      if (statement.length > 0) statements.push(statement);
      current = '';
      continue;
    }
    current += character;
  }

  if (quote !== null || blockComment) {
    throw new MigrationDefinitionError('Migration SQL contains an unterminated quote or comment');
  }
  const trailing = current.trim();
  if (trailing.length > 0) statements.push(trailing);
  return statements;
}
