import { createHash, randomBytes } from 'node:crypto';

// Short-lived Google sign-in attempts in Redis (database-schema.md, "login-attempt:<id>").
// An attempt carries the nonce the browser hands to Google, its purpose (login, link or
// reauthenticate), the browser session that started it, and the user when linking.
// It can be used once, from that same browser session, within five minutes. A Redis-backed
// service owns its keys directly; there is no SQL repository.

const ATTEMPT_LIFETIME_MS = 5 * 60 * 1000;

export class GoogleAttemptsUnavailableError extends Error {
  constructor(cause) {
    super('google sign-in attempts are unavailable', { cause });
    this.name = 'GoogleAttemptsUnavailableError';
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest('base64url');
}

export function createGoogleAttemptsService({ redis, keyPrefix = '' }) {
  const keyFor = (attemptId) => `${keyPrefix}login-attempt:${attemptId}`;

  async function redisCall(operation) {
    try {
      return await operation();
    } catch (error) {
      throw new GoogleAttemptsUnavailableError(error);
    }
  }

  // Returns { attemptId, nonce }. Only a hash of the session token is stored, as the binding.
  async function create({ purpose, sessionToken, userId = null }) {
    const attemptId = randomBytes(16).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const attempt = { purpose, nonce, binding: hash(sessionToken), userId };

    await redisCall(() => redis.set(keyFor(attemptId), JSON.stringify(attempt), {
      expiration: { type: 'PX', value: ATTEMPT_LIFETIME_MS },
    }));

    return { attemptId, nonce };
  }

  // Removes the attempt and returns it, or returns null when it is unknown, expired, already
  // used, for another purpose, or started by a different browser session. GETDEL makes the
  // read-and-delete atomic, so two requests can never both use one attempt.
  async function consume(attemptId, { purpose, sessionToken }) {
    if (typeof attemptId !== 'string' || attemptId.length === 0 || attemptId.length > 128) return null;

    const raw = await redisCall(() => redis.getDel(keyFor(attemptId)));

    if (!raw) return null;

    const attempt = JSON.parse(raw);

    if (attempt.purpose !== purpose || attempt.binding !== hash(sessionToken ?? '')) return null;

    return attempt;
  }

  return { create, consume };
}
