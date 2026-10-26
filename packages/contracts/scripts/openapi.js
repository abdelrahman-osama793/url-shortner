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
