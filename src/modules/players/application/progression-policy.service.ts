import { InvalidRequestError, ServiceUnavailableError } from '../../../shared/errors/app-error.js';
import type { PlayerTransaction } from './player.ports.js';
import type { ProgressionPolicyRecord } from '../domain/player.types.js';

export class ProgressionPolicyService {
  public async loadActive(
    transaction: PlayerTransaction,
    at: Date,
  ): Promise<ProgressionPolicyRecord> {
    return this.validate(await transaction.findActiveProgressionPolicy(at));
  }

  public validate(policy: ProgressionPolicyRecord | null): ProgressionPolicyRecord {
    if (
      policy?.roundingMode !== 'floor' ||
      !Number.isSafeInteger(policy.scorePointsPerXp) ||
      policy.scorePointsPerXp <= 0 ||
      !Number.isSafeInteger(policy.xpPerLevel) ||
      policy.xpPerLevel <= 0 ||
      !Number.isSafeInteger(policy.startingLevel) ||
      policy.startingLevel < 1
    ) {
      throw new ServiceUnavailableError();
    }
    return policy;
  }

  public xpFromValidatedScore(score: number, policy: ProgressionPolicyRecord): number {
    if (!Number.isSafeInteger(score) || score < 0) {
      throw new InvalidRequestError('Validated score must be a non-negative safe integer');
    }
    return Math.floor(score / policy.scorePointsPerXp);
  }

  public levelFromTotalXp(totalXp: number, policy: ProgressionPolicyRecord): number {
    if (!Number.isSafeInteger(totalXp) || totalXp < 0) {
      throw new InvalidRequestError('Total XP must be a non-negative safe integer');
    }
    return policy.startingLevel + Math.floor(totalXp / policy.xpPerLevel);
  }
}
