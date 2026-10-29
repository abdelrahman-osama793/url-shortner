import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { createRedisClient } from '../../../src/infra/redis.js';
import { CLICK_STREAM } from '../../../src/modules/analytics/click-capture.service.js';
import { CONSUMER_GROUP, createClickConsumer } from '../../../src/modules/analytics/click-consumer.service.js';
import { CAPTURE_LOSS_KEY, createPipelineReporter, createPipelineStatusReader } from '../../../src/modules/analytics/pipeline-health.service.js';
import { createMigratedDatabase } from '../../support/database.js';
import { createTestRedis, createUnreachableRedis, testRedisUrl } from '../../support/redis.js';

let database;
let redis;
let blocking;

before(async () => {
  database = await createMigratedDatabase();
  redis = await createTestRedis();
  blocking = createRedisClient({ url: testRedisUrl(), commandTimeoutMs: 5000 });
  await blocking.connect();
});

after(async () => {
  blocking.destroy();
  await redis.cleanup();
  await database.drop();
});

function consumerFor(keyPrefix, overrides = {}) {
  return createClickConsumer({
    redis: redis.client,
    blockingRedis: blocking,
    aggregator: { persist: async (events) => ({ inserted: events.length, duplicates: 0 }) },
    keyPrefix,
    blockMs: 50,
    minIdleMs: 60_000,
    ...overrides,
  });
}

function setup() {
  const keyPrefix = `${redis.keyPrefix}${randomUUID().slice(0, 8)}:`;
  const name = `worker-${randomUUID().slice(0, 8)}`;

  return { keyPrefix, name, stream: `${keyPrefix}${CLICK_STREAM}` };
}

async function setWorkerState(name, { heartbeatAgoMs, oldestPendingAgoMs = null, status = 'healthy' }) {
  await database.pool.query(
    `INSERT INTO worker_state (name, heartbeat_at, oldest_pending_at, status)
     VALUES ($1, now() - make_interval(secs => $2), CASE WHEN $3::float IS NULL THEN NULL ELSE now() - make_interval(secs => $3) END, $4)
     ON CONFLICT (name) DO UPDATE SET heartbeat_at = EXCLUDED.heartbeat_at, oldest_pending_at = EXCLUDED.oldest_pending_at, status = EXCLUDED.status`,
    [name, heartbeatAgoMs / 1000, oldestPendingAgoMs === null ? null : oldestPendingAgoMs / 1000, status],
  );
}

describe('pipeline status', () => {
  function reader(name, extra = {}) {
    return createPipelineStatusReader({ pool: database.pool, redis: redis.client, keyPrefix: extra.keyPrefix ?? '', name, ...extra });
  }

  test('no heartbeat at all is unknown, never healthy', async () => {
    const { name } = setup();

    assert.deepEqual(await reader(name).getPipelineStatus(), { status: 'unknown', heartbeatAt: null, oldestPendingAt: null });
  });

  test('a stale heartbeat (worker stopped) is unknown', async () => {
    const { name } = setup();

    await setWorkerState(name, { heartbeatAgoMs: 45_000 });

    const status = await reader(name).getPipelineStatus();

    assert.equal(status.status, 'unknown');
    assert.ok(status.heartbeatAt, 'the last heartbeat time is still reported');
  });

  test('a fresh heartbeat with nothing waiting is healthy', async () => {
    const { name } = setup();

    await setWorkerState(name, { heartbeatAgoMs: 1000 });

    assert.equal((await reader(name).getPipelineStatus()).status, 'healthy');
  });

  test('events waiting longer than the freshness target are delayed', async () => {
    const { name } = setup();

    await setWorkerState(name, { heartbeatAgoMs: 1000, oldestPendingAgoMs: 15_000 });

    const status = await reader(name).getPipelineStatus();

    assert.equal(status.status, 'delayed');
    assert.ok(status.oldestPendingAt);
  });

  test('a failing worker pass is degraded', async () => {
    const { name } = setup();

    await setWorkerState(name, { heartbeatAgoMs: 1000, status: 'degraded' });

    assert.equal((await reader(name).getPipelineStatus()).status, 'degraded');
  });

  test('recent capture losses are degraded even when the worker looks perfect', async () => {
    const { name, keyPrefix } = setup();

    await setWorkerState(name, { heartbeatAgoMs: 1000 });

    const localLoss = { snapshot: () => ({ lastLossAt: Date.now() - 1000 }) };

    assert.equal((await reader(name, { clickCapture: localLoss }).getPipelineStatus()).status, 'degraded', 'this instance lost events');

    await redis.client.set(`${keyPrefix}${CAPTURE_LOSS_KEY}`, String(Date.now() - 1000));

    assert.equal((await reader(name, { keyPrefix }).getPipelineStatus()).status, 'degraded', 'another instance lost events');

    const oldLoss = { snapshot: () => ({ lastLossAt: Date.now() - 10 * 60_000 }) };
    const fresh = setup();

    await setWorkerState(fresh.name, { heartbeatAgoMs: 1000 });

    assert.equal((await reader(fresh.name, { clickCapture: oldLoss }).getPipelineStatus()).status, 'healthy', 'old losses age out');
  });
});

describe('heartbeat reporter', () => {
  test('writes the heartbeat, last commit and the age of the oldest waiting event', async () => {
    const { keyPrefix, name, stream } = setup();
    const consumer = consumerFor(keyPrefix);

    await consumer.ensureGroup();
    await redis.client.xAdd(stream, '*', { v: '1' });

    await createPipelineReporter({ pool: database.pool, consumer, name }).reportOnce();

    const { rows } = await database.pool.query('SELECT heartbeat_at, oldest_pending_at, status FROM worker_state WHERE name = $1', [name]);

    assert.ok(Date.now() - rows[0].heartbeat_at.getTime() < 5000);
    assert.ok(rows[0].oldest_pending_at, 'the waiting event is reported');
    assert.equal(rows[0].status, 'healthy');
  });

  test('reports degraded when Redis cannot be read', async () => {
    const { keyPrefix, name } = setup();
    const down = createUnreachableRedis();

    try {
      await createPipelineReporter({ pool: database.pool, consumer: consumerFor(keyPrefix, { redis: down }), name }).reportOnce();

      const { rows } = await database.pool.query('SELECT status FROM worker_state WHERE name = $1', [name]);

      assert.equal(rows[0].status, 'degraded');
    } finally {
      down.destroy();
    }
  });
});

describe('stream janitor', () => {
  test('trims processed leftovers but never pending or unread entries', async () => {
    const { keyPrefix, stream } = setup();
    const consumer = consumerFor(keyPrefix);

    await consumer.ensureGroup();

    const ids = [];

    for (let i = 0; i < 5; i += 1) ids.push(await redis.client.xAdd(stream, '*', { n: String(i) }));

    // Read four: acknowledge the first two without deleting them (a crash between XACK and XDEL),
    // leave the next two pending; the fifth is never read.
    await blocking.xReadGroup(CONSUMER_GROUP, 'reader', { key: stream, id: '>' }, { COUNT: 4 });
    await redis.client.xAck(stream, CONSUMER_GROUP, ids.slice(0, 2));

    assert.equal(await consumer.trimProcessed(), 2);

    const remaining = (await redis.client.xRange(stream, '-', '+')).map((entry) => entry.id);

    assert.deepEqual(remaining, ids.slice(2), 'pending and unread entries remain');
  });
});
