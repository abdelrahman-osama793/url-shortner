import { z } from 'zod';

// Error codes the API can return. Each task adds the codes it introduces here,
// so the UI and the OpenAPI document stay in sync with the server.
export const ERROR_CODES = Object.freeze({
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_JSON: 'INVALID_JSON',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',
  CSRF_INVALID: 'CSRF_INVALID',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  GOOGLE_SIGN_IN_FAILED: 'GOOGLE_SIGN_IN_FAILED',
  ACCOUNT_LINK_REQUIRED: 'ACCOUNT_LINK_REQUIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_USED: 'TOKEN_USED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  REAUTHENTICATION_REQUIRED: 'REAUTHENTICATION_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  CHALLENGE_REQUIRED: 'CHALLENGE_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  PRECONDITION_REQUIRED: 'PRECONDITION_REQUIRED',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  LINK_INACTIVE: 'LINK_INACTIVE',
  ALIAS_UNAVAILABLE: 'ALIAS_UNAVAILABLE',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
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
