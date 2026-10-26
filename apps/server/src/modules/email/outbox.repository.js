import { randomUUID } from 'node:crypto';

import { encryptPayload } from './rules/payload-crypto.js';

// The email outbox (database-schema.md, email_outbox). The API writes a message in the same
// transaction as the token it carries; the worker delivers it later. Message secrets are
// encrypted at rest and erased (set to an empty payload) once they are no longer needed.

export const OUTBOX_KINDS = Object.freeze({ verification: 'verification', reset: 'reset' });

const EMPTY = Buffer.alloc(0);

// Writes a message inside the caller's transaction. Returns the message id.
// `payload` holds the recipient and token; it is only ever stored encrypted.
export async function enqueueEmail(client, { key, userId, kind, payload, expiresAt }) {
  const id = randomUUID();

  await client.query(
    `INSERT INTO email_outbox (id, user_id, kind, encrypted_payload, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, userId, kind, encryptPayload(key, id, payload), expiresAt],
  );

  return id;
}

// Claims up to `limit` due messages for this worker for `leaseMs`, in one short transaction.
// SKIP LOCKED lets several workers claim different messages without waiting on each other.
// A message whose lease ran out (worker crashed mid-send) becomes claimable again.
// Payloads are returned still encrypted: the sender decrypts each one separately, so a single
// unreadable row cannot block the rest of the batch.
export async function claimDueMessages(pool, { limit, leaseMs, maxAttempts }) {
  const { rows } = await pool.query(
    `UPDATE email_outbox
     SET attempts = attempts + 1,
         locked_until = now() + make_interval(secs => $2)
     WHERE id IN (
       SELECT id FROM email_outbox
       WHERE sent_at IS NULL
         AND next_attempt_at <= now()
         AND (locked_until IS NULL OR locked_until < now())
         AND expires_at > now()
         AND attempts < $3
         AND octet_length(encrypted_payload) > 0
       ORDER BY next_attempt_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, kind, attempts, encrypted_payload`,
    [limit, leaseMs / 1000, maxAttempts],
  );

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    attempts: row.attempts,
    encryptedPayload: row.encrypted_payload,
  }));
}

// Delivered: record it and erase the secret.
export async function markSent(pool, id) {
  await pool.query(
    `UPDATE email_outbox
     SET sent_at = now(), locked_until = NULL, last_error_code = NULL, encrypted_payload = $2
     WHERE id = $1 AND sent_at IS NULL`,
    [id, EMPTY],
  );
}

// Failed: retry after `retryInMs`, or give up and erase the secret when `giveUp` is set.
// `errorCode` must be a short code (e.g. SMTP_421, ECONNREFUSED), never a provider message,
// which can contain the recipient address.
export async function markFailed(pool, id, { errorCode, retryInMs, giveUp }) {
  await pool.query(
    `UPDATE email_outbox
     SET locked_until = NULL,
         last_error_code = $2,
         next_attempt_at = now() + make_interval(secs => $3),
         encrypted_payload = CASE WHEN $4::boolean THEN $5::bytea ELSE encrypted_payload END
     WHERE id = $1 AND sent_at IS NULL`,
    [id, errorCode, retryInMs / 1000, giveUp, EMPTY],
  );
}

// Erases secrets of messages that expired before delivery or ran out of attempts.
export async function purgeUndeliverable(pool, { maxAttempts }) {
  const { rowCount } = await pool.query(
    `UPDATE email_outbox
     SET encrypted_payload = $2,
         last_error_code = COALESCE(last_error_code, 'EXPIRED')
     WHERE sent_at IS NULL
       AND octet_length(encrypted_payload) > 0
       AND (expires_at <= now() OR attempts >= $1)
       AND (locked_until IS NULL OR locked_until < now())`,
    [maxAttempts, EMPTY],
  );

  return rowCount;
}
