import { createHash, randomBytes } from 'node:crypto';

import { enqueueEmail } from '../email/outbox.repository.js';

import * as tokensRepository from './tokens.repository.js';

// One-time tokens for email verification and password reset (database-schema.md, auth_tokens).
//   * 256 random bits; only the SHA-256 hash is stored, so a database leak reveals no token.
//   * Single use, with an expiry. Issuing a new token of a purpose revokes the user's older
//     unused ones, so only the most recent email link works.
//   * All functions take a transaction client: issuing happens in the same transaction as the
//     outbox write, and consuming happens in the same transaction as the account change.

export const TOKEN_PURPOSES = Object.freeze({ verification: 'verification', reset: 'reset' });

function hashToken(token) {
  return createHash('sha256').update(token).digest();
}

// Returns { token, expiresAt }. The raw token exists only in this return value and the
// encrypted outbox payload; it is never stored or logged.
export async function issueToken(client, { userId, purpose, lifetimeMs }) {
  const token = randomBytes(32).toString('base64url');

  await tokensRepository.revokeUnusedTokens(client, { userId, purpose });

  const expiresAt = await tokensRepository.insertToken(client, { userId, purpose, tokenHash: hashToken(token), lifetimeMs });

  return { token, expiresAt };
}

// Consumes a token atomically: the row lock makes concurrent attempts wait, so exactly one
// can succeed. Returns { ok: true, userId } or { ok: false, reason: 'invalid'|'expired'|'used' }.
// The caller's transaction must commit for the consumption to count; a rollback restores it.
export async function consumeToken(client, { token, purpose }) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 128) {
    return { ok: false, reason: 'invalid' };
  }

  const row = await tokensRepository.findTokenForUpdate(client, { tokenHash: hashToken(token), purpose });

  if (!row) return { ok: false, reason: 'invalid' };
  if (row.used_at) return { ok: false, reason: 'used' };
  if (row.expired) return { ok: false, reason: 'expired' };

  await tokensRepository.markTokenUsed(client, row.id);

  return { ok: true, userId: row.user_id };
}

// Issues a token and queues the email that carries it, inside the caller's transaction:
// either both are committed or neither is, so a committed token always has its email.
// Returns the outbox message id.
export async function issueTokenWithEmail(client, { key, user, purpose, lifetimeMs }) {
  const { token, expiresAt } = await issueToken(client, { userId: user.id, purpose, lifetimeMs });

  return enqueueEmail(client, {
    key,
    userId: user.id,
    kind: purpose,
    payload: { to: user.email, token, expiresAt: expiresAt.toISOString() },
    expiresAt,
  });
}
