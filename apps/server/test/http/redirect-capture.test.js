import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { CLICK_STREAM } from '../../src/modules/analytics/click-capture.service.js';
import { startTestApi } from '../support/api.js';
import { newBrowser } from '../support/browser.js';
import { createMigratedDatabase } from '../support/database.js';
import { signedInOwner } from '../support/owners.js';
import { createTestRedis, createUnreachableRedis } from '../support/redis.js';

let database;
let redis;
let api;
let owner;

before(async () => {
  database = await createMigratedDatabase();
  redis = await createTestRedis();
  api = await startTestApi({ database, redis, capture: { countryHeader: 'X-Test-Country' } });
  owner = await signedInOwner({ database, api });
});

after(async () => {
  await api.server.close();
  await redis.cleanup();
  await database.drop();
});

async function newLink() {
  const response = await owner.post('/api/v1/links', { destinationUrl: 'https://example.com/landing' });

  return response.json();
}

// Capture runs in the background after the 302, so give it a moment before reading the stream.
async function eventsFor(linkId) {
  await sleep(100);

  const entries = await redis.client.xRange(`${redis.keyPrefix}${CLICK_STREAM}`, '-', '+');

  return entries.filter((entry) => entry.message.l === linkId).map((entry) => entry.message);
}

function visit(code, { method = 'GET', headers = {} } = {}) {
  return fetch(`${api.server.url}/r/${code}`, { method, headers, redirect: 'manual' });
}

describe('redirect capture', () => {
  test('a GET redirect records one event for the link and its current version', async () => {
    const link = await newLink();

    const response = await visit(link.code, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148',
        Referer: 'https://social.example/feed?user=someone',
        'X-Test-Country': 'EG',
      },
    });

    assert.equal(response.status, 302);

    const [event, ...rest] = await eventsFor(link.id);

    assert.equal(rest.length, 0);
    assert.equal(event.lv, '1');
    assert.equal(event.d, 'mobile');
    assert.equal(event.r, 'social.example');
    assert.equal(event.c, 'EG');
  });

  test('HEAD, missing, inactive and prefetch requests record nothing', async () => {
    const link = await newLink();

    await visit(link.code, { method: 'HEAD' });
    await visit(link.code, { headers: { 'Sec-Purpose': 'prefetch' } });
    await visit(`missing-${randomUUID().slice(0, 8)}`);

    await database.pool.query('UPDATE links SET owner_disabled_at = now(), version = version + 1 WHERE id = $1', [link.id]);

    assert.equal((await visit(link.code)).status, 410);
    assert.deepEqual(await eventsFor(link.id), []);
  });

  test('the incoming query string never reaches the event', async () => {
    const link = await newLink();

    await visit(`${link.code}?email=person@example.com&token=abc`);

    const [event] = await eventsFor(link.id);

    assert.equal(JSON.stringify(event).includes('person@example.com'), false);
    assert.equal(JSON.stringify(event).includes('token'), false);
  });

  test('a full queue still redirects normally; the loss is counted', async () => {
    const full = await startTestApi({ database, redis, capture: { queueCap: 0 } });

    try {
      const link = await newLink();
      const response = await fetch(`${full.server.url}/r/${link.code}`, { redirect: 'manual' });

      assert.equal(response.status, 302);

      await sleep(100);

      assert.equal(full.clickCapture.snapshot().dropped.queue_full, 1);
    } finally {
      await full.server.close();
    }
  });

  test('with Redis down, redirects stay fast and correct', async () => {
    const down = createUnreachableRedis();

    try {
      // Redirects and capture use the dead Redis; the link itself is created on the healthy API.
      const offline = await startTestApi({ database, redis, redisClient: down });
      const link = await newLink();
      const timings = [];

      for (let i = 0; i < 10; i += 1) {
        const startedAt = performance.now();
        const response = await fetch(`${offline.server.url}/r/${link.code}`, { redirect: 'manual' });

        timings.push(performance.now() - startedAt);
        assert.equal(response.status, 302);
      }

      await sleep(100);

      const { dropped } = offline.clickCapture.snapshot();

      assert.ok(Math.max(...timings) < 200, `slowest redirect ${Math.max(...timings).toFixed(1)} ms`);
      assert.equal(dropped.redis_error + dropped.circuit_open, 10);

      await offline.server.close();
    } finally {
      down.destroy();
    }
  });

  test('guest links are counted too', async () => {
    const guest = await newBrowser(api.server);
    const { code } = await (await guest.post('/api/v1/links', { destinationUrl: 'https://example.com' })).json();
    const { rows } = await database.pool.query('SELECT id FROM links WHERE code = $1', [code]);

    await visit(code);

    assert.equal((await eventsFor(rows[0].id)).length, 1);
  });
});
