import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';

import { expect } from 'chai';
import type { Express } from 'express';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pino, { type Logger } from 'pino';
import request, { type Response as SupertestResponse } from 'supertest';

import { createApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config/environment.js';
import { createMySqlPool } from '../../src/infrastructure/database/mysql-pool.js';
import { loadMigrations } from '../../src/infrastructure/database/migrations/migration-loader.js';
import { MigrationRunner } from '../../src/infrastructure/database/migrations/migration-runner.js';
import { seedCatalog } from '../../src/infrastructure/database/seeds/catalog-seed.js';
import { AuthService } from '../../src/modules/auth/application/auth.service.js';
import type { VerificationDelivery } from '../../src/modules/auth/application/auth.ports.js';
import { Argon2PasswordHasher } from '../../src/modules/auth/infrastructure/argon2-password-hasher.js';
import { MySqlAuthRepository } from '../../src/modules/auth/infrastructure/mysql-auth.repository.js';
import { authCookieNames } from '../../src/modules/auth/presentation/auth.cookies.js';
import { GameService } from '../../src/modules/games/application/game.service.js';
import { MySqlGameRepository } from '../../src/modules/games/infrastructure/mysql-game.repository.js';
import { HealthService } from '../../src/modules/health/application/health.service.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import { createLogger } from '../../src/shared/logging/logger.js';
import { createIntegrationDatabaseConfig } from '../helpers/database.js';

interface SessionPersistenceRow extends RowDataPacket {
  readonly publicId: string;
  readonly versionPublicId: string;
  readonly mode: string;
  readonly status: string;
  readonly seedHash: string;
  readonly nonceHash: string;
  readonly startedAt: Date;
  readonly expiresAt: Date;
}

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

describe('M05 games and server-issued sessions on the isolated database', function () {
  this.timeout(60_000);

  const config = createIntegrationDatabaseConfig();
  const clock = { now: new Date('2026-10-21T14:00:00.000Z') };
  let pool: Pool;

  before(async () => {
    pool = createMySqlPool(config);
    const migrations = await loadMigrations();
    const runner = new MigrationRunner(pool, migrations, {
      nodeEnv: config.nodeEnv,
      databaseName: config.database.name,
    });
    await runner.up();
  });

  beforeEach(async () => {
    clock.now = new Date('2026-10-21T14:00:00.000Z');
    await cleanM05Fixtures(pool);
    await seedCatalog(pool, {
      nodeEnv: config.nodeEnv,
      databaseName: config.database.name,
    });
  });

  after(async () => {
    await cleanM05Fixtures(pool);
    await seedCatalog(pool, {
      nodeEnv: config.nodeEnv,
      databaseName: config.database.name,
    });
    await pool.end();
  });

  it('lists and details only active games with a published active version', async () => {
    const fixture = buildFixture(pool, config, clock);
    const draftGameId = '51000000-0000-4000-8000-000000000001';
    const retiredGameId = '51000000-0000-4000-8000-000000000002';
    const draftVersionGameId = '51000000-0000-4000-8000-000000000003';
    const retiredVersionGameId = '51000000-0000-4000-8000-000000000004';
    await insertCatalogFixture(pool, draftGameId, 'm05-draft', 'draft', 'published');
    await insertCatalogFixture(pool, retiredGameId, 'm05-retired', 'retired', 'published');
    await insertCatalogFixture(pool, draftVersionGameId, 'm05-draft-version', 'active', 'draft');
    await insertCatalogFixture(
      pool,
      retiredVersionGameId,
      'm05-retired-version',
      'active',
      'retired',
    );

    const listed = await request(fixture.app).get('/api/v1/games').expect(200);
    expect(listed.headers['cache-control']).to.equal(
      'public, max-age=60, stale-while-revalidate=30',
    );
    expect(listed.body.data.games).to.have.length(1);
    expect(listed.body.data.games[0]).to.deep.include({
      id: '10000000-0000-4000-8000-000000000001',
      slug: 'endless-runner',
      name: 'PlayRush Endless Runner',
    });
    expect(listed.body.data.games[0].activeVersion).to.deep.include({
      id: '20000000-0000-4000-8000-000000000001',
      versionNumber: '1.0.0',
      rulesVersion: 'runner-score-v1',
      maxSessionSeconds: 300,
    });
    expect(listed.body.data.games[0].activeVersion.scoringRules).to.deep.equal({
      metresPerPoint: 1,
      pointsPerCoin: 10,
      sessionDurationSeconds: 300,
    });
    expect(listed.body.data.games[0].characters).to.have.length(3);
    expect(listed.body.data.games[0]).not.to.have.property('databaseId');

    const detail = await request(fixture.app)
      .get('/api/v1/games/10000000-0000-4000-8000-000000000001')
      .expect(200);
    expect(detail.body.data.game.id).to.equal('10000000-0000-4000-8000-000000000001');

    for (const hiddenId of [draftGameId, retiredGameId, draftVersionGameId, retiredVersionGameId]) {
      const hidden = await request(fixture.app).get(`/api/v1/games/${hiddenId}`).expect(404);
      expect(hidden.body.error.code).to.equal('GAME_NOT_FOUND');
    }
  });

  it('creates ranked and practice sessions with fixed server time, version, and one-time secrets', async () => {
    const fixture = buildFixture(pool, config, clock);
    await createActivePlayer(fixture, 'create@m05.test', 'create_m05');
    const signedIn = await signIn(fixture.app, 'create@m05.test', config);

    const ranked = await createSession(fixture.app, signedIn, 'ranked').expect(201);
    const practice = await createSession(fixture.app, signedIn, 'practice').expect(201);

    for (const response of [ranked, practice]) {
      expect(response.headers['cache-control']).to.equal('no-store');
      expect(response.body.data.session).to.deep.include({
        status: 'active',
        startedAt: '2026-10-21T14:00:00.000Z',
        expiresAt: '2026-10-21T14:05:00.000Z',
      });
      expect(response.body.data.session.version).to.deep.include({
        id: '20000000-0000-4000-8000-000000000001',
        rulesVersion: 'runner-score-v1',
        maxSessionSeconds: 300,
      });
      expect(response.body.data.credentials.seed).to.match(/^[A-Za-z0-9_-]{43}$/);
      expect(response.body.data.credentials.nonce).to.match(/^[A-Za-z0-9_-]{43}$/);
      expect(response.body.data.credentials.seed).not.to.equal(
        response.body.data.credentials.nonce,
      );
      expect(JSON.stringify(response.body)).not.to.include('seedHash');
      expect(JSON.stringify(response.body)).not.to.include('nonceHash');
    }
    expect(ranked.body.data.session.id).not.to.equal(practice.body.data.session.id);
    expect(ranked.body.data.credentials.seed).not.to.equal(practice.body.data.credentials.seed);

    const persisted = await readPersistedSession(pool, ranked.body.data.session.id as string);
    expect(persisted).to.include({
      versionPublicId: '20000000-0000-4000-8000-000000000001',
      mode: 'ranked',
      status: 'active',
    });
    expect(persisted.startedAt.toISOString()).to.equal('2026-10-21T14:00:00.000Z');
    expect(persisted.expiresAt.getTime() - persisted.startedAt.getTime()).to.equal(300_000);
    expect(persisted.seedHash).to.equal(hash(ranked.body.data.credentials.seed as string));
    expect(persisted.nonceHash).to.equal(hash(ranked.body.data.credentials.nonce as string));
    expect(persisted.seedHash).not.to.equal(ranked.body.data.credentials.seed);
    expect(persisted.nonceHash).not.to.equal(ranked.body.data.credentials.nonce);
  });

  it('rejects unauthenticated, non-CSRF, hidden, overridden, and invalid session requests', async () => {
    const fixture = buildFixture(pool, config, clock);
    await createActivePlayer(fixture, 'reject@m05.test', 'reject_m05');
    const signedIn = await signIn(fixture.app, 'reject@m05.test', config);
    const endpoint = '/api/v1/games/10000000-0000-4000-8000-000000000001/sessions';

    await request(fixture.app).post(endpoint).send({ mode: 'ranked' }).expect(401);
    await request(fixture.app)
      .post(endpoint)
      .set('Cookie', signedIn.cookies)
      .send({ mode: 'ranked' })
      .expect(403);
    const unknown = await request(fixture.app)
      .post('/api/v1/games/59999999-0000-4000-8000-000000000099/sessions')
      .set('Cookie', signedIn.cookies)
      .set('X-CSRF-Token', signedIn.csrf)
      .send({ mode: 'ranked' })
      .expect(404);
    expect(unknown.body.error.code).to.equal('GAME_NOT_FOUND');

    await pool.execute(`UPDATE games SET status = 'retired' WHERE slug = 'endless-runner'`);
    await request(fixture.app)
      .post(endpoint)
      .set('Cookie', signedIn.cookies)
      .set('X-CSRF-Token', signedIn.csrf)
      .send({ mode: 'ranked' })
      .expect(404);
    await pool.execute(`UPDATE games SET status = 'active' WHERE slug = 'endless-runner'`);

    const rejectedBodies = [
      { mode: 'tournament' },
      { mode: 'ranked', versionId: '20000000-0000-4000-8000-000000000001' },
      { mode: 'ranked', status: 'accepted' },
      { mode: 'ranked', startedAt: '2020-01-01T00:00:00Z' },
      { mode: 'ranked', finishedAt: '2020-01-01T00:00:01Z' },
      { mode: 'ranked', score: 999999 },
      { mode: 'ranked', xp: 999999 },
    ];
    for (const body of rejectedBodies) {
      const rejected = await request(fixture.app)
        .post(endpoint)
        .set('Cookie', signedIn.cookies)
        .set('X-CSRF-Token', signedIn.csrf)
        .send(body)
        .expect(400);
      expect(rejected.body.error.code).to.equal('INVALID_REQUEST');
    }
    expect(await m05SessionCount(pool, 'reject@m05.test')).to.equal(0);
  });

  it('enforces duplicate policy atomically while allowing a different mode', async () => {
    const fixture = buildFixture(pool, config, clock);
    await createActivePlayer(fixture, 'duplicate@m05.test', 'duplicate_m05');
    const signedIn = await signIn(fixture.app, 'duplicate@m05.test', config);

    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => createSession(fixture.app, signedIn, 'ranked')),
    );
    expect(concurrent.map((response) => response.status).sort()).to.deep.equal([
      201, 409, 409, 409, 409,
    ]);
    for (const response of concurrent.filter((candidate) => candidate.status === 409)) {
      expect(response.body.error.code).to.equal('GAME_SESSION_ALREADY_ACTIVE');
    }
    await createSession(fixture.app, signedIn, 'practice').expect(201);
    expect(await m05SessionCount(pool, 'duplicate@m05.test')).to.equal(2);
  });

  it('scopes retrieval to the owner and never re-delivers credentials or hashes', async () => {
    const fixture = buildFixture(pool, config, clock);
    await createActivePlayer(fixture, 'owner@m05.test', 'owner_m05');
    await createActivePlayer(fixture, 'other@m05.test', 'other_m05');
    const owner = await signIn(fixture.app, 'owner@m05.test', config);
    const other = await signIn(fixture.app, 'other@m05.test', config);
    const created = await createSession(fixture.app, owner, 'ranked').expect(201);
    const sessionId = created.body.data.session.id as string;

    const own = await request(fixture.app)
      .get(`/api/v1/game-sessions/${sessionId}`)
      .set('Cookie', owner.cookies)
      .expect(200);
    expect(own.headers['cache-control']).to.equal('no-store');
    expect(own.body.data.session.id).to.equal(sessionId);
    expect(own.body.data).not.to.have.property('credentials');
    expect(JSON.stringify(own.body)).not.to.include('seed');
    expect(JSON.stringify(own.body)).not.to.include('nonce');
    expect(JSON.stringify(own.body)).not.to.include('Hash');

    const isolated = await request(fixture.app)
      .get(`/api/v1/game-sessions/${sessionId}`)
      .set('Cookie', other.cookies)
      .expect(404);
    expect(isolated.body.error.code).to.equal('GAME_SESSION_NOT_FOUND');
    await request(fixture.app).get(`/api/v1/game-sessions/${sessionId}`).expect(401);
  });

  it('returns owned expired sessions and permits a fresh session after expiry', async () => {
    const fixture = buildFixture(pool, config, clock);
    await createActivePlayer(fixture, 'expiry@m05.test', 'expiry_m05');
    const signedIn = await signIn(fixture.app, 'expiry@m05.test', config);
    const created = await createSession(fixture.app, signedIn, 'ranked').expect(201);
    const oldId = created.body.data.session.id as string;

    clock.now = new Date('2026-10-21T14:05:00.000Z');
    const expired = await request(fixture.app)
      .get(`/api/v1/game-sessions/${oldId}`)
      .set('Cookie', signedIn.cookies)
      .expect(200);
    expect(expired.body.data.session.status).to.equal('expired');

    const replacement = await createSession(fixture.app, signedIn, 'ranked').expect(201);
    expect(replacement.body.data.session.id).not.to.equal(oldId);
    expect((await readPersistedSession(pool, oldId)).status).to.equal('expired');
  });

  it('enforces valid internal lifecycle transitions and exposes no score route', async () => {
    const fixture = buildFixture(pool, config, clock);
    const player = await createActivePlayer(fixture, 'lifecycle@m05.test', 'lifecycle_m05');
    const signedIn = await signIn(fixture.app, 'lifecycle@m05.test', config);
    const created = await createSession(fixture.app, signedIn, 'ranked').expect(201);
    const sessionId = created.body.data.session.id as string;

    clock.now = new Date('2026-10-21T14:04:59.000Z');
    const submitted = await fixture.gameService.transitionSession({
      userId: player.id,
      sessionId,
      targetStatus: 'submitted',
    });
    expect(submitted.status).to.equal('submitted');
    expect(submitted.finishedAt?.toISOString()).to.equal('2026-10-21T14:04:59.000Z');
    const accepted = await fixture.gameService.transitionSession({
      userId: player.id,
      sessionId,
      targetStatus: 'accepted',
    });
    expect(accepted.status).to.equal('accepted');
    await expectAppError(
      fixture.gameService.transitionSession({
        userId: player.id,
        sessionId,
        targetStatus: 'abandoned',
      }),
      'GAME_SESSION_STATE_CONFLICT',
    );

    await request(fixture.app)
      .post(`/api/v1/game-sessions/${sessionId}/scores`)
      .set('Cookie', signedIn.cookies)
      .set('X-CSRF-Token', signedIn.csrf)
      .send({ score: 100 })
      .expect(404);
  });

  it('applies the dedicated game-session creation rate limit', async () => {
    const limitedConfig: AppConfig = {
      ...config,
      games: { sessionRateLimit: { windowMs: 60_000, max: 1 } },
    };
    const fixture = buildFixture(pool, limitedConfig, clock);
    await createActivePlayer(fixture, 'limited@m05.test', 'limited_m05');
    const signedIn = await signIn(fixture.app, 'limited@m05.test', limitedConfig);
    await createSession(fixture.app, signedIn, 'ranked').expect(201);
    const limited = await createSession(fixture.app, signedIn, 'practice').expect(429);
    expect(limited.body.error.code).to.equal('GAME_SESSION_RATE_LIMIT_EXCEEDED');
  });

  it('keeps delivered and persisted secret material out of structured logs', async () => {
    let logOutput = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        logOutput += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
        callback();
      },
    });
    const logger = createLogger({ ...config, logLevel: 'info' }, destination);
    const fixture = buildFixture(pool, config, clock, logger);
    await createActivePlayer(fixture, 'logs@m05.test', 'logs_m05');
    const signedIn = await signIn(fixture.app, 'logs@m05.test', config);
    const created = await createSession(fixture.app, signedIn, 'ranked').expect(201);
    const persisted = await readPersistedSession(pool, created.body.data.session.id as string);
    const seed = created.body.data.credentials.seed as string;
    const nonce = created.body.data.credentials.nonce as string;

    expect(logOutput).not.to.include(seed);
    expect(logOutput).not.to.include(nonce);
    expect(logOutput).not.to.include(persisted.seedHash);
    expect(logOutput).not.to.include(persisted.nonceHash);
  });
});

