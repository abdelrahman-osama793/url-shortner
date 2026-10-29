import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { LinkAnalyticsSchema } from '@shortlist/contracts';

import { createRedisClient } from '../../src/infra/redis.js';
import { createClickAggregator } from '../../src/modules/analytics/click-aggregation.service.js';
import { createClickConsumer } from '../../src/modules/analytics/click-consumer.service.js';
import { startTestApi } from '../support/api.js';
import { newBrowser } from '../support/browser.js';
import { createMigratedDatabase } from '../support/database.js';
import { signedInOwner } from '../support/owners.js';
import { createTestRedis, testRedisUrl } from '../support/redis.js';

// "Now" is fixed so date ranges never flake around midnight: today is 2026-10-29 (UTC).
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);

const POLICIES = { memberRead: [{ subject: 'user', limit: 1000, windowSeconds: 60 }] };

let database;
let redis;
let api;
let owner;

before(async () => {
  database = await createMigratedDatabase();
  redis = await createTestRedis();
  api = await startTestApi({ database, redis, policies: POLICIES, analytics: { clock: () => NOW } });
  owner = await signedInOwner({ database, api });
});

after(async () => {
  await api.server.close();
  await redis.cleanup();
  await database.drop();
});

async function newLink(browser = owner) {
  return (await browser.post('/api/v1/links', { destinationUrl: 'https://example.com' })).json();
}

// Writes aggregates directly, as the worker would have, for exact and repeatable numbers.
async function seed(linkId, { lifetime, days = {} }) {
  await database.pool.query('INSERT INTO link_totals (link_id, clicks) VALUES ($1, $2)', [linkId, String(lifetime)]);

  for (const [day, buckets] of Object.entries(days)) {
    for (const [dimension, entries] of Object.entries(buckets)) {
      for (const [bucket, clicks] of Object.entries(entries)) {
        await database.pool.query(
          'INSERT INTO daily_metrics (link_id, day, dimension, bucket, clicks) VALUES ($1, $2, $3, $4, $5)',
          [linkId, day, dimension, bucket, String(clicks)],
        );
      }
    }
  }
}

// One day's aggregates where every dimension adds up to `total`, as the worker guarantees.
function dayOf(total, { country = { unknown: total }, device = { desktop: total }, referrer = { direct_or_unknown: total } } = {}) {
  return { total: { all: total }, country, device, referrer };
}

async function analytics(linkId, query = '', browser = owner) {
  const response = await browser.request(`/api/v1/links/${linkId}/analytics${query}`);

  return { status: response.status, body: await response.json() };
}

const sum = (items) => items.reduce((total, item) => total + BigInt(item.clicks), 0n).toString();

