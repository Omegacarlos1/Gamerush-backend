export type GameSessionMode = 'practice' | 'ranked';

export type GameSessionStatus =
  'issued' | 'active' | 'submitted' | 'accepted' | 'rejected' | 'expired' | 'abandoned';

export type GameSessionTransitionTarget = Exclude<GameSessionStatus, 'issued' | 'expired'>;

export interface PublicGameCharacter {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly unlockLevel: number;
  readonly cosmeticOnly: true;
}

export interface PublishedGameVersion {
  readonly databaseId: number;
  readonly id: string;
  readonly versionNumber: string;
  readonly rulesVersion: string;
  readonly scoringRules: Readonly<Record<string, unknown>>;
  readonly maxSessionSeconds: number;
  readonly publishedAt: Date;
}

export interface PublishedGame {
  readonly databaseId: number;
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly activeVersion: PublishedGameVersion;
  readonly characters: readonly PublicGameCharacter[];
}

export interface PublicGame {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly activeVersion: Omit<PublishedGameVersion, 'databaseId'>;
  readonly characters: readonly PublicGameCharacter[];
}

export interface GameSessionRecord {
  readonly databaseId: number;
  readonly id: string;
  readonly userId: string;
  readonly game: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
  };
  readonly version: PublishedGameVersion;
  readonly mode: GameSessionMode;
  readonly status: GameSessionStatus;
  readonly seedHash: string;
  readonly nonceHash: string;
  readonly startedAt: Date;
  readonly expiresAt: Date;
  readonly finishedAt: Date | null;
}

export interface PublicGameSession {
  readonly id: string;
  readonly game: GameSessionRecord['game'];
  readonly version: Omit<PublishedGameVersion, 'databaseId'>;
  readonly mode: GameSessionMode;
  readonly status: GameSessionStatus;
  readonly startedAt: Date;
  readonly expiresAt: Date;
  readonly finishedAt: Date | null;
}

export interface IssuedGameSession {
  readonly session: PublicGameSession;
  readonly credentials: {
    readonly seed: string;
    readonly nonce: string;
  };
}

export function toPublicGame(game: PublishedGame): PublicGame {
  return {
    id: game.id,
    slug: game.slug,
    name: game.name,
    description: game.description,
    activeVersion: publicVersion(game.activeVersion),
    characters: game.characters,
  };
}

export function toPublicGameSession(session: GameSessionRecord): PublicGameSession {
  return {
    id: session.id,
    game: session.game,
    version: publicVersion(session.version),
    mode: session.mode,
    status: session.status,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    finishedAt: session.finishedAt,
  };
}

function publicVersion(version: PublishedGameVersion): Omit<PublishedGameVersion, 'databaseId'> {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    rulesVersion: version.rulesVersion,
    scoringRules: version.scoringRules,
    maxSessionSeconds: version.maxSessionSeconds,
    publishedAt: version.publishedAt,
  };
}
