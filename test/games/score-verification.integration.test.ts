import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';

import { expect } from 'chai';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
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
import { ScoreSubmissionService } from '../../src/modules/games/application/score-submission.service.js';
import type { ScorePersistenceStage } from '../../src/modules/games/application/score-submission.ports.js';
import type { ScoreEvidence } from '../../src/modules/games/application/score-verification.ports.js';
import { DeterministicRunnerVerifier } from '../../src/modules/games/infrastructure/deterministic-runner-verifier.js';
import { MySqlGameRepository } from '../../src/modules/games/infrastructure/mysql-game.repository.js';
import { MySqlScoreSubmissionRepository } from '../../src/modules/games/infrastructure/mysql-score-submission.repository.js';
import { HealthService } from '../../src/modules/health/application/health.service.js';
import { ProgressionPolicyService } from '../../src/modules/players/application/progression-policy.service.js';
import { createLogger } from '../../src/shared/logging/logger.js';
import { createIntegrationDatabaseConfig } from '../helpers/database.js';

interface EffectsRow extends RowDataPacket {
  readonly sessionStatus: string;
  readonly submissions: string;
  readonly events: string;
  readonly scores: string;
  readonly xpEntries: string;
  readonly totalXp: string | null;
}

class CapturingVerificationDelivery implements VerificationDelivery {
  public readonly deliveries: { recipient: string; token: string; expiresAt: Date }[] = [];

  public deliver(input: { recipient: string; token: string; expiresAt: Date }): Promise<void> {
    this.deliveries.push(input);
    return Promise.resolve();
  }
}

