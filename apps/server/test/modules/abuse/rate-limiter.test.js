import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createRateLimiter, RateLimitUnavailableError } from '../../../src/modules/abuse/rate-limiter.js';
import { createTestRedis, createUnreachableRedis } from '../../support/redis.js';

const SECRET = 'rate-limit-test-secret-32-characters!';

const POLICIES = {
  tight: [{ subject: 'network', limit: 3, windowSeconds: 60 }],
  layered: [
    { subject: 'network', limit: 5, windowSeconds: 60 },
    { subject: 'account', limit: 2, windowSeconds: 3600 },
  ],
  everyone: [{ subject: 'global', limit: 2, windowSeconds: 60 }],
};

describe('rate limiter', () => {
  let redis;

  before(async () => {
    redis = await createTestRedis();
  });

  after(async () => {
    await redis.cleanup();
  });

  function limiter(client = redis.client) {
    return createRateLimiter({ redis: client, secret: SECRET, policies: POLICIES, keyPrefix: redis.keyPrefix });
  }

  async function consumeTimes(rateLimiter, times, policy, subjects) {
    const results = [];

    for (let i = 0; i < times; i += 1) {
      results.push(await rateLimiter.consume(policy, subjects));
    }

    return results;
  }

  test('allows requests up to the limit, then reports how long to wait', async () => {
    const results = await consumeTimes(limiter(), 4, 'tight', { network: 'ipv4:198.51.100.1' });

    assert.deepEqual(results.slice(0, 3).map((result) => result.allowed), [true, true, true]);
    assert.equal(results[3].allowed, false);
    assert.ok(results[3].retryAfterSeconds > 55 && results[3].retryAfterSeconds <= 60, `retryAfter=${results[3].retryAfterSeconds}`);
  });

  test('counts each subject separately', async () => {
    const rateLimiter = limiter();

    await consumeTimes(rateLimiter, 3, 'tight', { network: 'ipv4:198.51.100.2' });

    assert.equal((await rateLimiter.consume('tight', { network: 'ipv4:198.51.100.3' })).allowed, true);
  });

  test('applies every bucket and reports the longest wait', async () => {
    const rateLimiter = limiter();
    const subjects = { network: 'ipv4:198.51.100.4', account: 'person@example.com' };

    const results = await consumeTimes(rateLimiter, 3, 'layered', subjects);

    assert.deepEqual(results.map((result) => result.allowed), [true, true, false]);
    assert.ok(results[2].retryAfterSeconds > 3500, 'the hour-long account bucket decides the wait');
  });

  test('global buckets are shared by every caller', async () => {
    const rateLimiter = limiter();

    await rateLimiter.consume('everyone', {});
    await rateLimiter.consume('everyone', {});

    assert.equal((await rateLimiter.consume('everyone', {})).allowed, false);
  });

  test('separate limiter instances share one count, like separate API processes', async () => {
    const otherProcess = await createTestRedis();

    try {
      const first = limiter();
      const second = createRateLimiter({ redis: otherProcess.client, secret: SECRET, policies: POLICIES, keyPrefix: redis.keyPrefix });
      const subjects = { network: 'ipv4:198.51.100.5' };

      const outcomes = [
        (await first.consume('tight', subjects)).allowed,
        (await second.consume('tight', subjects)).allowed,
        (await first.consume('tight', subjects)).allowed,
        (await second.consume('tight', subjects)).allowed,
      ];

      assert.deepEqual(outcomes, [true, true, true, false]);
    } finally {
      otherProcess.client.destroy();
    }
  });

  test('stores hashed subjects with an expiry, never the raw IP or email', async () => {
    await limiter().consume('layered', { network: 'ipv4:198.51.100.6', account: 'secret-person@example.com' });

    const keys = [];

    for await (const batch of redis.client.scanIterator({ MATCH: `${redis.keyPrefix}rate:layered:*` })) {
      keys.push(...batch);
    }

    assert.ok(keys.length >= 2);

    for (const key of keys) {
      assert.equal(/198\.51\.100|secret-person/.test(key), false, key);
      assert.ok(await redis.client.pTTL(key) > 0, `${key} has no expiry`);
    }
  });

  test('concurrent requests cannot exceed the limit', async () => {
    const rateLimiter = limiter();
    const subjects = { network: 'ipv4:198.51.100.7' };

    const results = await Promise.all(Array.from({ length: 20 }, () => rateLimiter.consume('tight', subjects)));

    assert.equal(results.filter((result) => result.allowed).length, 3);
  });

  test('fails fast with RateLimitUnavailableError when Redis is down', async () => {
    const down = createUnreachableRedis();

    try {
      const startedAt = Date.now();

      await assert.rejects(limiter(down).consume('tight', { network: 'ipv4:198.51.100.8' }), RateLimitUnavailableError);
      assert.ok(Date.now() - startedAt < 1000, 'must not hang while Redis is down');
    } finally {
      down.destroy();
    }
  });

  test('rejects unknown policies and missing subjects as programming errors', async () => {
    await assert.rejects(limiter().consume('nope', {}), /unknown rate-limit policy/);
    await assert.rejects(limiter().consume('tight', {}), /needs a "network" subject/);
  });
});
