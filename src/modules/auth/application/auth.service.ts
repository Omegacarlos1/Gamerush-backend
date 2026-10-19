import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';

import type { AppConfig } from '../../../config/environment.js';
import {
  ConflictError,
  ForbiddenError,
  ServiceUnavailableError,
  UnauthorizedError,
} from '../../../shared/errors/app-error.js';
import {
  DuplicateIdentityError,
  type AuthRepository,
  type PasswordHasher,
  type VerificationDelivery,
} from './auth.ports.js';
import type { AuthenticatedUser, PublicUser, RefreshSessionRecord } from '../domain/auth.types.js';
import { toPublicUser } from '../domain/auth.types.js';
import {
  AccessTokenService,
  CsrfTokenService,
  createOpaqueToken,
  createRefreshToken,
  hashToken,
  parseRefreshToken,
  tokenHashMatches,
} from '../infrastructure/auth-token.service.js';

export interface RequestMetadata {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly csrfToken: string;
  readonly accessExpiresAt: Date;
  readonly refreshExpiresAt: Date;
}

export interface AuthSessionResult {
  readonly user: PublicUser;
  readonly tokens: SessionTokens;
}

interface CreatedSession {
  readonly user: PublicUser;
  readonly sessionPublicId: string;
  readonly tokenFamilyId: string;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

export class AuthService {
  readonly #accessTokens: AccessTokenService;
  readonly #csrfTokens: CsrfTokenService;

  public constructor(
    private readonly repository: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly verificationDelivery: VerificationDelivery,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#accessTokens = new AccessTokenService(
      config.auth.accessTokenSecret,
      config.auth.accessTokenTtlSeconds,
      now,
    );
    this.#csrfTokens = new CsrfTokenService(config.auth.csrfSecret);
  }

  public async register(input: {
    email: string;
    username: string;
    password: string;
  }): Promise<PublicUser> {
    const passwordHash = await this.passwordHasher.hash(input.password);
    const verificationToken = createOpaqueToken();
    const expiresAt = this.afterSeconds(this.config.auth.verificationTokenTtlSeconds);

    let user;
    try {
      user = await this.repository.withTransaction(async (transaction) => {
        const roleId = await transaction.findRoleId('player');
        if (roleId === null) throw new ServiceUnavailableError();
        const created = await transaction.insertPendingUser({
          publicId: randomUUID(),
          email: input.email,
          username: input.username,
          passwordHash,
          roleId,
        });
        await transaction.insertVerificationToken(
          created.id,
          hashToken(verificationToken),
          expiresAt,
        );
        return created;
      });
    } catch (error: unknown) {
      if (error instanceof DuplicateIdentityError) {
        throw new ConflictError(
          'ACCOUNT_ALREADY_EXISTS',
          'An account already exists for the supplied identity',
        );
      }
      throw error;
    }

    await this.verificationDelivery.deliver({
      recipient: user.email,
      token: verificationToken,
      expiresAt,
    });
    this.logger.info(
      { event: 'auth.registration.completed', userId: user.publicId },
      'Account registration completed',
    );
    return toPublicUser(user);
  }

  public async verifyEmail(token: string): Promise<void> {
    const now = this.now();
    await this.repository.withTransaction(async (transaction) => {
      const record = await transaction.findVerificationTokenForUpdate(hashToken(token));
      if (record === null) {
        throw new UnauthorizedError(
          'VERIFICATION_TOKEN_INVALID',
          'Verification token is invalid or expired',
        );
      }
      if (
        record.consumedAt !== null ||
        record.expiresAt.getTime() <= now.getTime() ||
        record.userStatus === 'deleted' ||
        record.userStatus === 'suspended'
      ) {
        throw new UnauthorizedError(
          'VERIFICATION_TOKEN_INVALID',
          'Verification token is invalid or expired',
        );
      }
      await transaction.consumeVerificationToken(record.id, record.userId, now);
    });
    this.logger.info({ event: 'auth.email.verified' }, 'Email address verified');
  }

  public async login(
    email: string,
    password: string,
    metadata: RequestMetadata,
  ): Promise<AuthSessionResult> {
    const user = await this.repository.findUserByEmail(email);
    if (user === null) {
      await this.passwordHasher.hash(password);
      throw invalidCredentials();
    }

    let passwordMatches: boolean;
    try {
      passwordMatches = await this.passwordHasher.verify(user.passwordHash, password);
    } catch {
      throw invalidCredentials();
    }
    if (!passwordMatches || user.status === 'deleted') throw invalidCredentials();
    if (user.status === 'pending_verification' || user.emailVerifiedAt === null) {
      throw new ForbiddenError('EMAIL_VERIFICATION_REQUIRED', 'Email verification is required');
    }
    if (user.status === 'suspended') {
      throw new ForbiddenError('ACCOUNT_SUSPENDED', 'Account access is suspended');
    }

    const created = await this.repository.withTransaction(async (transaction) => {
      const session = this.newSession(toPublicUser(user), randomUUID());
      await transaction.insertSession({
        publicId: session.sessionPublicId,
        userId: user.id,
        tokenFamilyId: session.tokenFamilyId,
        refreshTokenHash: hashToken(session.refreshToken),
        expiresAt: session.refreshExpiresAt,
        ...metadata,
      });
      return session;
    });
    this.logger.info({ event: 'auth.login.succeeded', userId: user.publicId }, 'Login succeeded');
    return this.finishSession(created);
  }