function buildFixture(
  pool: Pool,
  config: AppConfig,
  clock: { now: Date },
  logger: Logger = pino({ level: 'silent' }),
) {
  const delivery = new CapturingVerificationDelivery();
  const authService = new AuthService(
    new MySqlAuthRepository(pool),
    new Argon2PasswordHasher(),
    delivery,
    config,
    logger,
    () => clock.now,
  );
  const gameService = new GameService(new MySqlGameRepository(pool), logger, () => clock.now);
  const healthService = new HealthService(() => Promise.resolve(), logger);
  const app = createApp({ config, logger, healthService, authService, gameService });
  return { app, delivery, gameService };
}

async function createActivePlayer(
  fixture: ReturnType<typeof buildFixture>,
  email: string,
  username: string,
): Promise<{ id: string }> {
  const registered = await request(fixture.app)
    .post('/api/v1/auth/register')
    .send({ email, username, password: 'StrongPassword123!' })
    .expect(201);
  const token = fixture.delivery.deliveries.at(-1)?.token;
  if (token === undefined) throw new Error('Verification token was not captured');
  await request(fixture.app).post('/api/v1/auth/verify-email').send({ token }).expect(204);
  return { id: registered.body.data.user.id as string };
}

async function signIn(
  app: Express,
  email: string,
  config: AppConfig,
): Promise<{ cookies: string; csrf: string }> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'StrongPassword123!' })
    .expect(200);
  return {
    cookies: setCookies(response)
      .map((cookie) => cookie.split(';', 1)[0])
      .join('; '),
    csrf: cookieValue(response, authCookieNames(config).csrf),
  };
}

