import { expect } from 'chai';
import request from 'supertest';

import { buildTestApp, createTestConfig } from '../helpers/test-app.js';

describe('HTTP safety defaults and errors', () => {
  it('returns the standardized unknown-route response', async () => {
    const response = await request(buildTestApp()).get('/api/v1/not-found').expect(404);

    expect(response.body.error.code).to.equal('ROUTE_NOT_FOUND');
    expect(response.body.error.message).to.equal('Route not found');
    expect(response.body.error.requestId).to.equal(response.headers['x-request-id']);
  });

  it('rejects an unapproved browser origin', async () => {
    const response = await request(buildTestApp())
      .get('/api/v1/health')
      .set('Origin', 'https://untrusted.example')
      .expect(403);

    expect(response.body.error.code).to.equal('CORS_ORIGIN_DENIED');
  });

  it('rejects a request payload over the configured limit', async () => {
    const config = createTestConfig({ REQUEST_BODY_LIMIT: '100b' });
    const response = await request(buildTestApp(undefined, config))
      .post('/api/v1/health')
      .send({ payload: 'x'.repeat(200) })
      .expect(413);

    expect(response.body.error.code).to.equal('PAYLOAD_TOO_LARGE');
  });

  it('rejects invalid JSON safely', async () => {
    const response = await request(buildTestApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);

    expect(response.body.error.code).to.equal('INVALID_JSON');
    expect(response.body.error).not.to.have.property('stack');
  });

  it('enforces the configured request rate limit', async () => {
    const config = createTestConfig({ RATE_LIMIT_MAX: '1' });
    const app = buildTestApp(undefined, config);

    await request(app).get('/api/v1/health').expect(200);
    const response = await request(app).get('/api/v1/health').expect(429);

    expect(response.body.error.code).to.equal('RATE_LIMIT_EXCEEDED');
    expect(response.headers.ratelimit).to.be.a('string');
  });
});
