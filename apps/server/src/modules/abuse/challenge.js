import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Human-verification challenges for suspicious guests (decision D13).
//
// A verifier checks a token with its provider and reports which action it was issued for.
// The guard adds rules that hold for every provider:
//   * the token must have been issued for the exact action being performed;
//   * each token works once (recorded in Redis), so it cannot be replayed;
//   * passing a challenge never resets or bypasses rate limits (callers check limits first).
//
// Only a development verifier exists so far. The real provider is chosen in T36 and wired in
// T37; until then production configuration refuses to start (see config.js).

const DEV_TOKEN_LIFETIME_MS = 5 * 60 * 1000;

export class ChallengeUnavailableError extends Error {
  constructor(cause) {
    super('challenge verification is unavailable', { cause });
    this.name = 'ChallengeUnavailableError';
  }
}

function sign(key, payload) {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

function signaturesMatch(expected, actual) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);

  return a.length === b.length && timingSafeEqual(a, b);
}

// Development stand-in for a real provider. Tokens are HMAC-signed { action, expiresAt,
// nonce } values issued by a development-only endpoint. Never enabled in production.
export function createDevChallengeVerifier({ secret, clock = () => Date.now() }) {
  const key = createHmac('sha256', secret).update('dev-challenge-v1').digest();

  function issue(action) {
    const payload = Buffer.from(JSON.stringify({
      action,
      expiresAt: clock() + DEV_TOKEN_LIFETIME_MS,
      nonce: randomBytes(16).toString('base64url'),
    })).toString('base64url');

    return `${payload}.${sign(key, payload)}`;
  }

  // Returns { valid: true, action } or { valid: false }. Never throws on bad input.
  async function verify(token) {
    const [payload, signature, extra] = String(token).split('.');

    if (!payload || !signature || extra !== undefined) return { valid: false };
    if (!signaturesMatch(sign(key, payload), signature)) return { valid: false };

    try {
      const { action, expiresAt } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

      if (typeof action !== 'string' || !(expiresAt > clock())) return { valid: false };

      return { valid: true, action };
    } catch {
      return { valid: false };
    }
  }

  return { issue, verify };
}

// Wraps any verifier with action binding and single use.
export function createChallengeGuard({ redis, verifier, keyPrefix = '', replayWindowMs = 15 * 60 * 1000 }) {
  // Returns true only for a valid, unused token issued for `action`.
  // Throws ChallengeUnavailableError when Redis cannot record the use.
  async function check(token, { action }) {
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return false;

    const result = await verifier.verify(token, { action });

    if (!result.valid || result.action !== action) return false;

    const usedKey = `${keyPrefix}challenge-used:${createHash('sha256').update(token).digest('base64url')}`;

    try {
      const firstUse = await redis.set(usedKey, '1', { condition: 'NX', expiration: { type: 'PX', value: replayWindowMs } });

      return firstUse === 'OK';
    } catch (error) {
      throw new ChallengeUnavailableError(error);
    }
  }

  return { check };
}
