import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';

import type { AccountRole } from '../domain/auth.types.js';

const encoder = new TextEncoder();
const refreshTokenPattern =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i;

export interface AccessTokenClaims {
  readonly userPublicId: string;
  readonly sessionPublicId: string;
  readonly role: AccountRole;
}

export class AccessTokenService {
  readonly #key: Uint8Array;

  public constructor(
    secret: string,
    private readonly ttlSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#key = encoder.encode(secret);
  }

  public async issue(claims: AccessTokenClaims): Promise<{ token: string; expiresAt: Date }> {
    const issuedAt = Math.floor(this.now().getTime() / 1_000);
    const expiresAt = new Date((issuedAt + this.ttlSeconds) * 1_000);
    const token = await new SignJWT({ sid: claims.sessionPublicId, role: claims.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userPublicId)
      .setIssuer('playrush-backend')
      .setAudience('playrush-web')
      .setIssuedAt(issuedAt)
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
      .sign(this.#key);
    return { token, expiresAt };
  }

  public async verify(token: string): Promise<AccessTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.#key, {
        issuer: 'playrush-backend',
        audience: 'playrush-web',
        algorithms: ['HS256'],
        requiredClaims: ['sub', 'sid', 'role', 'exp', 'iat'],
        currentDate: this.now(),
      });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string' ||
        (payload.role !== 'player' && payload.role !== 'admin')
      ) {
        return null;
      }
      return {
        userPublicId: payload.sub,
        sessionPublicId: payload.sid,
        role: payload.role,
      };
    } catch {
      return null;
    }
  }
}

export class CsrfTokenService {
  public constructor(private readonly secret: string) {}

  public issue(sessionPublicId: string): string {
    const nonce = randomBytes(32).toString('base64url');
    return `${nonce}.${this.sign(sessionPublicId, nonce)}`;
  }

  public verify(sessionPublicId: string, token: string): boolean {
    const [nonce, signature, extra] = token.split('.');
    if (nonce === undefined || signature === undefined || extra !== undefined) return false;
    const expected = this.sign(sessionPublicId, nonce);
    return safeEqual(signature, expected);
  }

  private sign(sessionPublicId: string, nonce: string): string {
    return createHmac('sha256', this.secret)
      .update(`${sessionPublicId}.${nonce}`)
      .digest('base64url');
  }
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function createRefreshToken(sessionPublicId: string): string {
  return `${sessionPublicId}.${createOpaqueToken()}`;
}

export function parseRefreshToken(token: string): { sessionPublicId: string } | null {
  const match = refreshTokenPattern.exec(token);
  return match?.[1] === undefined ? null : { sessionPublicId: match[1] };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokenHashMatches(token: string, expectedHash: string): boolean {
  return safeEqual(hashToken(token), expectedHash);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
