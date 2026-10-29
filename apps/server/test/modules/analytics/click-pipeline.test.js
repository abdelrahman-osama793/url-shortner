import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { createRedisClient } from '../../../src/infra/redis.js';
import { createPool } from '../../../src/infra/postgres.js';
import { createClickAggregator } from '../../../src/modules/analytics/click-aggregation.service.js';
import { CLICK_STREAM, createClickCaptureService } from '../../../src/modules/analytics/click-capture.service.js';
import { CONSUMER_GROUP, createClickConsumer, DEAD_LETTER_STREAM } from '../../../src/modules/analytics/click-consumer.service.js';
import { createMigratedDatabase } from '../../support/database.js';
import { createTestRedis, testRedisUrl } from '../../support/redis.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148';

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

// Each test gets its own stream (key prefix), so pending lists never mix between tests.
function pipeline({ pool = database.pool, referrerCap, afterCommit, consumerName = `consumer-${randomUUID().slice(0, 6)}`, keyPrefix } = {}) {
  const prefix = keyPrefix ?? `${redis.keyPrefix}${randomUUID().slice(0, 8)}:`;

  return {
    keyPrefix: prefix,
    capture: createClickCaptureService({ redis: redis.client, keyPrefix: prefix }),
    consumer: createClickConsumer({
      redis: redis.client,
      blockingRedis: blocking,
      aggregator: createClickAggregator({ pool, referrerCap }),
      keyPrefix: prefix,
      consumerName,
      blockMs: 50,
      minIdleMs: 0,
      afterCommit,
    }),
  };
}

async function newLink() {
  const { rows } = await database.pool.query(
    `INSERT INTO links (code, destination_url, created_at, expires_at)
     VALUES ($1, 'https://example.com', now(), now() + interval '168 hours') RETURNING id`,
    [`p${randomUUID().slice(0, 10)}`],
  );

  return rows[0].id;
}

async function clicks(capture, linkId, count, headers = {}) {
  for (let i = 0; i < count; i += 1) {
    await capture.capture({ linkId, linkVersion: 1, headers: { userAgent: CHROME, ...headers } });
  }
}

// Raw entry, for events the capture service would never produce (old, malformed, unknown link).
function rawEvent(overrides = {}) {
  return {
    v: '1',
    e: randomUUID(),
    l: randomUUID(),
    lv: '1',
    t: String(Date.now()),
    c: 'unknown',
    d: 'desktop',
    r: 'direct_or_unknown',
    b: '0',
    ...overrides,
  };
}

async function drain(consumer) {
  await consumer.ensureGroup();

  while ((await consumer.processOnce()) > 0) {
    // keep going until the stream is empty
  }
}

async function totalFor(linkId) {
  const { rows } = await database.pool.query('SELECT clicks FROM link_totals WHERE link_id = $1', [linkId]);

  return rows[0] ? Number(rows[0].clicks) : 0;
}

async function daily(linkId) {
  const { rows } = await database.pool.query(
    'SELECT day::text, dimension, bucket, clicks::int FROM daily_metrics WHERE link_id = $1 ORDER BY day, dimension, bucket',
    [linkId],
  );

  return rows;
}

async function streamState(keyPrefix) {
  const key = `${keyPrefix}${CLICK_STREAM}`;
  const pending = await redis.client.xPending(key, CONSUMER_GROUP);

  return { length: await redis.client.xLen(key), pending: pending.pending };
}