  public async refresh(
    refreshToken: string,
    metadata: RequestMetadata,
  ): Promise<AuthSessionResult> {
    const parsed = parseRefreshToken(refreshToken);
    if (parsed === null) throw invalidSession();
    const now = this.now();

    const outcome = await this.repository.withTransaction(async (transaction) => {
      const current = await transaction.findRefreshSessionForUpdate(parsed.sessionPublicId);
      if (current === null || !tokenHashMatches(refreshToken, current.refreshTokenHash)) {
        throw invalidSession();
      }
      if (
        current.revokedAt !== null ||
        current.replacedBySessionId !== null ||
        current.reuseDetectedAt !== null
      ) {
        await transaction.revokeTokenFamily(current.tokenFamilyId, now, current.sessionDatabaseId);
        return { kind: 'reuse' as const };
      }
      if (current.sessionExpiresAt.getTime() <= now.getTime()) {
        await transaction.revokeSession(current.sessionDatabaseId, now);
        return { kind: 'invalid' as const };
      }
      if (current.status !== 'active' || current.emailVerifiedAt === null) {
        await transaction.revokeTokenFamily(current.tokenFamilyId, now);
        if (current.status === 'suspended') return { kind: 'suspended' as const };
        return { kind: 'invalid' as const };
      }

      const created = this.newSession(toPublicUser(current), current.tokenFamilyId);
      const replacementId = await transaction.insertSession({
        publicId: created.sessionPublicId,
        userId: current.id,
        tokenFamilyId: current.tokenFamilyId,
        refreshTokenHash: hashToken(created.refreshToken),
        expiresAt: created.refreshExpiresAt,
        ...metadata,
      });
      await transaction.rotateSession(current.sessionDatabaseId, replacementId, now);
      return { kind: 'success' as const, session: created };
    });

    if (outcome.kind === 'reuse') {
      throw new UnauthorizedError('SESSION_REUSE_DETECTED', 'Session is no longer valid');
    }
    if (outcome.kind === 'suspended') {
      throw new ForbiddenError('ACCOUNT_SUSPENDED', 'Account access is suspended');
    }
    if (outcome.kind === 'invalid') throw invalidSession();
    const replacement = outcome.session;

    this.logger.info(
      { event: 'auth.session.rotated', userId: replacement.user.id },
      'Session rotated',
    );
    return this.finishSession(replacement);
  }

  public async logout(refreshToken: string | null): Promise<void> {
    const parsed = refreshToken === null ? null : parseRefreshToken(refreshToken);
    if (parsed === null || refreshToken === null) return;
    const now = this.now();
    await this.repository.withTransaction(async (transaction) => {
      const session = await transaction.findRefreshSessionForUpdate(parsed.sessionPublicId);
      if (session !== null && tokenHashMatches(refreshToken, session.refreshTokenHash)) {
        await transaction.revokeSession(session.sessionDatabaseId, now);
      }
    });
    this.logger.info({ event: 'auth.logout.completed' }, 'Logout completed');
  }

  public async authenticate(accessToken: string | null): Promise<AuthenticatedUser> {
    if (accessToken === null) throw invalidSession();
    const claims = await this.#accessTokens.verify(accessToken);
    if (claims === null) throw invalidSession();
    const context = await this.repository.findAccessContext(
      claims.userPublicId,
      claims.sessionPublicId,
    );
    if (context === null) throw invalidSession();
    if (
      context.role !== claims.role ||
      context.revokedAt !== null ||
      context.sessionExpiresAt.getTime() <= this.now().getTime()
    ) {
      throw invalidSession();
    }
    this.assertUsableAccount(context);
    return { ...toPublicUser(context), sessionId: context.sessionPublicId };
  }

  public verifyCsrf(sessionPublicId: string, cookieToken: string, headerToken: string): boolean {
    return cookieToken === headerToken && this.#csrfTokens.verify(sessionPublicId, headerToken);
  }

  private assertUsableAccount(user: RefreshSessionRecord): void {
    if (user.status !== 'active' || user.emailVerifiedAt === null) {
      if (user.status === 'suspended') {
        throw new ForbiddenError('ACCOUNT_SUSPENDED', 'Account access is suspended');
      }
      throw invalidSession();
    }
  }

  private newSession(user: PublicUser, tokenFamilyId: string): CreatedSession {
    const sessionPublicId = randomUUID();
    return {
      user,
      sessionPublicId,
      tokenFamilyId,
      refreshToken: createRefreshToken(sessionPublicId),
      refreshExpiresAt: this.afterSeconds(this.config.auth.refreshTokenTtlSeconds),
    };
  }

  private async finishSession(created: CreatedSession): Promise<AuthSessionResult> {
    const access = await this.#accessTokens.issue({
      userPublicId: created.user.id,
      sessionPublicId: created.sessionPublicId,
      role: created.user.role,
    });
    return {
      user: created.user,
      tokens: {
        accessToken: access.token,
        refreshToken: created.refreshToken,
        csrfToken: this.#csrfTokens.issue(created.sessionPublicId),
        accessExpiresAt: access.expiresAt,
        refreshExpiresAt: created.refreshExpiresAt,
      },
    };
  }

  private afterSeconds(seconds: number): Date {
    return new Date(this.now().getTime() + seconds * 1_000);
  }
}

function invalidCredentials(): UnauthorizedError {
  return new UnauthorizedError('INVALID_CREDENTIALS', 'Email or password is incorrect');
}

function invalidSession(): UnauthorizedError {
  return new UnauthorizedError('SESSION_INVALID', 'Session is invalid or expired');
}
