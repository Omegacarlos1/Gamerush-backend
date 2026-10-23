import { z } from 'zod';

import { InvalidRequestError } from '../../../shared/errors/app-error.js';
import { runnerEvidenceContractVersion } from '../application/score-verification.ports.js';

const publicId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const safeUnsignedInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const scoreSessionParamsSchema = z.strictObject({ sessionId: publicId });
export const scoreSubmissionParamsSchema = z.strictObject({ submissionId: publicId });
export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/);

export const scoreEvidenceSchema = z
  .strictObject({
    contractVersion: z.literal(runnerEvidenceContractVersion),
    gameVersionId: publicId,
    rulesVersion: z.string().min(1).max(32),
    seed: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    simulationTicks: z.number().int().min(1).max(72_000),
    terminal: z.strictObject({
      type: z.enum(['collision', 'timeout']),
      tick: z.number().int().min(1).max(72_000),
    }),
    events: z
      .array(
        z.strictObject({
          sequence: z.number().int().min(1).max(1_024),
          tick: z.number().int().min(1).max(72_000),
          type: z.enum(['jump', 'moveLeft', 'moveRight']),
          payload: z.strictObject({}),
        }),
      )
      .max(1_024),
    claimed: z.strictObject({
      metres: safeUnsignedInteger,
      coins: safeUnsignedInteger,
      score: safeUnsignedInteger,
    }),
  })
  .superRefine((evidence, context) => {
    if (evidence.terminal.tick !== evidence.simulationTicks) {
      context.addIssue({
        code: 'custom',
        path: ['terminal', 'tick'],
        message: 'invalid terminal tick',
      });
    }
    let priorTick = 0;
    for (const [index, event] of evidence.events.entries()) {
      if (event.sequence !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'sequence'],
          message: 'invalid sequence',
        });
      }
      if (event.tick <= priorTick || event.tick > evidence.simulationTicks) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'tick'],
          message: 'invalid tick order',
        });
      }
      priorTick = event.tick;
    }
  });

export function parseScoreInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new InvalidRequestError();
  return result.data;
}