describe('M06 deterministic score verification on the isolated database', function () {
  this.timeout(90_000);

  const config = createIntegrationDatabaseConfig();
  const clock = { now: new Date('2026-10-23T10:00:00.000Z') };
  let pool: Pool;

  before(async () => {
    pool = createMySqlPool(config);
    const runner = new MigrationRunner(pool, await loadMigrations(), {
      nodeEnv: config.nodeEnv,
      databaseName: config.database.name,
    });
    await runner.up();
  });

  beforeEach(async () => {
    clock.now = new Date('2026-10-23T10:00:00.000Z');
    await cleanM06Fixtures(pool);
    await seedCatalog(pool, { nodeEnv: config.nodeEnv, databaseName: config.database.name });
  });

  after(async () => {
    await cleanM06Fixtures(pool);
    await seedCatalog(pool, { nodeEnv: config.nodeEnv, databaseName: config.database.name });
    await pool.end();
  });

  it('recomputes a valid run, fixes server finish time, stores one score, and awards exact XP once', async () => {
    const fixture = buildFixture(pool, config, clock);
    await createActivePlayer(fixture, 'valid@m06.test', 'valid_m06');
    const auth = await signIn(fixture.app, 'valid@m06.test', config);
    const issued = await createSession(fixture.app, auth, 'ranked').expect(201);
    const evidence = buildValidEvidence(issued, clock);

    const submitted = await submitScore(
      fixture.app,
      auth,
      issued.body.data.session.id as string,
      'm06-valid-1',
      evidence,
    ).expect(201);
    const submission = submitted.body.data.submission;
    expect(submission.status).to.equal('accepted');
    expect(submission.rejectionCode).to.equal(null);
    expect(submission.result).to.deep.include({
      metres: evidence.claimed.metres,
      coins: evidence.claimed.coins,
      score: evidence.claimed.score,
      xpAwarded: Math.floor(evidence.claimed.score / 10),
    });
    expect(submission.result.finishedAt).to.equal(
      new Date(
        new Date(issued.body.data.session.startedAt as string).getTime() +
          evidence.simulationTicks * 50,
      ).toISOString(),
    );
    expect(JSON.stringify(submitted.body)).not.to.include(evidence.seed);
    expect(JSON.stringify(submitted.body)).not.to.include(evidence.nonce);

    const retrieved = await request(fixture.app)
      .get(`/api/v1/score-submissions/${submission.id as string}`)
      .set('Cookie', auth.cookies)
      .expect(200);
    expect(retrieved.body.data.submission).to.deep.equal(submission);
    expect(retrieved.body.data.submission).not.to.have.property('requestDigest');

    const effects = await readEffects(pool, issued.body.data.session.id as string);
    expect(effects).to.deep.equal({
      sessionStatus: 'accepted',
      submissions: 1,
      events: evidence.events.length,
      scores: 1,
      xpEntries: 1,
      totalXp: Math.floor(evidence.claimed.score / 10),
    });
  });

  it('accepts a score below the active policy ratio as a zero-XP no-op', async () => {
    await pool.execute(
      `UPDATE progression_policy_versions
       SET score_points_per_xp = 10000
       WHERE version = 'progression-v1'`,
    );
    const fixture = buildFixture(pool, config, clock);
    await createActivePlayer(fixture, 'zero@m06.test', 'zero_m06');
    const auth = await signIn(fixture.app, 'zero@m06.test', config);
    const issued = await createSession(fixture.app, auth, 'ranked').expect(201);
    const evidence = buildValidEvidence(issued, clock);
    expect(evidence.claimed.score).to.be.lessThan(10_000);

    const response = await submitScore(
      fixture.app,
      auth,
      issued.body.data.session.id as string,
      'm06-zero-xp',
      evidence,
    ).expect(201);
    expect(response.body.data.submission.result.xpAwarded).to.equal(0);
    expect(await readEffects(pool, issued.body.data.session.id as string)).to.deep.equal({
      sessionStatus: 'accepted',
      submissions: 1,
      events: 0,
      scores: 1,
      xpEntries: 0,
      totalXp: null,
    });
  });

  it('persists terminal safe rejections for fabricated claims and credential tampering', async () => {
    const fixture = buildFixture(pool, config, clock);
    await createActivePlayer(fixture, 'reject@m06.test', 'reject_m06');
    const auth = await signIn(fixture.app, 'reject@m06.test', config);

    const claimedSession = await createSession(fixture.app, auth, 'ranked').expect(201);
    const fabricated = buildValidEvidence(claimedSession, clock);
    fabricated.claimed.score += 1;
    const claimRejected = await submitScore(
      fixture.app,
      auth,
      claimedSession.body.data.session.id as string,
      'm06-claim-reject',
      fabricated,
    ).expect(422);
    expect(claimRejected.body.data.submission).to.include({
      status: 'rejected',
      rejectionCode: 'CLAIM_MISMATCH',
    });

    await createActivePlayer(fixture, 'seed@m06.test', 'seed_m06');
    const seedAuth = await signIn(fixture.app, 'seed@m06.test', config);
    const seedSession = await createSession(fixture.app, seedAuth, 'ranked').expect(201);
    const badSeed = buildValidEvidence(seedSession, clock);
    badSeed.seed = `${badSeed.seed.slice(0, -1)}${badSeed.seed.endsWith('A') ? 'B' : 'A'}`;
    const seedRejected = await submitScore(
      fixture.app,
      seedAuth,
      seedSession.body.data.session.id as string,
      'm06-seed-reject',
      badSeed,
    ).expect(422);
    expect(seedRejected.body.data.submission.rejectionCode).to.equal('CREDENTIAL_MISMATCH');

    await createActivePlayer(fixture, 'nonce@m06.test', 'nonce_m06');
    const nonceAuth = await signIn(fixture.app, 'nonce@m06.test', config);
    const nonceSession = await createSession(fixture.app, nonceAuth, 'ranked').expect(201);
    const badNonce = buildValidEvidence(nonceSession, clock);
    badNonce.nonce = `${badNonce.nonce.slice(0, -1)}${badNonce.nonce.endsWith('A') ? 'B' : 'A'}`;
    const nonceRejected = await submitScore(
      fixture.app,
      nonceAuth,
      nonceSession.body.data.session.id as string,
      'm06-nonce-reject',
      badNonce,
    ).expect(422);
    expect(nonceRejected.body.data.submission.rejectionCode).to.equal('CREDENTIAL_MISMATCH');

    for (const sessionId of [
      claimedSession.body.data.session.id as string,
      seedSession.body.data.session.id as string,
      nonceSession.body.data.session.id as string,
    ]) {
      const effects = await readEffects(pool, sessionId);
      expect(effects.sessionStatus).to.equal('rejected');
      expect(effects.submissions).to.equal(1);
      expect(effects.scores).to.equal(0);
      expect(effects.xpEntries).to.equal(0);
    }
  });

  it('rejects malformed, reordered, duplicate, invalid, impossible, and version-mismatched evidence', async () => {
    const validationConfig: AppConfig = {
      ...config,
      games: {
        ...config.games,
        scoreSubmissionRateLimit: { windowMs: 60_000, max: 20 },
      },
    };
    const fixture = buildFixture(pool, validationConfig, clock);
    await createActivePlayer(fixture, 'shape@m06.test', 'shape_m06');
    const auth = await signIn(fixture.app, 'shape@m06.test', validationConfig);
    const issued = await createSession(fixture.app, auth, 'ranked').expect(201);
    const sessionId = issued.body.data.session.id as string;
    const base = buildValidEvidence(issued, clock);

    const reordered = structuredClone(base);
    reordered.events = [
      { sequence: 2, tick: 2, type: 'moveLeft', payload: {} },
      { sequence: 1, tick: 1, type: 'moveRight', payload: {} },
    ];
    await submitScore(fixture.app, auth, sessionId, 'm06-reordered', reordered).expect(400);

    const duplicate = structuredClone(base);
    duplicate.events = [
      { sequence: 1, tick: 1, type: 'moveLeft', payload: {} },
      { sequence: 2, tick: 1, type: 'moveRight', payload: {} },
    ];
    await submitScore(fixture.app, auth, sessionId, 'm06-duplicate-event', duplicate).expect(400);

    const invalidType = structuredClone(base) as unknown as Record<string, unknown>;
    (invalidType.events as { type: string }[]) = [
      { sequence: 1, tick: 1, type: 'teleport', payload: {} } as unknown as { type: string },
    ];
    await submitScore(fixture.app, auth, sessionId, 'm06-invalid-type', invalidType).expect(400);

    const impossible = structuredClone(base);
    impossible.events = [
      { sequence: 1, tick: 1, type: 'moveLeft', payload: {} },
      { sequence: 2, tick: 2, type: 'moveLeft', payload: {} },
    ];
    const replayRejected = await submitScore(
      fixture.app,
      auth,
      sessionId,
      'm06-impossible',
      impossible,
    ).expect(422);
    expect(replayRejected.body.data.submission.rejectionCode).to.equal('REPLAY_INVALID');

    await createActivePlayer(fixture, 'timing@m06.test', 'timing_m06');
    const timingAuth = await signIn(fixture.app, 'timing@m06.test', validationConfig);
    const timingSession = await createSession(fixture.app, timingAuth, 'ranked').expect(201);
    const impossibleTiming = buildValidEvidence(timingSession, clock, false);
    const timingRejected = await submitScore(
      fixture.app,
      timingAuth,
      timingSession.body.data.session.id as string,
      'm06-timing',
      impossibleTiming,
    ).expect(422);
    expect(timingRejected.body.data.submission.rejectionCode).to.equal('REPLAY_INVALID');

    await createActivePlayer(fixture, 'version@m06.test', 'version_m06');
    const versionAuth = await signIn(fixture.app, 'version@m06.test', validationConfig);
    const versionSession = await createSession(fixture.app, versionAuth, 'ranked').expect(201);
    const wrongVersion = buildValidEvidence(versionSession, clock);
    wrongVersion.rulesVersion = 'runner-score-v2';
    const versionRejected = await submitScore(
      fixture.app,
      versionAuth,
      versionSession.body.data.session.id as string,
      'm06-version',
      wrongVersion,
    ).expect(422);
    expect(versionRejected.body.data.submission.rejectionCode).to.equal('VERSION_MISMATCH');
  });

  it('enforces authentication, CSRF, idempotency, ownership, ranked mode, expiry, and terminal state', async () => {
    const fixture = buildFixture(pool, config, clock);
    await createActivePlayer(fixture, 'owner@m06.test', 'owner_m06');
    await createActivePlayer(fixture, 'other@m06.test', 'other_m06');
    const owner = await signIn(fixture.app, 'owner@m06.test', config);
    const other = await signIn(fixture.app, 'other@m06.test', config);
    const issued = await createSession(fixture.app, owner, 'ranked').expect(201);
    const sessionId = issued.body.data.session.id as string;
    const evidence = buildValidEvidence(issued, clock);

    await request(fixture.app)
      .post(`/api/v1/game-sessions/${sessionId}/scores`)
      .send(evidence)
      .expect(401);
    await request(fixture.app)
      .post(`/api/v1/game-sessions/${sessionId}/scores`)
      .set('Cookie', owner.cookies)
      .set('Idempotency-Key', 'm06-no-csrf')
      .send(evidence)
      .expect(403);
    await request(fixture.app)
      .post(`/api/v1/game-sessions/${sessionId}/scores`)
      .set('Cookie', owner.cookies)
      .set('X-CSRF-Token', owner.csrf)
      .send(evidence)
      .expect(400);
    const unowned = await submitScore(
      fixture.app,
      other,
      sessionId,
      'm06-unowned',
      evidence,
    ).expect(404);
    expect(unowned.body.error.code).to.equal('GAME_SESSION_NOT_FOUND');

    const practice = await createSession(fixture.app, owner, 'practice').expect(201);
    const practiceRejected = await submitScore(
      fixture.app,
      owner,
      practice.body.data.session.id as string,
      'm06-practice',
      buildValidEvidence(practice, clock),
    ).expect(409);
    expect(practiceRejected.body.error.code).to.equal('SCORE_RANKED_SESSION_REQUIRED');

    clock.now = new Date('2026-10-23T10:05:00.000Z');
    const expired = await submitScore(
      fixture.app,
      owner,
      sessionId,
      'm06-expired',
      evidence,
    ).expect(409);
    expect(expired.body.error.code).to.equal('GAME_SESSION_EXPIRED');
    expect((await readEffects(pool, sessionId)).sessionStatus).to.equal('expired');
  });

  it('returns identical idempotent replays and rejects payload drift or a second submission', async () => {
    const fixture = buildFixture(pool, config, clock);
    await createActivePlayer(fixture, 'idem@m06.test', 'idem_m06');
    const auth = await signIn(fixture.app, 'idem@m06.test', config);
    const issued = await createSession(fixture.app, auth, 'ranked').expect(201);
    const sessionId = issued.body.data.session.id as string;
    const evidence = buildValidEvidence(issued, clock);

    const first = await submitScore(
      fixture.app,
      auth,
      sessionId,
      'm06-idempotent',
      evidence,
    ).expect(201);
    const replay = await submitScore(
      fixture.app,
      auth,
      sessionId,
      'm06-idempotent',
      evidence,
    ).expect(200);
    expect(replay.body.data.replayed).to.equal(true);
    expect(replay.body.data.submission).to.deep.equal(first.body.data.submission);

    const drift = structuredClone(evidence);
    drift.claimed.score += 1;
    const conflict = await submitScore(
      fixture.app,
      auth,
      sessionId,
      'm06-idempotent',
      drift,
    ).expect(409);
    expect(conflict.body.error.code).to.equal('SCORE_IDEMPOTENCY_CONFLICT');

    const second = await submitScore(
      fixture.app,
      auth,
      sessionId,
      'm06-second-key',
      evidence,
    ).expect(409);
    expect(second.body.error.code).to.equal('GAME_SESSION_STATE_CONFLICT');
    const effects = await readEffects(pool, sessionId);
    expect(effects.submissions).to.equal(1);
    expect(effects.scores).to.equal(1);
    expect(effects.xpEntries).to.equal(1);
  });

  it('serializes concurrent identical and conflicting submissions to one terminal effect', async () => {
    const concurrencyConfig: AppConfig = {
      ...config,
      games: {
        ...config.games,
        scoreSubmissionRateLimit: { windowMs: 60_000, max: 20 },
      },
    };
    const fixture = buildFixture(pool, concurrencyConfig, clock);
    await createActivePlayer(fixture, 'concurrent@m06.test', 'concurrent_m06');
    const auth = await signIn(fixture.app, 'concurrent@m06.test', concurrencyConfig);
    const issued = await createSession(fixture.app, auth, 'ranked').expect(201);
    const sessionId = issued.body.data.session.id as string;
    const evidence = buildValidEvidence(issued, clock);

    const identical = await Promise.all(
      Array.from({ length: 5 }, () =>
        submitScore(fixture.app, auth, sessionId, 'm06-concurrent-same', evidence),
      ),
    );
    expect(identical.filter((response) => response.status === 201)).to.have.length(1);
    expect(identical.filter((response) => response.status === 200)).to.have.length(4);
    expect(
      new Set(identical.map((response) => String(response.body.data.submission.id))).size,
    ).to.equal(1);

    const effects = await readEffects(pool, sessionId);
    expect(effects.submissions).to.equal(1);
    expect(effects.scores).to.equal(1);
    expect(effects.xpEntries).to.equal(1);

    await createActivePlayer(fixture, 'race@m06.test', 'race_m06');
    const raceAuth = await signIn(fixture.app, 'race@m06.test', concurrencyConfig);
    const raceSession = await createSession(fixture.app, raceAuth, 'ranked').expect(201);
    const raceSessionId = raceSession.body.data.session.id as string;
    const good = buildValidEvidence(raceSession, clock);
    const changed = structuredClone(good);
    changed.claimed.score += 1;
    const raced = await Promise.all([
      submitScore(fixture.app, raceAuth, raceSessionId, 'm06-race-key', good),
      submitScore(fixture.app, raceAuth, raceSessionId, 'm06-race-key', changed),
    ]);
    expect(raced.filter((response) => response.status === 409)).to.have.length(1);
    expect(
      raced.filter((response) => response.status === 201 || response.status === 422),
    ).to.have.length(1);
    const raceEffects = await readEffects(pool, raceSessionId);
    expect(raceEffects.submissions).to.equal(1);
    expect(raceEffects.scores).to.be.at.most(1);
    expect(raceEffects.xpEntries).to.be.at.most(1);
  });

  it('rolls back every authoritative effect after failures at all five persistence stages', async () => {
    const stages: readonly ScorePersistenceStage[] = [
      'submission',
      'events',
      'verified-score',
      'xp-ledger',
      'profile-update',
    ];
    for (const [index, stage] of stages.entries()) {
      const fixture = buildFixture(pool, config, clock, undefined, (candidate) => {
        if (candidate === stage) throw new Error(`forced-${stage}`);
      });
      const email = `rollback-${index}@m06.test`;
      await createActivePlayer(fixture, email, `rollback_${index}_m06`);
      const auth = await signIn(fixture.app, email, config);
      const issued = await createSession(fixture.app, auth, 'ranked').expect(201);
      const sessionId = issued.body.data.session.id as string;
      await submitScore(
        fixture.app,
        auth,
        sessionId,
        `m06-rollback-${index}`,
        buildValidEvidence(issued, clock),
      ).expect(500);
      expect(await readEffects(pool, sessionId)).to.deep.equal({
        sessionStatus: 'active',
        submissions: 0,
        events: 0,
        scores: 0,
        xpEntries: 0,
        totalXp: null,
      });
    }
  });

  it('bounds score payloads and applies a dedicated submission rate limit', async () => {
    const limitedConfig: AppConfig = {
      ...config,
      games: {
        ...config.games,
        scoreSubmissionRateLimit: { windowMs: 60_000, max: 1 },
        scoreEvidenceMaxBytes: 1_024,
      },
    };
    const fixture = buildFixture(pool, limitedConfig, clock);
    await createActivePlayer(fixture, 'bounded@m06.test', 'bounded_m06');
    const auth = await signIn(fixture.app, 'bounded@m06.test', limitedConfig);
    const issued = await createSession(fixture.app, auth, 'ranked').expect(201);
    const evidence = buildValidEvidence(issued, clock);
    const oversized = structuredClone(evidence) as ScoreEvidence & { padding?: string };
    oversized.padding = 'x'.repeat(2_000);
    const tooLarge = await submitScore(
      fixture.app,
      auth,
      issued.body.data.session.id as string,
      'm06-too-large',
      oversized,
    ).expect(413);
    expect(tooLarge.body.error.code).to.equal('SCORE_EVIDENCE_TOO_LARGE');

    const limited = await submitScore(
      fixture.app,
      auth,
      issued.body.data.session.id as string,
      'm06-limited',
      evidence,
    ).expect(429);
    expect(limited.body.error.code).to.equal('SCORE_SUBMISSION_RATE_LIMIT_EXCEEDED');
  });

  it('does not leak credentials, hashes, or private replay evidence in responses or logs', async () => {
    let logOutput = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        logOutput += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
        callback();
      },
    });
    const logger = createLogger({ ...config, logLevel: 'info' }, destination);
    const fixture = buildFixture(pool, config, clock, logger);
    await createActivePlayer(fixture, 'leak@m06.test', 'leak_m06');
    const auth = await signIn(fixture.app, 'leak@m06.test', config);
    const issued = await createSession(fixture.app, auth, 'ranked').expect(201);
    const evidence = buildValidEvidence(issued, clock);
    evidence.events = [{ sequence: 1, tick: 1, type: 'jump', payload: {} }];
    const submitted = await submitScore(
      fixture.app,
      auth,
      issued.body.data.session.id as string,
      'm06-leak',
      evidence,
    );
    expect([201, 422]).to.include(submitted.status);
    const serialized = JSON.stringify(submitted.body);
    for (const secret of [
      evidence.seed,
      evidence.nonce,
      createHash('sha256').update(evidence.seed).digest('hex'),
      createHash('sha256').update(evidence.nonce).digest('hex'),
    ]) {
      expect(serialized).not.to.include(secret);
      expect(logOutput).not.to.include(secret);
    }
    expect(serialized).not.to.include('events');
    expect(serialized).not.to.include('requestDigest');

    const [rows] = await pool.execute<(RowDataPacket & { leaked: number })[]>(
      `SELECT COUNT(*) AS leaked FROM score_submissions ss
       INNER JOIN game_sessions s ON s.id = ss.game_session_id
       WHERE s.public_id = ? AND (
         ss.replay_digest IN (?, ?, ?, ?) OR
         CAST(ss.claimed_score AS CHAR) IN (?, ?)
       )`,
      [
        issued.body.data.session.id,
        evidence.seed,
        evidence.nonce,
        createHash('sha256').update(evidence.seed).digest('hex'),
        createHash('sha256').update(evidence.nonce).digest('hex'),
        evidence.seed,
        evidence.nonce,
      ],
    );
    expect(Number(rows[0]?.leaked)).to.equal(0);
  });
});

