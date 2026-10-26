import { z } from 'zod';

// Operational endpoints (api-contracts.md, "Operational endpoints"). Responses stay minimal:
// they say whether a dependency is usable, never why it failed.

export const LivenessResponseSchema = z.object({
  status: z.literal('ok'),
});

export const ReadinessResponseSchema = z.object({
  status: z.enum(['ready', 'unavailable']),
  checks: z.object({
    postgres: z.enum(['up', 'down']),
  }),
});

/** @typedef {z.infer<typeof LivenessResponseSchema>} LivenessResponse */
/** @typedef {z.infer<typeof ReadinessResponseSchema>} ReadinessResponse */
