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
    });

    expect(config.database.port).to.equal(3306);
    expect(config.corsOrigins).to.deep.equal(['http://localhost:5173', 'http://127.0.0.1:5173']);
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
      }),
    )
      .to.throw(EnvironmentValidationError)
      .and.satisfy((error: Error) => {
        expect(error.message).to.include('wildcard origins');
        expect(error.message).to.include('must not be blank');
        expect(error.message).to.include('least-privilege');
        return true;
      });
  });
});
