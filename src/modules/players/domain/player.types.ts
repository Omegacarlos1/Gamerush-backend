export type TrustedXpSource = 'gameplay' | 'leaderboard_reward' | 'achievement';

export interface PlayerProfileRecord {
  readonly userDatabaseId: number;
  readonly userId: string;
  readonly username: string;
  readonly displayName: string | null;
  readonly bio: string | null;
  readonly totalXp: number;
  readonly level: number;
  readonly allTimeBestScore: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PublicPlayerProfile {
  readonly id: string;
  readonly username: string;
  readonly displayName: string | null;
  readonly bio: string | null;
  readonly totalXp: number;
  readonly level: number;
  readonly allTimeBestScore: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProgressionPolicyRecord {
  readonly version: string;
  readonly scorePointsPerXp: number;
  readonly xpPerLevel: number;
  readonly startingLevel: number;
  readonly roundingMode: string;
}

export interface XpLedgerRecord {
  readonly userId: string;
  readonly amount: number;
  readonly balanceAfter: number;
  readonly sourceType: string;
  readonly sourceReference: string;
  readonly idempotencyKey: string;
  readonly policyVersion: string;
  readonly levelAfter: number;
  readonly createdAt: Date;
}

export interface XpHistoryRecord {
  readonly amount: number;
  readonly balanceAfter: number;
  readonly sourceType: string;
  readonly sourceReference: string;
  readonly createdAt: string;
  readonly cursorCreatedAt: string;
  readonly cursorId: string;
}

export interface XpHistoryItem {
  readonly amount: number;
  readonly balanceAfter: number;
  readonly sourceType: string;
  readonly sourceReference: string;
  readonly createdAt: string;
}

export interface XpAwardResult {
  readonly userId: string;
  readonly amount: number;
  readonly balanceAfter: number;
  readonly levelAfter: number;
  readonly sourceType: TrustedXpSource;
  readonly sourceReference: string;
  readonly policyVersion: string;
  readonly createdAt: Date;
  readonly replayed: boolean;
}

export function toPublicPlayerProfile(profile: PlayerProfileRecord): PublicPlayerProfile {
  return {
    id: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    bio: profile.bio,
    totalXp: profile.totalXp,
    level: profile.level,
    allTimeBestScore: profile.allTimeBestScore,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
