import { expect } from 'chai';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import pino from 'pino';
import request, { type Response as SupertestResponse } from 'supertest';

import { createApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config/environment.js';
import { createMySqlPool } from '../../src/infrastructure/database/mysql-pool.js';
import { loadMigrations } from '../../src/infrastructure/database/migrations/migration-loader.js';
import { MigrationRunner } from '../../src/infrastructure/database/migrations/migration-runner.js';
import { AuthService } from '../../src/modules/auth/application/auth.service.js';
import type { VerificationDelivery } from '../../src/modules/auth/application/auth.ports.js';
import { Argon2PasswordHasher } from '../../src/modules/auth/infrastructure/argon2-password-hasher.js';
import { MySqlAuthRepository } from '../../src/modules/auth/infrastructure/mysql-auth.repository.js';
import { authCookieNames } from '../../src/modules/auth/presentation/auth.cookies.js';
import { HealthService } from '../../src/modules/health/application/health.service.js';
import { createIntegrationDatabaseConfig } from '../helpers/database.js';

interface CountRow extends RowDataPacket {
  readonly count: number;
}

class CapturingVerificationDelivery implements VerificationDelivery {
  public readonly deliveries: { recipient: string; token: string; expiresAt: Date }[] = [];

  public deliver(input: { recipient: string; token: string; expiresAt: Date }): Promise<void> {
    this.deliveries.push(input);
    return Promise.resolve();
  }
}

describe('M03 identity and access API on the isolated database', function () {
  this.timeout(60_000);

  const baseConfig = createIntegrationDatabaseConfig();
  const password = 'StrongPassword123!';
  let pool: Pool;

  before(async () => {
    pool = createMySqlPool(baseConfig);
    const migrations = await loadMigrations();
    const runner = new MigrationRunner(pool, migrations, {
      nodeEnv: baseConfig.nodeEnv,
      databaseName: baseConfig.database.name,
    });
    await runner.up();
  });

  beforeEach(async () => {
    await cleanIdentityFixtures(pool);
  });

  after(async () => {
    await cleanIdentityFixtures(pool);
    await pool.end();
  });

  it('registers normalized identity data and persists only password/token hashes', async () => {
    const fixture = buildFixture(pool, baseConfig);
    const response = await request(fixture.app)
      .post('/api/v1/auth/register')
      .send({
        email: '  PLAYER@M03.TEST ',
        username: '  Player_One ',
        password,
      })
      .expect(201);

    expect(response.body.data.user).to.include({
      email: 'player@m03.test',
      username: 'player_one',
      role: 'player',
      status: 'pending_verification',
      emailVerified: false,
    });
    expect(JSON.stringify(response.body)).not.to.include(password);
    expect(fixture.delivery.deliveries).to.have.length(1);

    const [users] = await pool.execute<(RowDataPacket & { password_hash: string })[]>(
      'SELECT password_hash FROM users WHERE email = ?',
      ['player@m03.test'],
    );
    const hash = users[0]?.password_hash;
    expect(hash).to.match(/^\$argon2id\$/);
    expect(hash).not.to.include(password);
    expect(await fixture.hasher.verify(hash ?? '', password)).to.equal(true);

    const token = fixture.delivery.deliveries[0]?.token ?? '';
    const [tokens] = await pool.execute<(RowDataPacket & { token_hash: string })[]>(
      `SELECT token_hash FROM auth_tokens WHERE purpose = 'email_verification'`,
    );
    expect(tokens[0]?.token_hash).to.match(/^[a-f0-9]{64}$/);
    expect(tokens[0]?.token_hash).not.to.equal(token);
  });

  it('uses database uniqueness as the final guard for normalized and concurrent duplicates', async () => {
    const fixture = buildFixture(pool, baseConfig);
    await register(fixture.app, 'duplicate@m03.test', 'unique_one', password).expect(201);
    const normalizedDuplicate = await register(
      fixture.app,
      ' DUPLICATE@M03.TEST ',
      'unique_two',
      password,
    ).expect(409);
    expect(normalizedDuplicate.body.error.code).to.equal('ACCOUNT_ALREADY_EXISTS');

    const attempts = await Promise.all([
      register(fixture.app, 'race-one@m03.test', 'raced_name', password),
      register(fixture.app, 'race-two@m03.test', 'raced_name', password),
    ]);
    expect(attempts.map((result) => result.status).sort()).to.deep.equal([201, 409]);
  });

  it('rejects weak or malformed registration input without persistence', async () => {
    const fixture = buildFixture(pool, baseConfig);
    const response = await register(fixture.app, 'not-an-email', 'bad name', 'short').expect(400);
    expect(response.body.error.code).to.equal('INVALID_REQUEST');
    expect(await userCount(pool)).to.equal(0);
  });

  it('consumes an email-verification token once and rejects replay', async () => {
    const fixture = buildFixture(pool, baseConfig);
    const token = await registerAndGetToken(fixture, 'verify@m03.test', 'verify_player');

    await request(fixture.app).post('/api/v1/auth/verify-email').send({ token }).expect(204);
    const replay = await request(fixture.app)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(401);
    expect(replay.body.error.code).to.equal('VERIFICATION_TOKEN_INVALID');

    const [rows] = await pool.execute<(RowDataPacket & { status: string; consumed: number })[]>(
      `SELECT u.status, (t.consumed_at IS NOT NULL) AS consumed
       FROM users u INNER JOIN auth_tokens t ON t.user_id = u.id
       WHERE u.email = ?`,
      ['verify@m03.test'],
    );
    expect(rows[0]).to.include({ status: 'active', consumed: 1 });
  });

  it('rejects an expired email-verification token', async () => {
    const fixture = buildFixture(pool, baseConfig);
    const token = await registerAndGetToken(fixture, 'expired@m03.test', 'expired_player');
    await pool.execute(
      `UPDATE auth_tokens SET expires_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND)
       WHERE purpose = 'email_verification'`,
    );
    const response = await request(fixture.app)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(401);
    expect(response.body.error.code).to.equal('VERIFICATION_TOKEN_INVALID');
  });

  it('does not enumerate unknown accounts through invalid login responses', async () => {
    const fixture = buildFixture(pool, baseConfig);
    await registerVerify(fixture, 'login@m03.test', 'login_player');

    const wrongPassword = await login(fixture.app, 'login@m03.test', 'WrongPassword123!').expect(
      401,
    );
    const unknownEmail = await login(fixture.app, 'unknown@m03.test', 'WrongPassword123!').expect(
      401,
    );
    expect(wrongPassword.body.error.code).to.equal('INVALID_CREDENTIALS');
    expect(unknownEmail.body.error.code).to.equal('INVALID_CREDENTIALS');
    expect(wrongPassword.body.error.message).to.equal(unknownEmail.body.error.message);
  });

  it('enforces pending, suspended, and deleted account login policy', async () => {
    const fixture = buildFixture(pool, baseConfig);
    await registerAndGetToken(fixture, 'state@m03.test', 'state_player');
    const pending = await login(fixture.app, 'state@m03.test', password).expect(403);
    expect(pending.body.error.code).to.equal('EMAIL_VERIFICATION_REQUIRED');

    await pool.execute(
      `UPDATE users SET status = 'suspended', email_verified_at = UTC_TIMESTAMP(6)
       WHERE email = ?`,
      ['state@m03.test'],
    );
    const suspended = await login(fixture.app, 'state@m03.test', password).expect(403);
    expect(suspended.body.error.code).to.equal('ACCOUNT_SUSPENDED');

    await pool.execute(
      `UPDATE users SET status = 'deleted', deleted_at = UTC_TIMESTAMP(6) WHERE email = ?`,
      ['state@m03.test'],
    );
    const deleted = await login(fixture.app, 'state@m03.test', password).expect(401);
    expect(deleted.body.error.code).to.equal('INVALID_CREDENTIALS');
  });

  it('authenticates the current user and rejects invalid or expired access tokens', async () => {
    const clock = { now: new Date('2026-10-19T12:00:00.000Z') };
    const fixture = buildFixture(pool, baseConfig, clock);
    await registerVerify(fixture, 'me@m03.test', 'me_player');
    const signedIn = await login(fixture.app, 'me@m03.test', password).expect(200);
    const cookies = cookieHeader(signedIn);

    const current = await request(fixture.app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookies)
      .expect(200);
    expect(current.body.data.user).to.include({ email: 'me@m03.test', role: 'player' });

    const names = authCookieNames(baseConfig);
    await request(fixture.app)
      .get('/api/v1/auth/me')
      .set('Cookie', `${names.access}=invalid`)
      .expect(401);

    clock.now = new Date(clock.now.getTime() + baseConfig.auth.accessTokenTtlSeconds * 1_000 + 1);
    const expired = await request(fixture.app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookies)
      .expect(401);
    expect(expired.body.error.code).to.equal('SESSION_INVALID');
  });

  it('rotates refresh tokens, detects replay, and revokes the complete token family', async () => {
    const fixture = buildFixture(pool, baseConfig);
    await registerVerify(fixture, 'rotate@m03.test', 'rotate_player');
    const signedIn = await login(fixture.app, 'rotate@m03.test', password).expect(200);
    const oldCookies = cookieHeader(signedIn);
    const oldCsrf = cookieValue(signedIn, authCookieNames(baseConfig).csrf);

    const rotated = await request(fixture.app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldCookies)
      .set('X-CSRF-Token', oldCsrf)
      .expect(200);
    const newCookies = cookieHeader(rotated);

    const replay = await request(fixture.app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldCookies)
      .set('X-CSRF-Token', oldCsrf)
      .expect(401);
    expect(replay.body.error.code).to.equal('SESSION_REUSE_DETECTED');
    await request(fixture.app).get('/api/v1/auth/me').set('Cookie', newCookies).expect(401);

    const [rows] = await pool.execute<(RowDataPacket & { active: number; reused: number })[]>(
      `SELECT SUM(revoked_at IS NULL) AS active, SUM(reuse_detected_at IS NOT NULL) AS reused
       FROM auth_sessions`,
    );
    expect(Number(rows[0]?.active)).to.equal(0);
    expect(Number(rows[0]?.reused)).to.equal(1);
  });

  it('serializes concurrent refresh attempts and leaves no usable replayed family', async () => {
    const fixture = buildFixture(pool, baseConfig);
    await registerVerify(fixture, 'concurrent@m03.test', 'concurrent_player');
    const signedIn = await login(fixture.app, 'concurrent@m03.test', password).expect(200);
    const cookies = cookieHeader(signedIn);
    const csrf = cookieValue(signedIn, authCookieNames(baseConfig).csrf);

    const responses = await Promise.all([
      request(fixture.app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf),
      request(fixture.app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf),
    ]);
    expect(responses.map((response) => response.status).sort()).to.deep.equal([200, 401]);
    const successful = responses.find((response) => response.status === 200);
    expect(successful).not.to.equal(undefined);
    await request(fixture.app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookieHeader(successful as SupertestResponse))
      .expect(401);
  });

  it('rejects expired refresh sessions and records revocation', async () => {
    const fixture = buildFixture(pool, baseConfig);
    await registerVerify(fixture, 'session-expiry@m03.test', 'session_expiry');
    const signedIn = await login(fixture.app, 'session-expiry@m03.test', password).expect(200);
    await pool.execute(
      'UPDATE auth_sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND)',
    );
    await request(fixture.app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(signedIn))
      .set('X-CSRF-Token', cookieValue(signedIn, authCookieNames(baseConfig).csrf))
      .expect(401);
    const [rows] = await pool.execute<CountRow[]>(
      'SELECT COUNT(*) AS count FROM auth_sessions WHERE revoked_at IS NOT NULL',
    );
    expect(Number(rows[0]?.count)).to.equal(1);
  });

  it('requires a valid signed CSRF token for refresh and cookie-backed logout', async () => {
    const fixture = buildFixture(pool, baseConfig);
    await registerVerify(fixture, 'csrf@m03.test', 'csrf_player');
    const signedIn = await login(fixture.app, 'csrf@m03.test', password).expect(200);
    const cookies = cookieHeader(signedIn);
    const refresh = await request(fixture.app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies)
      .expect(403);
    expect(refresh.body.error.code).to.equal('CSRF_VALIDATION_FAILED');
    await request(fixture.app).post('/api/v1/auth/logout').set('Cookie', cookies).expect(403);
  });

  it('revokes logout immediately and treats a repeated cookie-free logout as successful', async () => {
    const fixture = buildFixture(pool, baseConfig);
    await registerVerify(fixture, 'logout@m03.test', 'logout_player');
    const signedIn = await login(fixture.app, 'logout@m03.test', password).expect(200);
    const cookies = cookieHeader(signedIn);
    const csrf = cookieValue(signedIn, authCookieNames(baseConfig).csrf);

    const loggedOut = await request(fixture.app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf)
      .expect(204);
    expect(
      setCookies(loggedOut).some((cookie) => /Expires=Thu, 01 Jan 1970/i.test(cookie)),
    ).to.equal(true);
    await request(fixture.app).get('/api/v1/auth/me').set('Cookie', cookies).expect(401);
    await request(fixture.app).post('/api/v1/auth/logout').expect(204);
  });

  it('enforces player/admin roles and live account status', async () => {
    const fixture = buildFixture(pool, baseConfig);
    await registerVerify(fixture, 'role@m03.test', 'role_player');
    const playerLogin = await login(fixture.app, 'role@m03.test', password).expect(200);
    await request(fixture.app)
      .get('/api/v1/auth/admin-check')
      .set('Cookie', cookieHeader(playerLogin))
      .expect(403);

    await pool.execute(
      `UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'admin') WHERE email = ?`,
      ['role@m03.test'],
    );
    const adminLogin = await login(fixture.app, 'role@m03.test', password).expect(200);
    await request(fixture.app)
      .get('/api/v1/auth/admin-check')
      .set('Cookie', cookieHeader(adminLogin))
      .expect(200);

    await pool.execute(`UPDATE users SET status = 'suspended' WHERE email = ?`, ['role@m03.test']);
    const suspended = await request(fixture.app)
      .get('/api/v1/auth/me')
      .set('Cookie', cookieHeader(adminLogin))
      .expect(403);
    expect(suspended.body.error.code).to.equal('ACCOUNT_SUSPENDED');
  });

  it('applies a dedicated rate limit to registration and login attempts', async () => {
    const limitedConfig: AppConfig = {
      ...baseConfig,
      auth: { ...baseConfig.auth, rateLimit: { windowMs: 60_000, max: 1 } },
    };
    const fixture = buildFixture(pool, limitedConfig);
    await login(fixture.app, 'missing@m03.test', 'WrongPassword123!').expect(401);
    const limited = await login(fixture.app, 'still-missing@m03.test', 'WrongPassword123!').expect(
      429,
    );
    expect(limited.body.error.code).to.equal('AUTH_RATE_LIMIT_EXCEEDED');
  });

  it('sets host-only HttpOnly strict cookies without exposing tokens in JSON', async () => {
    const fixture = buildFixture(pool, baseConfig);
    await registerVerify(fixture, 'cookies@m03.test', 'cookies_player');
    const response = await login(fixture.app, 'cookies@m03.test', password).expect(200);
    const cookies = setCookies(response);
    const names = authCookieNames(baseConfig);
    const accessCookie = cookies.find((cookie) => cookie.startsWith(`${names.access}=`)) ?? '';
    const refreshCookie = cookies.find((cookie) => cookie.startsWith(`${names.refresh}=`)) ?? '';
    const csrfCookie = cookies.find((cookie) => cookie.startsWith(`${names.csrf}=`)) ?? '';

    expect(accessCookie)
      .to.include('HttpOnly')
      .and.to.include('SameSite=Strict')
      .and.to.include('Path=/');
    expect(refreshCookie).to.include('HttpOnly').and.to.include('SameSite=Strict');
    expect(csrfCookie).not.to.include('HttpOnly');
    expect(response.body.data).not.to.have.any.keys('accessToken', 'refreshToken', 'csrfToken');

    const secureConfig: AppConfig = {
      ...baseConfig,
      auth: { ...baseConfig.auth, cookieSecure: true },
    };
    const secureFixture = buildFixture(pool, secureConfig);
    const secureResponse = await login(secureFixture.app, 'cookies@m03.test', password).expect(200);
    const secureCookies = setCookies(secureResponse);
    expect(secureCookies.some((cookie) => cookie.startsWith('__Host-playrush_access='))).to.equal(
      true,
    );
    expect(secureCookies.every((cookie) => cookie.includes('Secure'))).to.equal(true);
  });
});

function buildFixture(
  pool: Pool,
  config: AppConfig,
  clock: { now: Date } = { now: new Date() },
): {
  app: Express;
  delivery: CapturingVerificationDelivery;
  hasher: Argon2PasswordHasher;
} {
  const delivery = new CapturingVerificationDelivery();
  const hasher = new Argon2PasswordHasher();
  const logger = pino({ level: 'silent' });
  const authService = new AuthService(
    new MySqlAuthRepository(pool),
    hasher,
    delivery,
    config,
    logger,
    () => clock.now,
  );
  const healthService = new HealthService(() => Promise.resolve(), logger);
  return {
    app: createApp({ config, logger, healthService, authService }),
    delivery,
    hasher,
  };
}

function register(app: Express, email: string, username: string, registrationPassword: string) {
  return request(app)
    .post('/api/v1/auth/register')
    .send({ email, username, password: registrationPassword });
}

function login(app: Express, email: string, loginPassword: string) {
  return request(app).post('/api/v1/auth/login').send({ email, password: loginPassword });
}

async function registerAndGetToken(
  fixture: ReturnType<typeof buildFixture>,
  email: string,
  username: string,
): Promise<string> {
  await register(fixture.app, email, username, 'StrongPassword123!').expect(201);
  const token = fixture.delivery.deliveries.at(-1)?.token;
  if (token === undefined) throw new Error('Verification token was not captured');
  return token;
}

async function registerVerify(
  fixture: ReturnType<typeof buildFixture>,
  email: string,
  username: string,
): Promise<void> {
  const token = await registerAndGetToken(fixture, email, username);
  await request(fixture.app).post('/api/v1/auth/verify-email').send({ token }).expect(204);
}

function setCookies(response: SupertestResponse): string[] {
  const header = response.headers['set-cookie'] as unknown;
  if (!Array.isArray(header) || !header.every((value) => typeof value === 'string')) {
    throw new Error('Expected Set-Cookie response headers');
  }
  return header;
}

function cookieHeader(response: SupertestResponse): string {
  return setCookies(response)
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');
}

function cookieValue(response: SupertestResponse, name: string): string {
  const cookie = setCookies(response).find((candidate) => candidate.startsWith(`${name}=`));
  const value = cookie?.split(';', 1)[0]?.slice(name.length + 1);
  if (value === undefined) throw new Error(`Cookie ${name} was not found`);
  return decodeURIComponent(value);
}

async function userCount(pool: Pool): Promise<number> {
  const [rows] = await pool.execute<CountRow[]>(
    `SELECT COUNT(*) AS count FROM users WHERE email LIKE '%@m03.test'`,
  );
  return Number(rows[0]?.count);
}

async function cleanIdentityFixtures(pool: Pool): Promise<void> {
  await pool.execute(
    `DELETE s FROM auth_sessions s INNER JOIN users u ON u.id = s.user_id
     WHERE u.email LIKE '%@m03.test'`,
  );
  await pool.execute(
    `DELETE t FROM auth_tokens t INNER JOIN users u ON u.id = t.user_id
     WHERE u.email LIKE '%@m03.test'`,
  );
  await pool.execute(`DELETE FROM users WHERE email LIKE '%@m03.test'`);
}
