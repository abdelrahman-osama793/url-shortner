import { createHash, randomBytes } from 'node:crypto';

import { enqueueEmail } from '../email/outbox.js';

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

  await client.query(
    `UPDATE auth_tokens
     SET used_at = now()
     WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
    [userId, purpose],
  );

  const { rows } = await client.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))
     RETURNING expires_at`,
    [userId, purpose, hashToken(token), lifetimeMs / 1000],
  );

  return { token, expiresAt: rows[0].expires_at };
}

// Consumes a token atomically: the row lock makes concurrent attempts wait, so exactly one
// can succeed. Returns { ok: true, userId } or { ok: false, reason: 'invalid'|'expired'|'used' }.
// The caller's transaction must commit for the consumption to count; a rollback restores it.
export async function consumeToken(client, { token, purpose }) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 128) {
    return { ok: false, reason: 'invalid' };
  }

  const { rows } = await client.query(
    `SELECT id, user_id, used_at, expires_at <= now() AS expired
     FROM auth_tokens
     WHERE token_hash = $1 AND purpose = $2
     FOR UPDATE`,
    [hashToken(token), purpose],
  );

  const row = rows[0];

  if (!row) return { ok: false, reason: 'invalid' };
  if (row.used_at) return { ok: false, reason: 'used' };
  if (row.expired) return { ok: false, reason: 'expired' };

  await client.query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [row.id]);

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
