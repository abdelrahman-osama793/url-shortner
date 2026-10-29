import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { TimeoutError } from 'redis';

import { CLICK_STREAM, createClickCaptureService } from '../../../src/modules/analytics/click-capture.service.js';
import { createTestRedis, createUnreachableRedis } from '../../support/redis.js';

const CHROME_ON_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

function click(headers = {}) {
  return { linkId: randomUUID(), linkVersion: 3, headers: { userAgent: CHROME_ON_WINDOWS, ...headers } };
}

// A stand-in Redis whose eval behaves as given; withCommandOptions returns the same object.
function fakeRedis(evalImpl) {
  const fake = { calls: 0, withCommandOptions: () => fake };

  fake.eval = async (...args) => {
    fake.calls += 1;
    return evalImpl(...args);
  };

  return fake;
}

describe('click capture', () => {
  let redis;

  before(async () => {
    redis = await createTestRedis();
  });

  after(async () => {
    await redis.cleanup();
  });

  // Each test gets its own stream so counts never mix.
  function service(options = {}) {
    const keyPrefix = `${redis.keyPrefix}${randomUUID().slice(0, 8)}:`;

    return { keyPrefix, capture: createClickCaptureService({ redis: redis.client, keyPrefix, ...options }) };
  }

  async function streamEntries(keyPrefix) {
    return redis.client.xRange(`${keyPrefix}${CLICK_STREAM}`, '-', '+');
  }

  test('publishes one compact event with coarse dimensions only', async () => {
    const { keyPrefix, capture } = service();
    const event = click({
      referer: 'https://news.example.com/story/42?secret=token',
      country: 'eg',
    });

    assert.equal(await capture.capture(event), 'captured');

    const [entry] = await streamEntries(keyPrefix);

    assert.deepEqual(Object.keys(entry.message).sort(), ['b', 'c', 'd', 'e', 'l', 'lv', 'r', 't', 'v']);
    assert.equal(entry.message.l, event.linkId);
    assert.equal(entry.message.lv, '3');
    assert.equal(entry.message.d, 'desktop');
    assert.equal(entry.message.r, 'news.example.com');
    assert.equal(entry.message.c, 'EG');
    assert.equal(entry.message.b, '0');
    assert.match(entry.message.e, /^[0-9a-f-]{36}$/);
    assert.ok(Math.abs(Number(entry.message.t) - Date.now()) < 5000);

    const serialized = JSON.stringify(entry);

    for (const leak of ['secret=token', '/story/42', 'Chrome/130', 'Windows NT']) {
      assert.equal(serialized.includes(leak), false, leak);
    }
  });

  test('each event gets its own id', async () => {
    const { keyPrefix, capture } = service();

    await capture.capture(click());
    await capture.capture(click());

    const ids = (await streamEntries(keyPrefix)).map((entry) => entry.message.e);

    assert.equal(new Set(ids).size, 2);
  });

  test('prefetches are not visits', async () => {
    const { keyPrefix, capture } = service();

    for (const headers of [{ secPurpose: 'prefetch' }, { purpose: 'prefetch' }, { xMoz: 'prefetch' }, { secPurpose: 'prefetch;prerender' }]) {
      assert.equal(await capture.capture(click(headers)), 'prefetch');
    }

    assert.equal((await streamEntries(keyPrefix)).length, 0);
    assert.equal(capture.snapshot().skipped.prefetch, 4);
  });

  test('a full queue refuses new events and never evicts queued ones', async () => {
    const { keyPrefix, capture } = service({ queueCap: 3 });
    const outcomes = [];

    for (let i = 0; i < 5; i += 1) outcomes.push(await capture.capture(click()));

    assert.deepEqual(outcomes, ['captured', 'captured', 'captured', 'queue_full', 'queue_full']);
    assert.equal((await streamEntries(keyPrefix)).length, 3);
    assert.equal(capture.snapshot().dropped.queue_full, 2);
  });

  test('concurrent publishes cannot overfill the queue', async () => {
    const { keyPrefix, capture } = service({ queueCap: 10 });

    const outcomes = await Promise.all(Array.from({ length: 50 }, () => capture.capture(click())));

    assert.equal(outcomes.filter((outcome) => outcome === 'captured').length, 10);
    assert.equal((await streamEntries(keyPrefix)).length, 10);
  });

  test('a Redis outage drops events quickly, then the circuit opens and stops trying', async () => {
    const down = createUnreachableRedis();

    try {
      const capture = createClickCaptureService({ redis: down, failureThreshold: 3, openMs: 60_000 });
      const startedAt = Date.now();
      const outcomes = [];

      for (let i = 0; i < 6; i += 1) outcomes.push(await capture.capture(click()));

      assert.ok(Date.now() - startedAt < 500, 'never waits on a dead Redis');
      assert.deepEqual(outcomes, ['redis_error', 'redis_error', 'redis_error', 'circuit_open', 'circuit_open', 'circuit_open']);
      assert.equal(capture.snapshot().circuitOpen, true);
      assert.ok(capture.snapshot().lastLossAt);
    } finally {
      down.destroy();
    }
  });

  test('after the open period the circuit lets a trial through and closes on success', async () => {
    let now = 0;
    let healthy = false;
    const flaky = fakeRedis(() => {
      if (!healthy) throw new Error('connection refused');
      return 1;
    });

    const capture = createClickCaptureService({ redis: flaky, failureThreshold: 1, openMs: 1000, clock: () => now });

    assert.equal(await capture.capture(click()), 'redis_error');
    assert.equal(await capture.capture(click()), 'circuit_open');
    assert.equal(flaky.calls, 1, 'no call while open');

    healthy = true;
    now = 1001;

    assert.equal(await capture.capture(click()), 'captured');
    assert.equal(capture.snapshot().circuitOpen, false);
  });

  test('timeouts are counted separately from other Redis errors', async () => {
    const slow = fakeRedis(() => {
      throw new TimeoutError();
    });

    const capture = createClickCaptureService({ redis: slow, failureThreshold: 100 });

    assert.equal(await capture.capture(click()), 'timeout');
    assert.equal(capture.snapshot().dropped.timeout, 1);
    assert.equal(capture.snapshot().dropped.redis_error, 0);
  });

  test('a stalled Redis cannot pile up unbounded publishes', async () => {
    const stop = new AbortController();
    const stalled = fakeRedis(async () => {
      await sleep(60_000, undefined, { signal: stop.signal }).catch(() => {});
      return 1;
    });

    const capture = createClickCaptureService({ redis: stalled, maxInFlight: 5 });
    const pending = Array.from({ length: 5 }, () => capture.capture(click()));

    assert.equal(await capture.capture(click()), 'overloaded', 'the sixth is dropped immediately');
    assert.equal(capture.snapshot().inFlight, 5);

    stop.abort();
    await Promise.all(pending);

    assert.equal(capture.snapshot().inFlight, 0);
  });
});
