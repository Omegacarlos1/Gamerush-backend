import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { withTransaction } from '../../../infrastructure/database/transaction.js';
import type {
  AuthRepository,
  AuthTransaction,
  NewSessionInput,
  NewUserInput,
} from '../application/auth.ports.js';
import { DuplicateIdentityError } from '../application/auth.ports.js';
import type {
  AccountRole,
  AccountStatus,
  AuthUserRecord,
  RefreshSessionRecord,
  VerificationTokenRecord,
} from '../domain/auth.types.js';

interface UserRow extends RowDataPacket {
  readonly id: number;
  readonly publicId: string;
  readonly email: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly role: AccountRole;
  readonly status: AccountStatus;
  readonly emailVerifiedAt: Date | null;
}

interface SessionRow extends UserRow {
  readonly sessionDatabaseId: number;
  readonly sessionPublicId: string;
  readonly tokenFamilyId: string;
  readonly refreshTokenHash: string;
  readonly replacedBySessionId: number | null;
  readonly sessionExpiresAt: Date;
  readonly revokedAt: Date | null;
  readonly reuseDetectedAt: Date | null;
}

interface LockedSessionRow extends RowDataPacket {
  readonly sessionDatabaseId: number;
  readonly sessionPublicId: string;
  readonly userId: number;
  readonly tokenFamilyId: string;
  readonly refreshTokenHash: string;
  readonly replacedBySessionId: number | null;
  readonly sessionExpiresAt: Date;
  readonly revokedAt: Date | null;
  readonly reuseDetectedAt: Date | null;
}

interface VerificationRow extends RowDataPacket {
  readonly id: number;
  readonly userId: number;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly userStatus: AccountStatus;
}

interface IdRow extends RowDataPacket {
  readonly id: number;
}

const userSelect = `
  SELECT u.id, u.public_id AS publicId, u.email, u.username,
         u.password_hash AS passwordHash, r.code AS role,
         u.status, u.email_verified_at AS emailVerifiedAt
  FROM users u
  INNER JOIN roles r ON r.id = u.role_id`;

const sessionSelect = `
  SELECT u.id, u.public_id AS publicId, u.email, u.username,
         u.password_hash AS passwordHash, r.code AS role,
         u.status, u.email_verified_at AS emailVerifiedAt,
         s.id AS sessionDatabaseId, s.public_id AS sessionPublicId,
         s.token_family_id AS tokenFamilyId,
         s.refresh_token_hash AS refreshTokenHash,
         s.replaced_by_session_id AS replacedBySessionId,
         s.expires_at AS sessionExpiresAt, s.revoked_at AS revokedAt,
         s.reuse_detected_at AS reuseDetectedAt
  FROM auth_sessions s
  INNER JOIN users u ON u.id = s.user_id
  INNER JOIN roles r ON r.id = u.role_id`;

export class MySqlAuthRepository implements AuthRepository {
  public constructor(private readonly pool: Pool) {}

  public async withTransaction<T>(
    operation: (transaction: AuthTransaction) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await withTransaction(this.pool, (connection) =>
          operation(new MySqlAuthTransaction(connection)),
        );
      } catch (error: unknown) {
        if (!isDeadlockError(error) || attempt === 3) throw error;
      }
    }
    throw new Error('Transaction retry limit reached');
  }

  public async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const [rows] = await this.pool.execute<UserRow[]>(`${userSelect} WHERE u.email = ? LIMIT 1`, [
      email,
    ]);
    return rows[0] ?? null;
  }

  public async findAccessContext(
    userPublicId: string,
    sessionPublicId: string,
  ): Promise<RefreshSessionRecord | null> {
    const [rows] = await this.pool.execute<SessionRow[]>(
      `${sessionSelect} WHERE u.public_id = ? AND s.public_id = ? LIMIT 1`,
      [userPublicId, sessionPublicId],
    );
    return rows[0] ?? null;
  }
}

class MySqlAuthTransaction implements AuthTransaction {
  public constructor(private readonly connection: PoolConnection) {}

  public async findRoleId(code: 'player' | 'admin'): Promise<number | null> {
    const [rows] = await this.connection.execute<IdRow[]>(
      'SELECT id FROM roles WHERE code = ? LIMIT 1',
      [code],
    );
    return rows[0]?.id ?? null;
  }

