import { createHash } from 'node:crypto';

import { ERROR_CODES } from '@shortlist/contracts';

import { AppError } from '../../errors.js';

import * as repository from './idempotency.repository.js';

// Retry-safe operations (api-contracts.md, "Create — registered user"; database-schema.md).
// The same key with the same request returns the original successful response for 24 hours,
// even if the resource changed since; a fresh GET shows the current state. The same key with a
// different request is a conflict. Only successes are recorded, so a failed attempt simply runs
// again on retry. Keys are scoped to the user, so accounts never see each other's results.

export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

// Visible ASCII, 1-255 characters (a UUID is typical).
const KEY_PATTERN = /^[\x21-\x7E]{1,255}$/;

export function isValidIdempotencyKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

// A stable fingerprint of what was asked for. Keys are sorted so property order does not matter.
export function hashRequest(request) {
  const canonical = JSON.stringify(request, Object.keys(request).sort());

  return createHash('sha256').update(canonical).digest();
}

// Runs `execute(client)` at most once per (user, key) inside the caller's transaction.
// `execute` returns { linkId, response: { status, body, etag } }.
// Returns { response, replayed }.
export async function runOnce(client, { userId, key, requestHash, execute, retentionMs = IDEMPOTENCY_RETENTION_MS }) {
  await repository.lockKey(client, { userId, key });

  const existing = await repository.findRecord(client, { userId, key });

  if (existing && !existing.expired) {
    if (!existing.request_hash.equals(requestHash)) {
      throw new AppError(409, ERROR_CODES.IDEMPOTENCY_KEY_REUSED, 'This Idempotency-Key was already used for a different request.');
    }

    return {
      replayed: true,
      response: { status: existing.response_status, body: existing.response_body, etag: existing.response_etag },
    };
  }

  // After the retention period the key may be used again for a new request.
  if (existing) await repository.deleteRecord(client, { userId, key });

  const { linkId, response } = await execute(client);

  await repository.insertRecord(client, { userId, key, requestHash, linkId, response, retentionMs });

  return { replayed: false, response };
}
