// Plain shared constants with no dependencies (no zod), so the Angular app can import them
// without pulling the validation library into its bundle:
//   import { ERROR_CODES } from '@shortlist/contracts/constants';
// The main entry point re-exports everything here for the server.

// Links (api-contracts.md, "Links").
export const DESTINATION_MAX_LENGTH = 4096;

// Custom aliases: 4-32 ASCII letters, digits, hyphens or underscores. Case-sensitive.
export const ALIAS_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;

// Generated codes: this many random Base62 characters.
export const GENERATED_CODE_LENGTH = 8;

// Guest links expire this long after creation (decision D04).
export const GUEST_LINK_LIFETIME_DAYS = 7;

// Challenge action bound to guest link creation tokens.
export const GUEST_CREATE_CHALLENGE_ACTION = 'guest-create';

export const LINKS_PAGE_DEFAULT = 20;
export const LINKS_PAGE_MAX = 100;

// Accounts. Length-only password policy (OWASP/NIST); 12 is the UI handoff's provisional
// minimum and the maximum bounds hashing cost.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;
export const EMAIL_MAX_LENGTH = 254;

export const GOOGLE_PURPOSES = ['login', 'link', 'reauthenticate'];

// Analytics (api-contracts.md, "Analytics contract").
export const ANALYTICS_MAX_RANGE_DAYS = 90;
export const ANALYTICS_DEFAULT_RANGE_DAYS = 30;
export const ANALYTICS_TOP_REFERRERS = 20;

// Abuse reports (api-contracts.md, "Reports and moderation"). Details match the database limit.
export const REPORT_CATEGORIES = Object.freeze(['phishing', 'malware', 'spam', 'other']);
export const REPORT_DETAILS_MAX_LENGTH = 2000;

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
  GOOGLE_ACCOUNT_IN_USE: 'GOOGLE_ACCOUNT_IN_USE',
  GOOGLE_ALREADY_LINKED: 'GOOGLE_ALREADY_LINKED',
  SELF_MODERATION: 'SELF_MODERATION',
  LAST_ACTIVE_ADMIN: 'LAST_ACTIVE_ADMIN',
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
