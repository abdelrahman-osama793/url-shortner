import { z } from 'zod';

// Session and account shapes (api-contracts.md, "Authentication").

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

/** @typedef {z.infer<typeof CsrfResponseSchema>} CsrfResponse */
/** @typedef {z.infer<typeof UserSchema>} User */
/** @typedef {z.infer<typeof MeResponseSchema>} MeResponse */
