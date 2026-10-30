import { createHmac, timingSafeEqual } from 'node:crypto';

// Opaque, signed pagination cursors (api-contracts.md, Conventions). A cursor holds the last
// row's (created_at, id) and the scope it was issued for (an owner id, or a list and filter for
// admin queries), and is signed with a key derived for one purpose, so it cannot be edited,
// forged, or replayed against another account, list or filter.
// created_at is kept as PostgreSQL text with microseconds: a JavaScript Date keeps only
// milliseconds, which would make pages skip or repeat links created in the same millisecond.

export function createCursorCodec(secret, purpose = 'links-cursor-v1') {
  const key = createHmac('sha256', secret).update(purpose).digest();

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
