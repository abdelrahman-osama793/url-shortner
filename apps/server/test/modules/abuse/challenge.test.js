import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { ChallengeUnavailableError, createChallengeGuard, createDevChallengeVerifier } from '../../../src/modules/abuse/challenge.js';
import { createTestRedis, createUnreachableRedis } from '../../support/redis.js';

const SECRET = 'challenge-test-secret-32-characters!!';

describe('development challenge verifier', () => {
  test('accepts its own unexpired tokens and reports their action', async () => {
    const verifier = createDevChallengeVerifier({ secret: SECRET });

    assert.deepEqual(await verifier.verify(verifier.issue('guest-create')), { valid: true, action: 'guest-create' });
  });

  test('rejects tampered, foreign, malformed and expired tokens', async () => {
    let now = Date.now();
    const verifier = createDevChallengeVerifier({ secret: SECRET, clock: () => now });
    const otherSecret = createDevChallengeVerifier({ secret: `${SECRET}-other` });
    const token = verifier.issue('guest-create');
    const [payload, signature] = token.split('.');

    const forgedPayload = Buffer.from(JSON.stringify({ action: 'admin', expiresAt: now + 60_000, nonce: 'x' })).toString('base64url');

    for (const bad of [`${forgedPayload}.${signature}`, `${payload}.${signature}x`, otherSecret.issue('guest-create'), 'garbage', '', `${token}.extra`]) {
      assert.deepEqual(await verifier.verify(bad), { valid: false }, bad);
    }

    now += 5 * 60 * 1000 + 1;

    assert.deepEqual(await verifier.verify(token), { valid: false }, 'expired');
  });
});

describe('challenge guard', () => {
  let redis;
  let verifier;
  let guard;

  before(async () => {
    redis = await createTestRedis();
    verifier = createDevChallengeVerifier({ secret: SECRET });
    guard = createChallengeGuard({ redis: redis.client, verifier, keyPrefix: redis.keyPrefix });
  });

  after(async () => {
    await redis.cleanup();
  });

  test('accepts a valid token once only', async () => {
    const token = verifier.issue('guest-create');

    assert.equal(await guard.check(token, { action: 'guest-create' }), true);
    assert.equal(await guard.check(token, { action: 'guest-create' }), false, 'replay must fail');
  });

  test('rejects a token issued for a different action', async () => {
    const token = verifier.issue('report');

    assert.equal(await guard.check(token, { action: 'guest-create' }), false);
  });

  test('a token rejected for the wrong action is not consumed', async () => {
    const token = verifier.issue('report');

    await guard.check(token, { action: 'guest-create' });

    assert.equal(await guard.check(token, { action: 'report' }), true);
  });

  test('concurrent use of one token succeeds exactly once', async () => {
    const token = verifier.issue('guest-create');

    const results = await Promise.all(Array.from({ length: 10 }, () => guard.check(token, { action: 'guest-create' })));

    assert.equal(results.filter(Boolean).length, 1);
  });

  test('rejects missing, non-string and oversized tokens without contacting Redis', async () => {
    for (const bad of [undefined, null, 42, '', 'x'.repeat(4097)]) {
      assert.equal(await guard.check(bad, { action: 'guest-create' }), false);
    }
  });

  test('reports ChallengeUnavailableError when Redis cannot record the use', async () => {
    const down = createUnreachableRedis();

    try {
      const offlineGuard = createChallengeGuard({ redis: down, verifier });

      await assert.rejects(offlineGuard.check(verifier.issue('guest-create'), { action: 'guest-create' }), ChallengeUnavailableError);
    } finally {
      down.destroy();
    }
  });
});
