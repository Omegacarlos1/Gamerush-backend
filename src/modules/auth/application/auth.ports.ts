import type {
  AuthUserRecord,
  RefreshSessionRecord,
  VerificationTokenRecord,
} from '../domain/auth.types.js';

export interface NewUserInput {
  readonly publicId: string;
  readonly email: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly roleId: number;
}

export interface NewSessionInput {
  readonly publicId: string;
  readonly userId: number;
  readonly tokenFamilyId: string;
  readonly refreshTokenHash: string;
  readonly expiresAt: Date;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface AuthTransaction {
  findRoleId(code: 'player' | 'admin'): Promise<number | null>;
  insertPendingUser(input: NewUserInput): Promise<AuthUserRecord>;
  insertVerificationToken(userId: number, tokenHash: string, expiresAt: Date): Promise<void>;
  findVerificationTokenForUpdate(tokenHash: string): Promise<VerificationTokenRecord | null>;
  consumeVerificationToken(tokenId: number, userId: number, consumedAt: Date): Promise<void>;
  findRefreshSessionForUpdate(publicId: string): Promise<RefreshSessionRecord | null>;
  insertSession(input: NewSessionInput): Promise<number>;
  rotateSession(oldSessionId: number, replacementId: number, usedAt: Date): Promise<void>;
  revokeTokenFamily(
    tokenFamilyId: string,
    revokedAt: Date,
    reusedSessionId?: number,
  ): Promise<void>;
  revokeSession(sessionId: number, revokedAt: Date): Promise<void>;
}

export interface AuthRepository {
  withTransaction<T>(operation: (transaction: AuthTransaction) => Promise<T>): Promise<T>;
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  findAccessContext(
    userPublicId: string,
    sessionPublicId: string,
  ): Promise<RefreshSessionRecord | null>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

export interface VerificationDelivery {
  deliver(input: {
    readonly recipient: string;
    readonly token: string;
    readonly expiresAt: Date;
  }): Promise<void>;
}

export class DuplicateIdentityError extends Error {
  public constructor() {
    super('Identity is already in use');
    this.name = 'DuplicateIdentityError';
  }
}
