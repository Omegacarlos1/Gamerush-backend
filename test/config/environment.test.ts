import { expect } from 'chai';

import { EnvironmentValidationError, parseEnvironment } from '../../src/config/environment.js';

describe('environment configuration', () => {
  it('parses a valid local MariaDB configuration', () => {
    const config = parseEnvironment({
      NODE_ENV: 'development',
      DB_USER: 'playrush_app',
      DB_PASSWORD: 'local-password',
      DB_NAME: 'playrush_dev',
      CORS_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173',
      AUTH_ACCESS_TOKEN_SECRET: 'local-access-secret-at-least-32-characters',
      AUTH_CSRF_SECRET: 'local-csrf-secret-at-least-32-characters',
    });

    expect(config.database.port).to.equal(3306);
    expect(config.corsOrigins).to.deep.equal(['http://localhost:5173', 'http://127.0.0.1:5173']);
    expect(config.games.sessionRateLimit).to.deep.equal({ windowMs: 60_000, max: 10 });
  });

  it('rejects a missing database name without exposing supplied secrets', () => {
    const secret = 'do-not-expose-this-password';
    let thrown: unknown;

    try {
      parseEnvironment({
        NODE_ENV: 'test',
        DB_USER: 'playrush_test',
        DB_PASSWORD: secret,
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(EnvironmentValidationError);
    expect((thrown as EnvironmentValidationError).message).to.include('DB_NAME');
    expect((thrown as EnvironmentValidationError).message).not.to.include(secret);
  });

  it('rejects unsafe production database and CORS settings', () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: 'production',
        DB_USER: 'root',
        DB_PASSWORD: '',
        DB_NAME: 'playrush',
        CORS_ORIGINS: '*',
        AUTH_ACCESS_TOKEN_SECRET: 'production-access-secret-at-least-32-characters',
        AUTH_CSRF_SECRET: 'production-csrf-secret-at-least-32-characters',
        AUTH_COOKIE_SECURE: 'false',
      }),
    )
      .to.throw(EnvironmentValidationError)
      .and.satisfy((error: Error) => {
        expect(error.message).to.include('wildcard origins');
        expect(error.message).to.include('must not be blank');
        expect(error.message).to.include('least-privilege');
        expect(error.message).to.include('must be true in production');
        return true;
      });
  });
});
