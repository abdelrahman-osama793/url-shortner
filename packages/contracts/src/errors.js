import { z } from 'zod';

import { ERROR_CODES } from './constants.js';

export const ErrorCodeSchema = z.enum(Object.values(ERROR_CODES));

// One problem with one request field. Never contains the submitted value.
export const FieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});

// Error envelope returned by every failed API request (api-contracts.md, Conventions).
// `fields` is present only for VALIDATION_FAILED, so forms can show field-level errors.
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    fields: z.array(FieldErrorSchema).optional(),
  }),
});

/** @typedef {z.infer<typeof ErrorCodeSchema>} ErrorCode */
/** @typedef {z.infer<typeof FieldErrorSchema>} FieldError */
/** @typedef {z.infer<typeof ErrorEnvelopeSchema>} ErrorEnvelope */
