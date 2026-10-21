import { z } from 'zod';

import { InvalidRequestError } from '../../../shared/errors/app-error.js';

const publicId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

export const gameIdParamsSchema = z.strictObject({ gameId: publicId });
export const sessionIdParamsSchema = z.strictObject({ sessionId: publicId });
export const createGameSessionSchema = z.strictObject({
  mode: z.enum(['practice', 'ranked']),
});

export function parseGameInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new InvalidRequestError();
  return result.data;
}