describe('click pipeline', () => {
  test('stores raw events, daily buckets per dimension and lifetime totals, then empties the stream', async () => {
    const { capture, consumer, keyPrefix } = pipeline();
    const linkId = await newLink();

    await clicks(capture, linkId, 3, { referer: 'https://news.example/a', country: 'EG' });
    await clicks(capture, linkId, 2, { userAgent: IPHONE });
    await drain(consumer);

    const today = new Date().toISOString().slice(0, 10);
    const { rows: raw } = await database.pool.query('SELECT count(*)::int AS n FROM click_events WHERE link_id = $1', [linkId]);

    assert.equal(raw[0].n, 5);
    assert.equal(await totalFor(linkId), 5);
    assert.deepEqual(await daily(linkId), [
      { day: today, dimension: 'country', bucket: 'EG', clicks: 3 },
      { day: today, dimension: 'country', bucket: 'unknown', clicks: 2 },
      { day: today, dimension: 'device', bucket: 'desktop', clicks: 3 },
      { day: today, dimension: 'device', bucket: 'mobile', clicks: 2 },
      { day: today, dimension: 'referrer', bucket: 'direct_or_unknown', clicks: 2 },
      { day: today, dimension: 'referrer', bucket: 'news.example', clicks: 3 },
      { day: today, dimension: 'total', bucket: 'all', clicks: 5 },
    ]);
    assert.deepEqual(await streamState(keyPrefix), { length: 0, pending: 0 }, 'acknowledged and deleted');
  });

  test('a crash after commit but before acknowledgement does not double-count on recovery', async () => {
    const keyPrefix = `${redis.keyPrefix}${randomUUID().slice(0, 8)}:`;
    const crash = new Error('simulated crash after commit');
    const doomed = pipeline({ keyPrefix, afterCommit: () => { throw crash; } });
    const linkId = await newLink();

    await clicks(doomed.capture, linkId, 4);
    await doomed.consumer.ensureGroup();

    await assert.rejects(doomed.consumer.processOnce(), (error) => error === crash);

    assert.equal(await totalFor(linkId), 4, 'the transaction committed');
    assert.deepEqual(await streamState(keyPrefix), { length: 4, pending: 4 }, 'but nothing was acknowledged');

    // A new worker (a restart) reclaims the abandoned entries.
    const recovered = pipeline({ keyPrefix });

    await drain(recovered.consumer);

    assert.equal(await totalFor(linkId), 4, 'still 4: replayed events were recognised');
    assert.equal(recovered.consumer.snapshot().duplicates, 4);
    assert.deepEqual(await streamState(keyPrefix), { length: 0, pending: 0 });
  });

  test('a database outage leaves the work recoverable; nothing is lost or acknowledged', async () => {
    const keyPrefix = `${redis.keyPrefix}${randomUUID().slice(0, 8)}:`;
    const deadPool = createPool({ databaseUrl: 'postgres://user:secret@127.0.0.1:1/none', timeoutMs: 300 });
    const linkId = await newLink();

    try {
      const outage = pipeline({ keyPrefix, pool: deadPool });

      await clicks(outage.capture, linkId, 3);
      await outage.consumer.ensureGroup();
      await assert.rejects(outage.consumer.processOnce());

      assert.deepEqual(await streamState(keyPrefix), { length: 3, pending: 3 });
    } finally {
      await deadPool.end();
    }

    await drain(pipeline({ keyPrefix }).consumer);

    assert.equal(await totalFor(linkId), 3);
  });

  test('the same event delivered twice is counted once', async () => {
    const { consumer, keyPrefix } = pipeline();
    const linkId = await newLink();
    const event = rawEvent({ l: linkId });

    await redis.client.xAdd(`${keyPrefix}${CLICK_STREAM}`, '*', event);
    await redis.client.xAdd(`${keyPrefix}${CLICK_STREAM}`, '*', event);
    await drain(consumer);

    assert.equal(await totalFor(linkId), 1);
  });

  test('malformed entries and unknown links go to the dead-letter stream without blocking good events', async () => {
    const { consumer, keyPrefix } = pipeline();
    const linkId = await newLink();
    const stream = `${keyPrefix}${CLICK_STREAM}`;

    await redis.client.xAdd(stream, '*', rawEvent({ l: linkId }));
    await redis.client.xAdd(stream, '*', { garbage: 'yes' });
    await redis.client.xAdd(stream, '*', rawEvent({ d: 'smartwatch' }));
    await redis.client.xAdd(stream, '*', rawEvent({ l: randomUUID() }));
    await redis.client.xAdd(stream, '*', rawEvent({ l: linkId }));
    await drain(consumer);

    const dead = await redis.client.xRange(`${keyPrefix}${DEAD_LETTER_STREAM}`, '-', '+');

    assert.equal(await totalFor(linkId), 2, 'both good events counted');
    assert.deepEqual(dead.map((entry) => entry.message.reason).sort(), ['bad_device', 'rejected_by_database', 'unknown_version']);
    assert.deepEqual(await streamState(keyPrefix), { length: 0, pending: 0 });
  });

  test('events older than the 30-day raw retention are dropped and counted, not stored', async () => {
    const { consumer, keyPrefix } = pipeline();
    const linkId = await newLink();

    await redis.client.xAdd(`${keyPrefix}${CLICK_STREAM}`, '*', rawEvent({ l: linkId, t: String(Date.now() - 31 * DAY_MS) }));
    await drain(consumer);

    assert.equal(await totalFor(linkId), 0);
    assert.equal(consumer.snapshot().expired, 1);
  });

  test('the UTC date of the click decides its day, not the processing date', async () => {
    const { consumer, keyPrefix } = pipeline();
    const linkId = await newLink();
    const midnight = Date.UTC(2026, 9, 28);

    await redis.client.xAdd(`${keyPrefix}${CLICK_STREAM}`, '*', rawEvent({ l: linkId, t: String(midnight - 1) }));
    await redis.client.xAdd(`${keyPrefix}${CLICK_STREAM}`, '*', rawEvent({ l: linkId, t: String(midnight) }));
    await drain(consumer);

    const totals = (await daily(linkId)).filter((row) => row.dimension === 'total');

    assert.deepEqual(totals.map((row) => [row.day, row.clicks]), [['2026-10-27', 1], ['2026-10-28', 1]]);
  });

  test('at most N referring hosts get their own bucket per link and day; the rest become "other"', async () => {
    const { capture, consumer } = pipeline({ referrerCap: 3 });
    const linkId = await newLink();

    for (const host of ['a.example', 'b.example', 'c.example', 'd.example', 'e.example', 'a.example']) {
      await clicks(capture, linkId, 1, { referer: `https://${host}/` });
    }

    await clicks(capture, linkId, 1);
    await drain(consumer);

    const referrers = Object.fromEntries((await daily(linkId)).filter((row) => row.dimension === 'referrer').map((row) => [row.bucket, row.clicks]));

    assert.deepEqual(referrers, { 'a.example': 2, 'b.example': 1, 'c.example': 1, other: 2, direct_or_unknown: 1 });
  });

  test('two workers in parallel count every event exactly once, and every dimension adds up', async () => {
    const keyPrefix = `${redis.keyPrefix}${randomUUID().slice(0, 8)}:`;
    const first = pipeline({ keyPrefix, referrerCap: 5 });
    const second = pipeline({ keyPrefix, referrerCap: 5 });
    const links = [await newLink(), await newLink()];
    const hosts = ['a.example', 'b.example', 'c.example', 'd.example', 'e.example', 'f.example', 'g.example'];

    for (let i = 0; i < 200; i += 1) {
      await first.capture.capture({
        linkId: links[i % 2],
        linkVersion: 1,
        headers: { userAgent: i % 3 ? CHROME : IPHONE, referer: `https://${hosts[i % hosts.length]}/`, country: i % 4 ? 'EG' : 'DE' },
      });
    }

    await first.consumer.ensureGroup();
    await Promise.all([drain(first.consumer), drain(second.consumer)]);

    for (const linkId of links) {
      assert.equal(await totalFor(linkId), 100);

      const sums = {};

      for (const row of await daily(linkId)) sums[row.dimension] = (sums[row.dimension] ?? 0) + row.clicks;

      assert.deepEqual(sums, { total: 100, country: 100, device: 100, referrer: 100 }, 'dimensions reconcile');

      const referrerBuckets = (await daily(linkId)).filter((row) => row.dimension === 'referrer' && row.bucket !== 'other');

      assert.ok(referrerBuckets.length <= 5, `cap held under concurrency: ${referrerBuckets.length}`);
    }
  });
});
