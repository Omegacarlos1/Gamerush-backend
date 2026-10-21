import type { VerificationDelivery } from '../application/auth.ports.js';

export class UnconfiguredVerificationDelivery implements VerificationDelivery {
  public deliver(): Promise<void> {
    return Promise.resolve();
  }
}
