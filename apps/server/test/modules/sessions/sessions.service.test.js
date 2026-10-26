import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createSessionService, SessionUnavailableError } from '../../../src/modules/sessions/sessions.service.js';
import { createTestRedis, createUnreachableRedis } from '../../support/redis.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const LIFETIMES = {
  member: { idleMs: 24 * HOUR, absoluteMs: 7 * 24 * HOUR },
  admin: { idleMs: HOUR, absoluteMs: 12 * HOUR },
  anonymous: { idleMs: 2 * HOUR, absoluteMs: 2 * HOUR },
};

const member = { id: '11111111-1111-4111-8111-111111111111', role: 'user', sessionVersion: 1 };
const administrator = { id: '22222222-2222-4222-8222-222222222222', role: 'admin', sessionVersion: 1 };

describe('session service', () => {
  let redis;
  let now;

  before(async () => {
    redis = await createTestRedis();
  });

  after(async () => {
    await redis.cleanup();
  });

  function store() {
    now = Date.now();

    return createSessionService({ redis: redis.client, lifetimes: LIFETIMES, keyPrefix: redis.keyPrefix, clock: () => now });
  }

  async function keysInRedis() {
    const keys = [];

    for await (const batch of redis.client.scanIterator({ MATCH: `${redis.keyPrefix}session:*` })) {
      keys.push(...batch);
    }

    return keys;
  }

  test('creates an anonymous session with a CSRF token and finds it by token', async () => {
    const sessions = store();
    const { token, session } = await sessions.create();

    assert.equal(session.userId, null);
    assert.ok(session.csrfToken.length >= 43);
    assert.deepEqual(await sessions.get(token), session);
  });

  test('stores only a hash of the token, with a TTL no longer than the idle limit', async () => {
    const sessions = store();
    const { token } = await sessions.rotate(null, member);

    const keys = await keysInRedis();

    assert.equal(keys.some((key) => key.includes(token)), false, 'raw token must not appear in Redis');

    for (const key of keys) {
      const ttl = await redis.client.pTTL(key);

      assert.ok(ttl > 0 && ttl <= 24 * HOUR, `${key} ttl ${ttl}`);
    }
  });

  test('unknown, empty and oversized tokens return null', async () => {
    const sessions = store();

    for (const token of ['does-not-exist', '', 'x'.repeat(129), undefined]) {
      assert.equal(await sessions.get(token), null);
    }
  });

  test('expires after the idle limit without activity', async () => {
    const sessions = store();
    const { token } = await sessions.rotate(null, member);

    now += 24 * HOUR + 1;

    assert.equal(await sessions.get(token), null);
  });

  test('activity extends the idle limit, but never past the absolute limit', async () => {
    const sessions = store();
    const { token } = await sessions.rotate(null, member);

    // Visit every 20 hours: each visit is within the 24-hour idle window.
    for (let day = 1; day <= 8; day += 1) {
      now += 20 * HOUR;

      const session = await sessions.get(token);
      const beyondAbsolute = day * 20 * HOUR >= 7 * 24 * HOUR;

      assert.equal(session === null, beyondAbsolute, `after ${day * 20} hours`);

      if (session === null) break;
    }
  });

  test('admin sessions use the shorter admin limits', async () => {
    const sessions = store();
    const { token } = await sessions.rotate(null, administrator);

    now += HOUR + 1;

    assert.equal(await sessions.get(token), null);
  });

  test('rotate invalidates the old token and issues a new one (no session fixation)', async () => {
    const sessions = store();
    const anonymous = await sessions.create();
    const signedIn = await sessions.rotate(anonymous.token, member);

    assert.notEqual(signedIn.token, anonymous.token);
    assert.notEqual(signedIn.session.csrfToken, anonymous.session.csrfToken);
    assert.equal(await sessions.get(anonymous.token), null);
    assert.equal((await sessions.get(signedIn.token)).userId, member.id);
  });

  test('destroy removes the session, and a later touch cannot bring it back', async () => {
    const sessions = store();
    const { token } = await sessions.rotate(null, member);
    const loaded = await sessions.get(token);

    await sessions.destroy(token);

    now += 2 * MINUTE;

    assert.equal(await sessions.markRecentAuth(token, loaded), false);
    assert.equal(await sessions.get(token), null);
  });

  test('markRecentAuth records a fresh authentication time', async () => {
    const sessions = store();
    const { token, session } = await sessions.rotate(null, member);

    now += 30 * MINUTE;

    await sessions.markRecentAuth(token, session);

    assert.equal((await sessions.get(token)).recentAuthAt, now);
  });

  test('Redis failures surface as SessionUnavailableError, never as "no session"', async () => {
    const down = createUnreachableRedis();

    try {
      const sessions = createSessionService({ redis: down, lifetimes: LIFETIMES });

      await assert.rejects(sessions.get('some-token'), SessionUnavailableError);
      await assert.rejects(sessions.create(), SessionUnavailableError);
      await assert.rejects(sessions.destroy('some-token'), SessionUnavailableError);
    } finally {
      down.destroy();
    }
  });
});