describe('link analytics', () => {
  test('a new link has a genuine zero state for the default 30-day range', async () => {
    const link = await newLink();
    const { status, body } = await analytics(link.id);

    assert.equal(status, 200);
    LinkAnalyticsSchema.parse(body);
    assert.equal(body.from, '2026-09-30');
    assert.equal(body.to, '2026-10-30');
    assert.equal(body.timezone, 'UTC');
    assert.equal(body.totalClicks, '0');
    assert.equal(body.rangeClicks, '0');
    assert.equal(body.daily.length, 30);
    assert.ok(body.daily.every((day) => day.clicks === '0'));
    assert.deepEqual([body.countries, body.devices, body.referrers], [[], [], []]);
    assert.equal(body.lastUpdatedAt, null);
    assert.equal(body.approximate, true);
    assert.deepEqual(body.pipeline, { status: 'unknown', heartbeatAt: null, oldestPendingAt: null });
  });

  test('counts only the range, zero-fills missing days, and keeps lifetime separate', async () => {
    const link = await newLink();

    await seed(link.id, {
      lifetime: 50,
      days: {
        '2026-10-01': dayOf(10),
        '2026-10-03': dayOf(5),
        '2026-10-04': dayOf(7),
      },
    });

    const { body } = await analytics(link.id, '?from=2026-10-01&to=2026-10-04');

    assert.equal(body.totalClicks, '50');
    assert.equal(body.rangeClicks, '15', 'to is exclusive: 2026-10-04 is not included');
    assert.deepEqual(body.daily, [
      { date: '2026-10-01', clicks: '10' },
      { date: '2026-10-02', clicks: '0' },
      { date: '2026-10-03', clicks: '5' },
    ]);
    assert.ok(body.lastUpdatedAt);
  });

  test('every breakdown adds up to rangeClicks, including unknown and other values, largest first', async () => {
    const link = await newLink();

    await seed(link.id, {
      lifetime: 30,
      days: {
        '2026-10-20': dayOf(20, {
          country: { EG: 12, unknown: 5, DE: 3 },
          device: { mobile: 11, desktop: 6, bot: 3 },
          referrer: { direct_or_unknown: 8, 'news.example': 9, other: 3 },
        }),
        '2026-10-21': dayOf(10, {
          country: { DE: 10 },
          device: { tablet: 10 },
          referrer: { 'news.example': 10 },
        }),
      },
    });

    const { body } = await analytics(link.id, '?from=2026-10-20&to=2026-10-22');

    assert.equal(body.rangeClicks, '30');

    for (const breakdown of [body.countries, body.devices, body.referrers]) {
      assert.equal(sum(breakdown), body.rangeClicks);
    }

    assert.deepEqual(body.countries, [{ country: 'DE', clicks: '13' }, { country: 'EG', clicks: '12' }, { country: 'unknown', clicks: '5' }]);
    assert.deepEqual(body.devices.map((item) => item.device), ['mobile', 'tablet', 'desktop', 'bot']);
    assert.deepEqual(body.referrers, [{ host: 'news.example', clicks: '19' }, { host: 'direct_or_unknown', clicks: '8' }, { host: 'other', clicks: '3' }]);
  });

  test('referrers show the top 20 hosts and sum the rest, plus the stored "other", into one entry', async () => {
    const link = await newLink();
    const referrer = { other: 4 };

    for (let i = 1; i <= 25; i += 1) referrer[`site${String(i).padStart(2, '0')}.example`] = i;

    const total = Object.values(referrer).reduce((a, b) => a + b, 0);

    await seed(link.id, { lifetime: total, days: { '2026-10-25': dayOf(total, { referrer }) } });

    const { body } = await analytics(link.id, '?from=2026-10-25&to=2026-10-26');

    assert.equal(body.referrers.length, 21);
    assert.deepEqual(body.referrers[0], { host: 'site25.example', clicks: '25' });
    assert.deepEqual(body.referrers.at(-1), { host: 'other', clicks: String(1 + 2 + 3 + 4 + 5 + 4) });
    assert.equal(sum(body.referrers), body.rangeClicks);
  });

  test('counters beyond JavaScript\'s safe integer range are returned exactly', async () => {
    const link = await newLink();
    const huge = '9007199254740993';

    await seed(link.id, { lifetime: huge, days: { '2026-10-29': dayOf(huge) } });

    const { body } = await analytics(link.id, '?from=2026-10-29&to=2026-10-30');

    assert.equal(body.totalClicks, huge);
    assert.equal(body.rangeClicks, huge);
    assert.equal(body.countries[0].clicks, huge);
  });

  test('ranges are validated: order, at most 90 days, within retention, real dates', async () => {
    const link = await newLink();

    for (const [query, field] of [
      ['?from=2026-10-10&to=2026-10-10', 'from'],
      ['?from=2026-10-20&to=2026-10-10', 'from'],
      ['?from=2026-07-01&to=2026-10-01', 'to'],
      ['?from=2025-10-01&to=2025-10-10', 'from'],
      ['?from=2026-13-01', 'from'],
      ['?from=yesterday', 'from'],
      ['?days=7', 'days'],
    ]) {
      const { status, body } = await analytics(link.id, query);

      assert.equal(status, 400, query);
      assert.equal(body.error.fields[0].path, field, query);
    }

    assert.equal((await analytics(link.id, '?from=2026-08-01&to=2026-10-30')).status, 200, 'exactly 90 days is allowed');
  });

  test('only the owner can read a link\'s analytics', async () => {
    const link = await newLink();
    const guestBrowser = await newBrowser(api.server);
    const guestLink = await (await guestBrowser.post('/api/v1/links', { destinationUrl: 'https://example.com' })).json();
    const { rows } = await database.pool.query('SELECT id FROM links WHERE code = $1', [guestLink.code]);

    assert.equal((await analytics(link.id, '', await signedInOwner({ database, api }))).status, 404, 'another owner');
    assert.equal((await analytics(rows[0].id)).status, 404, 'a guest link');
    assert.equal((await analytics(randomUUID())).status, 404, 'unknown');
    assert.equal((await analytics('not-a-uuid')).status, 404, 'malformed');
    assert.equal((await analytics(link.id, '', guestBrowser)).status, 401, 'signed out');
  });
});

describe('end to end', () => {
  test('real redirects, processed by the real worker, appear in the owner\'s analytics', async () => {
    const live = await startTestApi({ database, redis, policies: POLICIES });
    const blocking = createRedisClient({ url: testRedisUrl(), commandTimeoutMs: 5000 });

    try {
      await blocking.connect();

      const liveOwner = await signedInOwner({ database, api: live });
      const link = await (await liveOwner.post('/api/v1/links', { destinationUrl: 'https://example.com' })).json();

      for (let i = 0; i < 3; i += 1) {
        await fetch(`${live.server.url}/r/${link.code}`, { redirect: 'manual', headers: { Referer: 'https://social.example/p/1' } });
      }

      await fetch(`${live.server.url}/r/${link.code}`, { redirect: 'manual', method: 'HEAD' });

      const consumer = createClickConsumer({
        redis: redis.client,
        blockingRedis: blocking,
        aggregator: createClickAggregator({ pool: database.pool }),
        keyPrefix: redis.keyPrefix,
        blockMs: 50,
        minIdleMs: 0,
      });

      await consumer.ensureGroup();

      while ((await consumer.processOnce()) > 0) {
        // drain
      }

      const body = await (await liveOwner.request(`/api/v1/links/${link.id}/analytics`)).json();

      assert.equal(body.totalClicks, '3', 'three GETs; the HEAD is not counted');
      assert.equal(body.rangeClicks, '3');
      assert.deepEqual(body.referrers, [{ host: 'social.example', clicks: '3' }]);
      assert.equal(body.daily.at(-1).clicks, '3', 'counted on today\'s UTC date');
    } finally {
      blocking.destroy();
      await live.server.close();
    }
  });
});
