import { createHmac, timingSafeEqual } from 'node:crypto';

// Opaque, signed pagination cursors for an owner's link list (api-contracts.md, Conventions).
// A cursor holds the last row's (created_at, id) and the owner it was issued to, and is signed
// with a server key, so it cannot be edited, forged or replayed by another account.
// created_at is kept as PostgreSQL text with microseconds: a JavaScript Date keeps only
// milliseconds, which would make pages skip or repeat links created in the same millisecond.

export function createCursorCodec(secret) {
  const key = createHmac('sha256', secret).update('links-cursor-v1').digest();

  const sign = (payload) => createHmac('sha256', key).update(payload).digest('base64url');

  function encode({ ownerId, createdAt, id }) {
    const payload = Buffer.from(JSON.stringify({ o: ownerId, c: createdAt, i: id })).toString('base64url');

    return `${payload}.${sign(payload)}`;
  }

  // Returns { createdAt, id } or null when the cursor is malformed, tampered with or belongs
  // to another owner.
  function decode(cursor, { ownerId }) {
    const [payload, signature, extra] = String(cursor).split('.');

    if (!payload || !signature || extra !== undefined) return null;

    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(signature);

    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

    try {
      const { o, c, i } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

      return o === ownerId ? { createdAt: c, id: i } : null;
    } catch {
      return null;
    }
  }

  return { encode, decode };
}
