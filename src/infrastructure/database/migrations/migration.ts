export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
  readonly upStatements: readonly string[];
  readonly downStatements: readonly string[];
}

export interface MigrationStatus {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
  readonly state: 'applied' | 'pending';
  readonly appliedAt: Date | null;
}

export interface MigrationResult {
  readonly direction: 'up' | 'down';
  readonly versions: readonly string[];
}

export interface DatabaseSafetyContext {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly databaseName: string;
}
