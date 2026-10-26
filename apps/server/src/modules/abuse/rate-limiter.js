import { createHmac } from 'node:crypto';

// Shared fixed-window counters in Redis, so every API instance enforces the same limits.
//
// Each bucket is one key: INCR it and, only if it has no expiry yet, set one for the window
// (PEXPIRE … NX). All buckets of a policy go in one MULTI, so a request is counted atomically
// in one round trip. The window starts at a subject's first request; a client can therefore
// send up to 2× the limit around a window boundary. This is the documented fixed-window
// trade-off (technical-design §6).
//
// Subjects are stored as HMAC hashes with a server secret: raw IPs and emails never reach
// Redis. Rotating the secret starts every counter afresh.

export class RateLimitUnavailableError extends Error {
  constructor(cause) {
    super('rate limiting is unavailable', { cause });
    this.name = 'RateLimitUnavailableError';
  }
}

export function createRateLimiter({ redis, secret, policies, keyPrefix = '' }) {
  function hashSubject(type, value) {
    return createHmac('sha256', secret).update(`${type}:${value}`).digest('base64url').slice(0, 22);
  }

  function bucketKey(policyName, index, bucket, subjects) {
    const value = bucket.subject === 'global' ? 'all' : subjects[bucket.subject];

    if (value === undefined || value === null) {
      throw new Error(`policy ${policyName} needs a "${bucket.subject}" subject`);
    }

    return `${keyPrefix}rate:${policyName}:${index}:${hashSubject(bucket.subject, value)}`;
  }

  // Counts one request against every bucket of the policy.
  // Returns { allowed, retryAfterSeconds }, where retryAfterSeconds is the longest wait among
  // the exceeded buckets (0 when allowed). Throws RateLimitUnavailableError if Redis fails.
  async function consume(policyName, subjects) {
    const buckets = policies[policyName];

    if (!buckets) throw new Error(`unknown rate-limit policy: ${policyName}`);

    const keys = buckets.map((bucket, index) => bucketKey(policyName, index, bucket, subjects));
    const transaction = redis.multi();

    keys.forEach((key, index) => {
      transaction.incr(key);
      transaction.pExpire(key, buckets[index].windowSeconds * 1000, 'NX');
      transaction.pTTL(key);
    });

    let replies;

    try {
      replies = await transaction.exec();
    } catch (error) {
      throw new RateLimitUnavailableError(error);
    }

    let retryAfterSeconds = 0;

    buckets.forEach((bucket, index) => {
      const count = Number(replies[index * 3]);
      const ttlMs = Number(replies[index * 3 + 2]);

      if (count > bucket.limit) {
        retryAfterSeconds = Math.max(retryAfterSeconds, Math.max(1, Math.ceil(ttlMs / 1000)));
      }
    });

    return { allowed: retryAfterSeconds === 0, retryAfterSeconds };
  }

  return { consume };
}
