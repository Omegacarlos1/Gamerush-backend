import { createHash } from 'node:crypto';

import type {
  RunnerInputEvent,
  ScoreEvidence,
  ScoreVerificationPort,
  ScoreVerificationResult,
  VerifiableGameSession,
} from '../application/score-verification.ports.js';
import { runnerRulesVersion } from '../application/score-verification.ports.js';

const ticksPerSecond = 20;
const millimetresPerTick = 250;
const jumpDurationTicks = 12;
const jumpCooldownTicks = 16;
const safeStartTicks = 80;

interface RulesV1 {
  readonly metresPerPoint: 1;
  readonly pointsPerCoin: 10;
  readonly sessionDurationSeconds: number;
}

export class DeterministicRunnerVerifier implements ScoreVerificationPort {
  public verify(session: VerifiableGameSession, evidence: ScoreEvidence): ScoreVerificationResult {
    const rules = parseRules(session);
    if (rules === null) return rejected('unsupported_rules');

    const maxTicks = rules.sessionDurationSeconds * ticksPerSecond;
    if (
      evidence.simulationTicks < 1 ||
      evidence.simulationTicks > maxTicks ||
      evidence.terminal.tick !== evidence.simulationTicks
    ) {
      return rejected('duration');
    }

    let lane = 1;
    let airborneUntil = 0;
    let nextJumpAllowed = 1;
    let coins = 0;
    let eventIndex = 0;
    let randomState = seedState(evidence.seed);
    let collisionTick: number | null = null;

    for (let tick = 1; tick <= evidence.simulationTicks; tick += 1) {
      randomState = nextRandom(randomState);
      const event = evidence.events[eventIndex];
      if (event?.tick === tick) {
        const applied = applyEvent(event, tick, lane, nextJumpAllowed);
        if (applied === null) return rejected('impossible_action');
        lane = applied.lane;
        if (event.type === 'jump') {
          airborneUntil = tick + jumpDurationTicks;
          nextJumpAllowed = tick + jumpCooldownTicks;
        }
        eventIndex += 1;
      }

      if (tick <= safeStartTicks) continue;
      const roll = randomState & 0xff;
      const entityLane = (randomState >>> 8) % 3;
      if (roll < 5 && entityLane === lane) coins += 1;
      if (roll >= 5 && roll < 9 && entityLane === lane && tick >= airborneUntil) {
        collisionTick = tick;
        break;
      }
    }

    if (eventIndex !== evidence.events.length) return rejected('event_after_terminal');
    if (evidence.terminal.type === 'collision' && collisionTick !== evidence.simulationTicks) {
      return rejected('terminal_mismatch');
    }
    if (
      evidence.terminal.type === 'timeout' &&
      (collisionTick !== null || evidence.simulationTicks !== maxTicks)
    ) {
      return rejected('terminal_mismatch');
    }
    if (collisionTick !== null && evidence.terminal.type !== 'collision') {
      return rejected('terminal_mismatch');
    }

    const metres = Math.floor((evidence.simulationTicks * millimetresPerTick) / 1_000);
    const score = metres * rules.metresPerPoint + coins * rules.pointsPerCoin;
    if (!Number.isSafeInteger(score)) return rejected('score_range');

    return {
      accepted: true,
      result: {
        metres,
        coins,
        score,
        finishedAt: new Date(
          session.startedAt.getTime() + (evidence.simulationTicks * 1_000) / ticksPerSecond,
        ),
      },
    };
  }
}

function parseRules(session: VerifiableGameSession): RulesV1 | null {
  const rules = session.scoringRules;
  if (
    session.rulesVersion !== runnerRulesVersion ||
    rules.metresPerPoint !== 1 ||
    rules.pointsPerCoin !== 10 ||
    rules.sessionDurationSeconds !== session.maxSessionSeconds ||
    !Number.isSafeInteger(rules.sessionDurationSeconds) ||
    rules.sessionDurationSeconds < 1
  ) {
    return null;
  }
  return rules as unknown as RulesV1;
}

function applyEvent(
  event: RunnerInputEvent,
  tick: number,
  lane: number,
  nextJumpAllowed: number,
): { readonly lane: number } | null {
  if (event.type === 'jump') return tick < nextJumpAllowed ? null : { lane };
  if (event.type === 'moveLeft') return lane === 0 ? null : { lane: lane - 1 };
  return lane === 2 ? null : { lane: lane + 1 };
}

function seedState(seed: string): number {
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  const value = digest.readUInt32BE(0);
  return value === 0 ? 0x9e3779b9 : value;
}

function nextRandom(value: number): number {
  let next = value >>> 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next >>> 0;
}

function rejected(category: string): ScoreVerificationResult {
  return { accepted: false, category };
}

export const runnerV1Constants = {
  ticksPerSecond,
  millimetresPerTick,
  jumpDurationTicks,
  jumpCooldownTicks,
  safeStartTicks,
} as const;