function buildFixture(
  pool: Pool,
  config: AppConfig,
  clock: { now: Date },
  logger: Logger = pino({ level: 'silent' }),
  failureInjector?: (stage: ScorePersistenceStage) => void,
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
  const progression = new ProgressionPolicyService();
  const gameService = new GameService(new MySqlGameRepository(pool), logger, () => clock.now);
  const scoreSubmissionService = new ScoreSubmissionService(
    new MySqlScoreSubmissionRepository(pool, failureInjector),
    new DeterministicRunnerVerifier(),
    progression,
    logger,
    () => clock.now,
  );
  const healthService = new HealthService(() => Promise.resolve(), logger);
  const app = createApp({
    config,
    logger,
    healthService,
    authService,
    gameService,
    scoreSubmissionService,
  });
  return { app, delivery };
}

async function createActivePlayer(
  fixture: ReturnType<typeof buildFixture>,
  email: string,
  username: string,
): Promise<void> {
  await request(fixture.app)
    .post('/api/v1/auth/register')
    .send({ email, username, password: 'StrongPassword123!' })
    .expect(201);
  const token = fixture.delivery.deliveries.at(-1)?.token;
  if (token === undefined) throw new Error('Verification token was not captured');
  await request(fixture.app).post('/api/v1/auth/verify-email').send({ token }).expect(204);
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

function submitScore(
  app: Express,
  auth: { cookies: string; csrf: string },
  sessionId: string,
  idempotencyKey: string,
  evidence: object,
) {
  return request(app)
    .post(`/api/v1/game-sessions/${sessionId}/scores`)
    .set('Cookie', auth.cookies)
    .set('X-CSRF-Token', auth.csrf)
    .set('Idempotency-Key', idempotencyKey)
    .send(evidence);
}

function buildValidEvidence(
  issued: SupertestResponse,
  clock: { now: Date },
  advanceClock = true,
): MutableScoreEvidence {
  const seed = issued.body.data.credentials.seed as string;
  const nonce = issued.body.data.credentials.nonce as string;
  const maxSeconds = issued.body.data.session.version.maxSessionSeconds as number;
  const replay = simulateNoInput(seed, maxSeconds);
  if (advanceClock) {
    const startedAt = new Date(issued.body.data.session.startedAt as string);
    clock.now = new Date(startedAt.getTime() + replay.tick * 50);
  }
  return {
    contractVersion: 'runner-evidence-v1',
    gameVersionId: issued.body.data.session.version.id as string,
    rulesVersion: issued.body.data.session.version.rulesVersion as string,
    seed,
    nonce,
    simulationTicks: replay.tick,
    terminal: { type: replay.terminal, tick: replay.tick },
    events: [],
    claimed: { metres: replay.metres, coins: replay.coins, score: replay.score },
  };
}

type MutableScoreEvidence = {
  -readonly [Key in keyof ScoreEvidence]: ScoreEvidence[Key] extends readonly (infer Item)[]
    ? Item[]
    : ScoreEvidence[Key] extends Readonly<Record<string, number>>
      ? { -readonly [Nested in keyof ScoreEvidence[Key]]: ScoreEvidence[Key][Nested] }
      : ScoreEvidence[Key];
};

function simulateNoInput(
  seed: string,
  maxSeconds: number,
): {
  readonly tick: number;
  readonly terminal: 'collision' | 'timeout';
  readonly metres: number;
  readonly coins: number;
  readonly score: number;
} {
  const digest = createHash('sha256').update(seed).digest();
  let state = digest.readUInt32BE(0) || 0x9e3779b9;
  let coins = 0;
  const maxTicks = maxSeconds * 20;
  for (let tick = 1; tick <= maxTicks; tick += 1) {
    state = nextRandom(state);
    if (tick > 80) {
      const roll = state & 0xff;
      const lane = (state >>> 8) % 3;
      if (roll < 5 && lane === 1) coins += 1;
      if (roll >= 5 && roll < 9 && lane === 1) {
        const metres = Math.floor(tick / 4);
        return { tick, terminal: 'collision', metres, coins, score: metres + coins * 10 };
      }
    }
  }
  const metres = Math.floor(maxTicks / 4);
  return {
    tick: maxTicks,
    terminal: 'timeout',
    metres,
    coins,
    score: metres + coins * 10,
  };
}

function nextRandom(value: number): number {
  let next = value >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next >>> 0;
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

async function readEffects(
  pool: Pool,
  sessionId: string,
): Promise<{
  sessionStatus: string;
  submissions: number;
  events: number;
  scores: number;
  xpEntries: number;
  totalXp: number | null;
}> {
  const [rows] = await pool.execute<EffectsRow[]>(
    `SELECT s.status AS sessionStatus,
            CAST((SELECT COUNT(*) FROM score_submissions ss WHERE ss.game_session_id = s.id) AS CHAR) AS submissions,
            CAST((SELECT COUNT(*) FROM game_session_events e WHERE e.game_session_id = s.id) AS CHAR) AS events,
            CAST((SELECT COUNT(*) FROM verified_scores vs WHERE vs.game_session_id = s.id) AS CHAR) AS scores,
            CAST((SELECT COUNT(*) FROM xp_ledger x WHERE x.idempotency_key = CONCAT('gameplay:', s.public_id)) AS CHAR) AS xpEntries,
            CAST(p.total_xp AS CHAR) AS totalXp
     FROM game_sessions s
     LEFT JOIN player_profiles p ON p.user_id = s.user_id
     WHERE s.public_id = ?`,
    [sessionId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('Session effects were not found');
  return {
    sessionStatus: row.sessionStatus,
    submissions: Number(row.submissions),
    events: Number(row.events),
    scores: Number(row.scores),
    xpEntries: Number(row.xpEntries),
    totalXp: row.totalXp === null ? null : Number(row.totalXp),
  };
}

async function cleanM06Fixtures(pool: Pool): Promise<void> {
  await pool.query('DROP TRIGGER IF EXISTS trg_xp_ledger_prevent_update');
  await pool.query('DROP TRIGGER IF EXISTS trg_xp_ledger_prevent_delete');
  try {
    await pool.execute(
      `DELETE vs FROM verified_scores vs
       INNER JOIN users u ON u.id = vs.user_id WHERE u.email LIKE '%@m06.test'`,
    );
    await pool.execute(
      `DELETE ss FROM score_submissions ss
       INNER JOIN game_sessions s ON s.id = ss.game_session_id
       INNER JOIN users u ON u.id = s.user_id WHERE u.email LIKE '%@m06.test'`,
    );
    await pool.execute(
      `DELETE e FROM game_session_events e
       INNER JOIN game_sessions s ON s.id = e.game_session_id
       INNER JOIN users u ON u.id = s.user_id WHERE u.email LIKE '%@m06.test'`,
    );
    await pool.execute(
      `DELETE s FROM game_sessions s INNER JOIN users u ON u.id = s.user_id
       WHERE u.email LIKE '%@m06.test'`,
    );
    await pool.execute(
      `DELETE x FROM xp_ledger x INNER JOIN users u ON u.id = x.user_id
       WHERE u.email LIKE '%@m06.test'`,
    );
    await pool.execute(
      `DELETE s FROM auth_sessions s INNER JOIN users u ON u.id = s.user_id
       WHERE u.email LIKE '%@m06.test'`,
    );
    await pool.execute(
      `DELETE t FROM auth_tokens t INNER JOIN users u ON u.id = t.user_id
       WHERE u.email LIKE '%@m06.test'`,
    );
    await pool.execute(`DELETE FROM users WHERE email LIKE '%@m06.test'`);
  } finally {
    await pool.query(
      `CREATE TRIGGER trg_xp_ledger_prevent_update
       BEFORE UPDATE ON xp_ledger
       FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'xp_ledger is append-only'`,
    );
    await pool.query(
      `CREATE TRIGGER trg_xp_ledger_prevent_delete
       BEFORE DELETE ON xp_ledger
       FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'xp_ledger is append-only'`,
    );
  }
}
