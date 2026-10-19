export type AccountStatus = 'pending_verification' | 'active' | 'suspended' | 'deleted';
export type AccountRole = 'player' | 'admin';

export interface AuthUserRecord {
  readonly id: number;
  readonly publicId: string;
  readonly email: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly role: AccountRole;
  readonly status: AccountStatus;
  readonly emailVerifiedAt: Date | null;
}

export interface PublicUser {
  readonly id: string;
  readonly email: string;
  readonly username: string;
  readonly role: AccountRole;
  readonly status: AccountStatus;
  readonly emailVerified: boolean;
}

export interface AuthenticatedUser extends PublicUser {
  readonly sessionId: string;
}

export interface RefreshSessionRecord extends AuthUserRecord {
  readonly sessionDatabaseId: number;
  readonly sessionPublicId: string;
  readonly tokenFamilyId: string;
  readonly refreshTokenHash: string;
  readonly replacedBySessionId: number | null;
  readonly sessionExpiresAt: Date;
  readonly revokedAt: Date | null;
  readonly reuseDetectedAt: Date | null;
}

export interface VerificationTokenRecord {
  readonly id: number;
  readonly userId: number;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly userStatus: AccountStatus;
}

export function toPublicUser(user: AuthUserRecord): PublicUser {
  return {
    id: user.publicId,
    email: user.email,
    username: user.username,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
  };
}
