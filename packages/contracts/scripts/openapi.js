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
          summary: 'Create a guest link (requires X-CSRF-Token from GET /api/v1/auth/csrf and an allowed Origin)',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GuestCreateLinkRequest' } } },
          },
          responses: {
            201: jsonResponse('Created. Generated code, expires in 7 days. No id, Location or ETag.', 'GuestCreateLinkResponse'),
            400: jsonResponse('VALIDATION_FAILED (fields listed; unknown fields such as customAlias or ownerId are rejected), INVALID_JSON.', 'ErrorEnvelope'),
            403: jsonResponse('CSRF_INVALID, ORIGIN_NOT_ALLOWED, CHALLENGE_REQUIRED (retry with challengeToken), or EMAIL_NOT_VERIFIED for a signed-in unverified account.', 'ErrorEnvelope'),
            429: jsonResponse('RATE_LIMITED; Retry-After is set.', 'ErrorEnvelope'),
            501: jsonResponse('Signed-in creation is not implemented yet (T17).', 'ErrorEnvelope'),
            503: jsonResponse('Redis or PostgreSQL unavailable; Retry-After is set.', 'ErrorEnvelope'),
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
