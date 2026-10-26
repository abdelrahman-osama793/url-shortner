import { z } from 'zod';

// Error envelope returned by every failed API request (api-contracts.md, Conventions).
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});

/** @typedef {z.infer<typeof ErrorEnvelopeSchema>} ErrorEnvelope */
