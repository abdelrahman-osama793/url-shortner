import { z } from 'zod';

// Error codes the API can return. Each task adds the codes it introduces here,
// so the UI and the OpenAPI document stay in sync with the server.
export const ERROR_CODES = Object.freeze({
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_JSON: 'INVALID_JSON',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',
  NOT_FOUND: 'NOT_FOUND',
  ALIAS_UNAVAILABLE: 'ALIAS_UNAVAILABLE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

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