function createSession(
  app: Express,
  auth: { cookies: string; csrf: string },
  mode: 'practice' | 'ranked',
) {
  return request(app)
    .post('/api/v1/games/10000000-0000-4000-8000-000000000001/sessions')
    .set('Cookie', auth.cookies)
    .set('X-CSRF-Token', auth.csrf)
    .send({ mode });
}

function setCookies(response: SupertestResponse): string[] {
  const header = response.headers['set-cookie'] as unknown;
  if (!Array.isArray(header) || !header.every((value) => typeof value === 'string')) {
    throw new Error('Expected Set-Cookie response headers');
  }
  return header;
}

function cookieValue(response: SupertestResponse, name: string): string {
  const cookie = setCookies(response).find((candidate) => candidate.startsWith(`${name}=`));
  const value = cookie?.split(';', 1)[0]?.slice(name.length + 1);
  if (value === undefined) throw new Error(`Cookie ${name} was not found`);
  return decodeURIComponent(value);
}

async function readPersistedSession(pool: Pool, publicId: string): Promise<SessionPersistenceRow> {
  const [rows] = await pool.execute<SessionPersistenceRow[]>(
    `SELECT s.public_id AS publicId, v.public_id AS versionPublicId, s.mode, s.status,
            s.seed_hash AS seedHash, s.nonce_hash AS nonceHash,
            s.started_at AS startedAt, s.expires_at AS expiresAt
     FROM game_sessions s
     INNER JOIN game_versions v ON v.id = s.game_version_id
     WHERE s.public_id = ?`,
    [publicId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('Session persistence row was not found');
  return row;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function m05SessionCount(pool: Pool, email: string): Promise<number> {
  const [rows] = await pool.execute<CountRow[]>(
    `SELECT COUNT(*) AS count FROM game_sessions s
     INNER JOIN users u ON u.id = s.user_id WHERE u.email = ?`,
    [email],
  );
  return Number(rows[0]?.count);
}

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.fail('Expected operation to reject');
  } catch (error: unknown) {
    expect(error).to.be.instanceOf(AppError);
    expect((error as AppError).code).to.equal(code);
  }
}

async function insertCatalogFixture(
  pool: Pool,
  gamePublicId: string,
  slug: string,
  gameStatus: 'active' | 'draft' | 'retired',
  versionStatus: 'published' | 'draft' | 'retired',
): Promise<void> {
  const [game] = await pool.execute<ResultSetHeader>(
    `INSERT INTO games (public_id, slug, name, description, status)
     VALUES (?, ?, ?, ?, ?)`,
    [gamePublicId, slug, `Hidden ${slug}`, 'M05 visibility fixture', gameStatus],
  );
  const versionPublicId = gamePublicId.replace(/^51/, '52');
  const [version] = await pool.execute<ResultSetHeader>(
    `INSERT INTO game_versions
      (public_id, game_id, version_number, rules_version, scoring_rules,
       max_session_seconds, status, published_at)
     VALUES (?, ?, '1.0.0', 'hidden-rules', ?, 300, ?, ?)`,
    [
      versionPublicId,
      game.insertId,
      JSON.stringify({ pointsPerCoin: 10 }),
      versionStatus,
      versionStatus === 'published' ? new Date('2026-10-21T00:00:00.000Z') : null,
    ],
  );
  await pool.execute('UPDATE games SET active_version_id = ? WHERE id = ?', [
    version.insertId,
    game.insertId,
  ]);
}

async function cleanM05Fixtures(pool: Pool): Promise<void> {
  await pool.execute(
    `DELETE s FROM game_sessions s INNER JOIN users u ON u.id = s.user_id
     WHERE u.email LIKE '%@m05.test'`,
  );
  await pool.execute(
    `DELETE s FROM auth_sessions s INNER JOIN users u ON u.id = s.user_id
     WHERE u.email LIKE '%@m05.test'`,
  );
  await pool.execute(
    `DELETE t FROM auth_tokens t INNER JOIN users u ON u.id = t.user_id
     WHERE u.email LIKE '%@m05.test'`,
  );
  await pool.execute(`DELETE FROM users WHERE email LIKE '%@m05.test'`);
  await pool.execute(`UPDATE games SET active_version_id = NULL WHERE slug LIKE 'm05-%'`);
  await pool.execute(
    `DELETE v FROM game_versions v INNER JOIN games g ON g.id = v.game_id
     WHERE g.slug LIKE 'm05-%'`,
  );
  await pool.execute(`DELETE FROM games WHERE slug LIKE 'm05-%'`);
}
