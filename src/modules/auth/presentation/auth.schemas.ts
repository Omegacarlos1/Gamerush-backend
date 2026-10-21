import { z } from 'zod';

import { InvalidRequestError } from '../../../shared/errors/app-error.js';

const normalizedEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));
const normalizedUsername = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_]+$/);
const password = z
  .string()
  .min(12)
  .max(128)
  .refine(
    (value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value),
    'must contain uppercase, lowercase, and numeric characters',
  );

export const registerSchema = z.strictObject({
  email: normalizedEmail,
  username: normalizedUsername,
  password,
});

export const loginSchema = z.strictObject({
  email: normalizedEmail,
  password: z.string().min(1).max(128),
});

export const verifyEmailSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new InvalidRequestError();
  return result.data;
}
