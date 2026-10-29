import { z } from 'zod';

import { EMAIL_MAX_LENGTH, GOOGLE_PURPOSES, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './constants.js';

// Session and account shapes (api-contracts.md, "Authentication").

const email = z.string().trim().max(EMAIL_MAX_LENGTH).pipe(z.email());

const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

// Login accepts any non-empty password up to the maximum: an old account's password may
// predate the current minimum, and the answer must not reveal the policy check.
const anyPassword = z.string().min(1).max(PASSWORD_MAX_LENGTH);

const oneTimeToken = z.string().min(1).max(128);

export const RegisterRequestSchema = z.strictObject({ email, password: newPassword });

export const LoginRequestSchema = z.strictObject({ email, password: anyPassword });

export const VerifyEmailRequestSchema = z.strictObject({ token: oneTimeToken });

export const ResendVerificationRequestSchema = z.strictObject({ email });

export const ForgotPasswordRequestSchema = z.strictObject({ email });

export const ResetPasswordRequestSchema = z.strictObject({ token: oneTimeToken, newPassword });

export const GoogleStartRequestSchema = z.strictObject({
  purpose: z.enum(GOOGLE_PURPOSES),
});

export const GoogleStartResponseSchema = z.object({
  attemptId: z.string(),
  nonce: z.string(),
});

export const GoogleSignInRequestSchema = z.strictObject({
  attemptId: z.string().min(1).max(128),
  credential: z.string().min(1).max(4096),
});

export const CsrfResponseSchema = z.object({
  csrfToken: z.string(),
});

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  emailVerified: z.boolean(),
  role: z.enum(['user', 'admin']),
  status: z.enum(['active', 'suspended']),
});

export const MeResponseSchema = z.object({
  user: UserSchema,
});

export const LoginResponseSchema = z.object({
  user: UserSchema,
  csrfToken: z.string(),
});

// Same body for every outcome, so responses cannot reveal whether an account exists.
export const AcknowledgementSchema = z.object({
  status: z.literal('accepted'),
});

/** @typedef {z.infer<typeof CsrfResponseSchema>} CsrfResponse */
/** @typedef {z.infer<typeof UserSchema>} User */
/** @typedef {z.infer<typeof MeResponseSchema>} MeResponse */
/** @typedef {z.infer<typeof LoginResponseSchema>} LoginResponse */
/** @typedef {z.infer<typeof RegisterRequestSchema>} RegisterRequest */
/** @typedef {z.infer<typeof LoginRequestSchema>} LoginRequest */
