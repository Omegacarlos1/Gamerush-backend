import { expect } from 'chai';
import request from 'supertest';

import { buildTestApp } from '../helpers/test-app.js';

describe('GET /api/v1/health', () => {
  it('returns a healthy response after the database check succeeds', async () => {
    const response = await request(buildTestApp()).get('/api/v1/health').expect(200);

    expect(response.body).to.deep.equal({
      status: 'ok',
      timestamp: '2026-10-13T08:00:00.000Z',
      checks: { database: 'up' },
    });
    expect(response.headers['x-request-id']).to.match(/^[0-9a-f-]{36}$/i);
    expect(response.headers['x-content-type-options']).to.equal('nosniff');
    expect(response.headers['x-powered-by']).to.equal(undefined);
  });

  it('returns a controlled 503 without leaking a database error', async () => {
    const secret = 'database-password-must-not-leak';
    const app = buildTestApp(() =>
      Promise.reject(new Error(`Access denied with password ${secret}`)),
    );

    const response = await request(app).get('/api/v1/health').expect(503);

    expect(response.body.error.code).to.equal('SERVICE_UNAVAILABLE');
    expect(response.body.error.message).to.equal('Service temporarily unavailable');
    expect(JSON.stringify(response.body)).not.to.include(secret);
    expect(response.body.error.requestId).to.equal(response.headers['x-request-id']);
  });

  it('preserves a valid caller request ID', async () => {
    const requestId = 'd9428888-122b-4c26-879b-1234567890ab';
    const response = await request(buildTestApp())
      .get('/api/v1/health')
      .set('X-Request-Id', requestId)
      .expect(200);

    expect(response.headers['x-request-id']).to.equal(requestId);
  });
});
