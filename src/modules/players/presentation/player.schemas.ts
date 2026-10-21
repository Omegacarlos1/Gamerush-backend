import { z } from 'zod';

import { InvalidRequestError } from '../../../shared/errors/app-error.js';

export const profilePatchSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).max(80).nullable().optional(),
    bio: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => value.displayName !== undefined || value.bio !== undefined);

export const xpHistoryQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new InvalidRequestError();
  return result.data;
}
