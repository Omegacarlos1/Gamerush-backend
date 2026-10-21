import argon2 from 'argon2';

import type { PasswordHasher } from '../application/auth.ports.js';

export const ARGON2ID_PARAMETERS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const;

export class Argon2PasswordHasher implements PasswordHasher {
  public hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2ID_PARAMETERS);
  }

  public verify(passwordHash: string, password: string): Promise<boolean> {
    return argon2.verify(passwordHash, password);
  }
}
