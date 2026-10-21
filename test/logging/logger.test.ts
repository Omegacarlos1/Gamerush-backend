import { Writable } from 'node:stream';

import { expect } from 'chai';

import { createLogger } from '../../src/shared/logging/logger.js';
import { createTestConfig } from '../helpers/test-app.js';

describe('structured logger', () => {
  it('redacts common secret fields', () => {
    let output = '';
    const destination = new Writable({
      write(chunk: unknown, _encoding, callback) {
        output += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        callback();
      },
    });
    const logger = createLogger(createTestConfig({ LOG_LEVEL: 'info' }), destination);

    logger.info(
      {
        password: 'top-secret-password',
        token: 'top-secret-token',
        refreshToken: 'top-secret-refresh-token',
        csrfToken: 'top-secret-csrf-token',
        headers: { authorization: 'Bearer top-secret-token' },
      },
      'redaction check',
    );

    expect(output).not.to.include('top-secret-password');
    expect(output).not.to.include('top-secret-token');
    expect(output).not.to.include('top-secret-refresh-token');
    expect(output).not.to.include('top-secret-csrf-token');
    expect(output).to.include('[REDACTED]');
  });
});
