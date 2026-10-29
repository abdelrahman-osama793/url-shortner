// Generates openapi.json from the zod schemas, so the document cannot drift from the code.
//
//   node scripts/openapi.js           write openapi.json
//   node scripts/openapi.js --check   exit 1 if openapi.json is out of date (for CI)
//
// Only implemented endpoints are listed under `paths`. Planned shapes appear as components.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import * as contracts from '../src/index.js';

const OUTPUT = fileURLToPath(new URL('../openapi.json', import.meta.url));

const COMPONENT_SCHEMAS = {
  Acknowledgement: contracts.AcknowledgementSchema,
  RegisterRequest: contracts.RegisterRequestSchema,
  LoginRequest: contracts.LoginRequestSchema,
  LoginResponse: contracts.LoginResponseSchema,
  VerifyEmailRequest: contracts.VerifyEmailRequestSchema,
  ResendVerificationRequest: contracts.ResendVerificationRequestSchema,
  ForgotPasswordRequest: contracts.ForgotPasswordRequestSchema,
  GoogleStartRequest: contracts.GoogleStartRequestSchema,
  GoogleStartResponse: contracts.GoogleStartResponseSchema,
  GoogleSignInRequest: contracts.GoogleSignInRequestSchema,
  ResetPasswordRequest: contracts.ResetPasswordRequestSchema,
  CsrfResponse: contracts.CsrfResponseSchema,
  MeResponse: contracts.MeResponseSchema,
  User: contracts.UserSchema,
  ErrorEnvelope: contracts.ErrorEnvelopeSchema,
  ErrorCode: contracts.ErrorCodeSchema,
  LivenessResponse: contracts.LivenessResponseSchema,
  ReadinessResponse: contracts.ReadinessResponseSchema,
  GuestCreateLinkRequest: contracts.GuestCreateLinkRequestSchema,
  GuestCreateLinkResponse: contracts.GuestCreateLinkResponseSchema,
  RegisteredCreateLinkRequest: contracts.RegisteredCreateLinkRequestSchema,
  Link: contracts.LinkSchema,
  LinkListResponse: contracts.LinkListResponseSchema,
  UpdateLinkRequest: contracts.UpdateLinkRequestSchema,
};

function toJsonSchema(schema) {
  const { $schema, ...rest } = z.toJSONSchema(schema, { io: 'output' });

  return rest;
}

function jsonResponse(description, schemaName) {
  return {
    description,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } },
  };
}

function jsonBody(schemaName) {
  return { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } } };
}

const CSRF_NOTE = ' Requires X-CSRF-Token from GET /api/v1/auth/csrf and an allowed Origin.';

function buildDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Shortlist API',
      version: '0.1.0',
      description: 'Generated from @shortlist/contracts. Planned endpoints are specified in api-contracts.md until implemented.',
    },
    paths: {
      '/health/live': {
        get: {
          summary: 'Process liveness',
          responses: { 200: jsonResponse('The process is answering HTTP.', 'LivenessResponse') },
        },
      },
      '/health/ready': {
        get: {
          summary: 'Readiness to admit redirect traffic (PostgreSQL reachable)',
          responses: {
            200: jsonResponse('PostgreSQL is reachable.', 'ReadinessResponse'),
            503: jsonResponse('PostgreSQL is not reachable.', 'ReadinessResponse'),
          },
        },
      },
      '/api/v1/auth/csrf': {
        get: {
          summary: 'CSRF token for this browser; creates an anonymous session cookie (__Host-session) if needed',
          responses: {
            200: jsonResponse('Send this value as X-CSRF-Token on every state-changing request.', 'CsrfResponse'),
            503: jsonResponse('Session storage unavailable.', 'ErrorEnvelope'),
          },
        },
      },
      '/api/v1/auth/register': {
        post: {
          summary: `Create an email/password account and send a verification email.${CSRF_NOTE}`,
          requestBody: jsonBody('RegisterRequest'),
          responses: {
            202: jsonResponse('Always the same answer, whether or not the email already has an account.', 'Acknowledgement'),
            400: jsonResponse('VALIDATION_FAILED (password needs 12-256 characters).', 'ErrorEnvelope'),
            403: jsonResponse('CSRF_INVALID or ORIGIN_NOT_ALLOWED.', 'ErrorEnvelope'),
            429: jsonResponse('RATE_LIMITED.', 'ErrorEnvelope'),
          },
        },
      },
      '/api/v1/auth/email/verify': {
        post: {
          summary: `Consume an email verification token. Does not sign in.${CSRF_NOTE}`,
          requestBody: jsonBody('VerifyEmailRequest'),
          responses: {
            204: { description: 'Email verified.' },
            400: jsonResponse('TOKEN_INVALID, TOKEN_EXPIRED or TOKEN_USED.', 'ErrorEnvelope'),
            403: jsonResponse('CSRF_INVALID or ORIGIN_NOT_ALLOWED.', 'ErrorEnvelope'),
          },
        },
      },
      '/api/v1/auth/email/resend': {
        post: {
          summary: `Send a new verification link (revokes the previous one).${CSRF_NOTE}`,
          requestBody: jsonBody('ResendVerificationRequest'),
          responses: {
            202: jsonResponse('Always the same answer; mail is sent only to an existing unverified account.', 'Acknowledgement'),
            403: jsonResponse('CSRF_INVALID or ORIGIN_NOT_ALLOWED.', 'ErrorEnvelope'),
            429: jsonResponse('RATE_LIMITED.', 'ErrorEnvelope'),
          },
        },
      },
      '/api/v1/auth/password/forgot': {
        post: {
          summary: `Email a password-reset link (revokes earlier links).${CSRF_NOTE}`,
          requestBody: jsonBody('ForgotPasswordRequest'),
          responses: {
            202: jsonResponse('Always the same answer; mail goes only to an existing active account with a password.', 'Acknowledgement'),
            403: jsonResponse('CSRF_INVALID or ORIGIN_NOT_ALLOWED.', 'ErrorEnvelope'),
            429: jsonResponse('RATE_LIMITED.', 'ErrorEnvelope'),
          },
        },
      },
      '/api/v1/auth/password/reset': {
        post: {
          summary: `Set a new password with a reset token. Signs out every existing session; does not sign in.${CSRF_NOTE}`,
          requestBody: jsonBody('ResetPasswordRequest'),
          responses: {
            204: { description: 'Password changed and all previous sessions revoked.' },
            400: jsonResponse('TOKEN_INVALID, TOKEN_EXPIRED, TOKEN_USED, or VALIDATION_FAILED (newPassword needs 12-256 characters).', 'ErrorEnvelope'),
            403: jsonResponse('CSRF_INVALID or ORIGIN_NOT_ALLOWED.', 'ErrorEnvelope'),
          },
        },
      },
      '/api/v1/auth/login': {
        post: {
          summary: `Sign in with email and password. Replaces the session cookie and CSRF token.${CSRF_NOTE}`,
          requestBody: jsonBody('LoginRequest'),
          responses: {
            200: jsonResponse('Signed in. Use the returned csrfToken from now on.', 'LoginResponse'),
            401: jsonResponse('INVALID_CREDENTIALS, identical for unknown email and wrong password.', 'ErrorEnvelope'),
            403: jsonResponse('ACCOUNT_SUSPENDED (correct password), CSRF_INVALID or ORIGIN_NOT_ALLOWED.', 'ErrorEnvelope'),
            429: jsonResponse('RATE_LIMITED.', 'ErrorEnvelope'),
          },
        },
      },
      '/api/v1/auth/google/start': {
        post: {
          summary: `Start a five-minute Google attempt bound to this browser session; pass the nonce to Google Identity Services. Only when GOOGLE_CLIENT_ID is configured.${CSRF_NOTE}`,
          requestBody: jsonBody('GoogleStartRequest'),
          responses: {
            200: jsonResponse('Attempt created.', 'GoogleStartResponse'),
            401: jsonResponse('link and reauthenticate need a signed-in user.', 'ErrorEnvelope'),
            403: jsonResponse('CSRF_INVALID or ORIGIN_NOT_ALLOWED.', 'ErrorEnvelope'),
            429: jsonResponse('RATE_LIMITED.', 'ErrorEnvelope'),
          },
        },
      },
      '/api/v1/auth/google': {
        post: {
          summary: `Sign in with the Google ID token (credential) from a login attempt. Replaces the session cookie and CSRF token.${CSRF_NOTE}`,
          requestBody: jsonBody('GoogleSignInRequest'),
          responses: {
            200: jsonResponse('Signed in (new account created on first use).', 'LoginResponse'),
            401: jsonResponse('GOOGLE_SIGN_IN_FAILED: unknown, expired, reused or foreign attempt; invalid, expired or foreign token; nonce mismatch.', 'ErrorEnvelope'),
            403: jsonResponse('ACCOUNT_SUSPENDED, CSRF_INVALID or ORIGIN_NOT_ALLOWED.', 'ErrorEnvelope'),
            409: jsonResponse('ACCOUNT_LINK_REQUIRED: a password account already uses this email; sign in to it and link Google.', 'ErrorEnvelope'),
            503: jsonResponse("Google's signing keys or session storage unavailable.", 'ErrorEnvelope'),
          },
        },
      },
      '/api/v1/auth/me': {
        get: {
          summary: 'The signed-in user',
          responses: {
            200: jsonResponse('Current user, re-checked against the database.', 'MeResponse'),
            401: jsonResponse('No valid signed-in session (AUTHENTICATION_REQUIRED).', 'ErrorEnvelope'),
            403: jsonResponse('Account suspended (ACCOUNT_SUSPENDED).', 'ErrorEnvelope'),
            503: jsonResponse('Session storage or database unavailable.', 'ErrorEnvelope'),
          },
        },
      },
      '/api/v1/auth/logout': {
        post: {
          summary: 'End the session (requires X-CSRF-Token and an allowed Origin)',
          responses: {
            204: { description: 'Server session deleted and cookie cleared.' },
            403: jsonResponse('Missing or wrong CSRF token, or foreign Origin.', 'ErrorEnvelope'),
            503: jsonResponse('Session storage unavailable; the session was not deleted.', 'ErrorEnvelope'),
          },
        },
      },
      '/api/v1/links': {
        post: {
          parameters: [{
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            description: 'Account holders only (ignored for guests): 1-255 visible ASCII characters, e.g. a UUID. The same key and request within 24 hours returns the original 201 with Idempotent-Replayed: true.',
            schema: { type: 'string', minLength: 1, maxLength: 255 },
          }],
          summary: `Create a link. Anonymous (guest) session: generated code, 7-day expiry, body GuestCreateLinkRequest, no management handle. Signed-in verified account: body RegisteredCreateLinkRequest (optional alias and expiry), full Link with Location and ETag.${CSRF_NOTE}`,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { oneOf: [{ $ref: '#/components/schemas/GuestCreateLinkRequest' }, { $ref: '#/components/schemas/RegisteredCreateLinkRequest' }] },
              },
            },
          },
          responses: {
            201: {
              description: 'Created. Guests receive GuestCreateLinkResponse only; account holders receive Link with Location /api/v1/links/{id} and ETag "v1".',
              content: {
                'application/json': {
                  schema: { oneOf: [{ $ref: '#/components/schemas/GuestCreateLinkResponse' }, { $ref: '#/components/schemas/Link' }] },
                },
              },
            },
            400: jsonResponse('VALIDATION_FAILED (fields listed; unknown fields rejected; expiry must be in the future), INVALID_JSON.', 'ErrorEnvelope'),
            403: jsonResponse('CSRF_INVALID, ORIGIN_NOT_ALLOWED, CHALLENGE_REQUIRED (guests; retry with challengeToken), EMAIL_NOT_VERIFIED or ACCOUNT_SUSPENDED.', 'ErrorEnvelope'),
            409: jsonResponse('ALIAS_UNAVAILABLE (taken or reserved; same answer), or IDEMPOTENCY_KEY_REUSED (same key, different request).', 'ErrorEnvelope'),
            429: jsonResponse('RATE_LIMITED; Retry-After is set.', 'ErrorEnvelope'),
            503: jsonResponse('Redis or PostgreSQL unavailable; Retry-After is set.', 'ErrorEnvelope'),
          },
        },
        get: {
          summary: "The signed-in owner's links, newest first. Query: cursor (opaque, from nextCursor), limit (1-100, default 20).",
          responses: {
            200: jsonResponse('One page; nextCursor is null on the last page.', 'LinkListResponse'),
            400: jsonResponse('VALIDATION_FAILED: limit out of range, or a cursor that was edited or issued to another account.', 'ErrorEnvelope'),
            401: jsonResponse('AUTHENTICATION_REQUIRED.', 'ErrorEnvelope'),
            403: jsonResponse('ACCOUNT_SUSPENDED.', 'ErrorEnvelope'),
          },
        },
      },
      '/api/v1/links/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        get: {
          summary: 'One owned link. Its version is returned as ETag "vN".',
          responses: {
            200: jsonResponse('The link.', 'Link'),
            401: jsonResponse('AUTHENTICATION_REQUIRED.', 'ErrorEnvelope'),
            404: jsonResponse('Not found, or not yours (the same answer).', 'ErrorEnvelope'),
          },
        },
        patch: {
          summary: `Change destination, expiry (null removes it) or enabled. Requires If-Match: "vN" from the last read. Enabling never overrides an admin block, an expiry or a suspension.${CSRF_NOTE}`,
          requestBody: jsonBody('UpdateLinkRequest'),
          responses: {
            200: jsonResponse('Updated after commit; new ETag.', 'Link'),
            400: jsonResponse('VALIDATION_FAILED: unknown or immutable fields (code, alias, owner), empty change, past expiry, invalid destination.', 'ErrorEnvelope'),
            403: jsonResponse('CSRF_INVALID, ORIGIN_NOT_ALLOWED, EMAIL_NOT_VERIFIED or ACCOUNT_SUSPENDED.', 'ErrorEnvelope'),
            404: jsonResponse('Not found, or not yours.', 'ErrorEnvelope'),
            412: jsonResponse('PRECONDITION_FAILED: the link changed since that version; reload and retry.', 'ErrorEnvelope'),
            428: jsonResponse('PRECONDITION_REQUIRED: If-Match missing or malformed.', 'ErrorEnvelope'),
          },
        },
      },
      '/r/{code}': {
        get: {
          summary: 'Public redirect (HEAD behaves the same with no body)',
          parameters: [{
            name: 'code',
            in: 'path',
            required: true,
            description: 'Exact, case-sensitive short code (4-32 of A-Z a-z 0-9 _ -).',
            schema: { type: 'string', pattern: contracts.ALIAS_PATTERN.source },
          }],
          responses: {
            302: { description: 'Active link. Location is the stored destination; the request query is not appended.' },
            400: jsonResponse('Malformed percent-encoding in the path.', 'ErrorEnvelope'),
            404: jsonResponse('Unknown or malformed code.', 'ErrorEnvelope'),
            405: jsonResponse('Only GET and HEAD are allowed.', 'ErrorEnvelope'),
            410: jsonResponse('Inactive link (expired, disabled, blocked or owner suspended).', 'ErrorEnvelope'),
            503: jsonResponse('Database unavailable or overloaded. Retry-After is set.', 'ErrorEnvelope'),
          },
        },
      },
    },
    components: {
      schemas: Object.fromEntries(
        Object.entries(COMPONENT_SCHEMAS).map(([name, schema]) => [name, toJsonSchema(schema)]),
      ),
    },
  };
}

async function main() {
  const generated = `${JSON.stringify(buildDocument(), null, 2)}\n`;

  if (process.argv.includes('--check')) {
    const current = await readFile(OUTPUT, 'utf8').catch(() => '');

    if (current !== generated) {
      console.error('openapi.json is out of date. Run: npm run openapi -w @shortlist/contracts');
      process.exit(1);
    }

    console.log('openapi.json is up to date');
    return;
  }

  await writeFile(OUTPUT, generated);
  console.log(`wrote ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
