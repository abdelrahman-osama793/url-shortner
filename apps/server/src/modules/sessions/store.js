import { createHash, randomBytes } from 'node:crypto';

// Server-side sessions in Redis (technical-design §4, "Sign in"; database-schema.md, Redis).
//
//   * The browser holds an opaque 256-bit token. Redis stores the session under a SHA-256
//     hash of it, so a Redis dump cannot be replayed as a cookie.
//   * A session is either anonymous (pre-login: CSRF binding only) or belongs to a user.
//   * Each session has an idle and an absolute expiry. The Redis TTL is the sooner of the
//     two, so expired sessions disappear without any cleanup job.
//   * Account status and session version are NOT trusted from here: protected requests
//     re-check them in PostgreSQL (see http/middleware/session.js).

const TOUCH_INTERVAL_MS = 60 * 1000;

export class SessionUnavailableError extends Error {
  constructor(cause) {
    super('session storage is unavailable', { cause });
    this.name = 'SessionUnavailableError';
  }
}

function newToken() {
  return randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('base64url');
}

export function createSessionStore({ redis, lifetimes, keyPrefix = '', clock = () => Date.now() }) {
  const keyFor = (token) => `${keyPrefix}session:${hashToken(token)}`;

  function lifetimeFor(session) {
    if (!session.userId) return lifetimes.anonymous;

    return session.role === 'admin' ? lifetimes.admin : lifetimes.member;
  }

  // Milliseconds until the session must end, whichever expiry comes first.
  function remainingMs(session, now) {
    const idleEndsAt = session.lastSeenAt + lifetimeFor(session).idleMs;

    return Math.min(idleEndsAt, session.absoluteExpiresAt) - now;
  }

  async function redisCall(operation) {
    try {
      return await operation();
    } catch (error) {
      throw new SessionUnavailableError(error);
    }
  }

  async function write(token, session, { onlyIfExists = false } = {}) {
    const ttlMs = remainingMs(session, clock());

    if (ttlMs <= 0) return false;

    const options = { expiration: { type: 'PX', value: ttlMs } };

    if (onlyIfExists) options.condition = 'XX';

    const reply = await redisCall(() => redis.set(keyFor(token), JSON.stringify(session), options));

    return reply === 'OK';
  }

  // Creates a session and returns { token, session }. The token goes into the cookie only.
  async function create({ userId = null, role = null, sessionVersion = null } = {}) {
    const now = clock();
    const token = newToken();

    const session = {
      userId,
      role,
      sessionVersion,
      csrfToken: newToken(),
      createdAt: now,
      lastSeenAt: now,
      recentAuthAt: userId ? now : null,
      absoluteExpiresAt: now + lifetimeFor({ userId, role }).absoluteMs,
    };

    await write(token, session);

    return { token, session };
  }

  // Returns the session, or null when it does not exist or has expired.
  // Refreshes the idle expiry at most once a minute to limit Redis writes.
  async function get(token) {
    if (typeof token !== 'string' || token.length === 0 || token.length > 128) return null;

    const raw = await redisCall(() => redis.get(keyFor(token)));

    if (!raw) return null;

    const session = JSON.parse(raw);
    const now = clock();

    if (remainingMs(session, now) <= 0) {
      await destroy(token);
      return null;
    }

    if (now - session.lastSeenAt >= TOUCH_INTERVAL_MS) {
      session.lastSeenAt = now;

      // XX: never resurrect a session that was destroyed (e.g. by logout) in the meantime.
      await write(token, session, { onlyIfExists: true });
    }

    return session;
  }

  async function destroy(token) {
    if (typeof token !== 'string' || token.length === 0) return;

    await redisCall(() => redis.del(keyFor(token)));
  }

  // Replaces any existing session with a new one for this user. A new token on every sign-in
  // prevents session fixation: a token planted before login is useless afterwards.
  async function rotate(oldToken, user) {
    if (oldToken) await destroy(oldToken);

    return create({ userId: user.id, role: user.role, sessionVersion: user.sessionVersion });
  }

  // Records a fresh password or Google proof, for actions that need recent authentication.
  async function markRecentAuth(token, session) {
    const updated = { ...session, recentAuthAt: clock() };

    return write(token, updated, { onlyIfExists: true });
  }

  return { create, get, destroy, rotate, markRecentAuth };
}