  public async insertPendingUser(input: NewUserInput): Promise<AuthUserRecord> {
    let result: ResultSetHeader;
    try {
      [result] = await this.connection.execute<ResultSetHeader>(
        `INSERT INTO users
          (public_id, email, username, password_hash, role_id, status)
         VALUES (?, ?, ?, ?, ?, 'pending_verification')`,
        [input.publicId, input.email, input.username, input.passwordHash, input.roleId],
      );
    } catch (error: unknown) {
      if (isDuplicateEntryError(error)) throw new DuplicateIdentityError();
      throw error;
    }
    const [rows] = await this.connection.execute<UserRow[]>(`${userSelect} WHERE u.id = ?`, [
      result.insertId,
    ]);
    const user = rows[0];
    if (user === undefined) throw new Error('Inserted user could not be loaded');
    return user;
  }

  public async insertVerificationToken(
    userId: number,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.connection.execute(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
       VALUES (?, 'email_verification', ?, ?)`,
      [userId, tokenHash, expiresAt],
    );
  }

  public async findVerificationTokenForUpdate(
    tokenHash: string,
  ): Promise<VerificationTokenRecord | null> {
    const [rows] = await this.connection.execute<VerificationRow[]>(
      `SELECT t.id, t.user_id AS userId, t.expires_at AS expiresAt,
              t.consumed_at AS consumedAt, u.status AS userStatus
       FROM auth_tokens t
       INNER JOIN users u ON u.id = t.user_id
       WHERE t.purpose = 'email_verification' AND t.token_hash = ?
       LIMIT 1 FOR UPDATE`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  public async consumeVerificationToken(
    tokenId: number,
    userId: number,
    consumedAt: Date,
  ): Promise<void> {
    await this.connection.execute(
      `UPDATE users
       SET status = 'active', email_verified_at = ?
       WHERE id = ? AND status = 'pending_verification'`,
      [consumedAt, userId],
    );
    await this.connection.execute(
      `UPDATE auth_tokens
       SET consumed_at = COALESCE(consumed_at, ?)
       WHERE user_id = ? AND purpose = 'email_verification'`,
      [consumedAt, userId],
    );
    const [rows] = await this.connection.execute<IdRow[]>(
      'SELECT id FROM auth_tokens WHERE id = ? AND consumed_at IS NOT NULL',
      [tokenId],
    );
    if (rows[0] === undefined) throw new Error('Verification token was not consumed');
  }

  public async findRefreshSessionForUpdate(publicId: string): Promise<RefreshSessionRecord | null> {
    const [sessions] = await this.connection.execute<LockedSessionRow[]>(
      `SELECT id AS sessionDatabaseId, public_id AS sessionPublicId, user_id AS userId,
              token_family_id AS tokenFamilyId, refresh_token_hash AS refreshTokenHash,
              replaced_by_session_id AS replacedBySessionId, expires_at AS sessionExpiresAt,
              revoked_at AS revokedAt, reuse_detected_at AS reuseDetectedAt
       FROM auth_sessions WHERE public_id = ? LIMIT 1 FOR UPDATE`,
      [publicId],
    );
    const session = sessions[0];
    if (session === undefined) return null;
    const [users] = await this.connection.execute<UserRow[]>(
      `${userSelect} WHERE u.id = ? LIMIT 1`,
      [session.userId],
    );
    const user = users[0];
    return user === undefined ? null : { ...user, ...session };
  }

  public async insertSession(input: NewSessionInput): Promise<number> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `INSERT INTO auth_sessions
        (public_id, user_id, token_family_id, refresh_token_hash, expires_at,
         ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, INET6_ATON(?), ?)`,
      [
        input.publicId,
        input.userId,
        input.tokenFamilyId,
        input.refreshTokenHash,
        input.expiresAt,
        input.ipAddress,
        input.userAgent,
      ],
    );
    return result.insertId;
  }

  public async rotateSession(
    oldSessionId: number,
    replacementId: number,
    usedAt: Date,
  ): Promise<void> {
    await this.connection.execute(
      `UPDATE auth_sessions
       SET replaced_by_session_id = ?, last_used_at = ?, revoked_at = ?
       WHERE id = ?`,
      [replacementId, usedAt, usedAt, oldSessionId],
    );
  }

  public async revokeTokenFamily(
    tokenFamilyId: string,
    revokedAt: Date,
    reusedSessionId?: number,
  ): Promise<void> {
    if (reusedSessionId !== undefined) {
      await this.connection.execute(
        `UPDATE auth_sessions
         SET reuse_detected_at = COALESCE(reuse_detected_at, ?)
         WHERE id = ?`,
        [revokedAt, reusedSessionId],
      );
    }
    await this.connection.execute(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, ?)
       WHERE token_family_id = ?`,
      [revokedAt, tokenFamilyId],
    );
  }

  public async revokeSession(sessionId: number, revokedAt: Date): Promise<void> {
    await this.connection.execute(
      'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?',
      [revokedAt, sessionId],
    );
  }
}

function isDuplicateEntryError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY'
  );
}

function isDeadlockError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ER_LOCK_DEADLOCK'
  );
}
