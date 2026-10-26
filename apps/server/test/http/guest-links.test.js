import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { GuestCreateLinkResponseSchema } from '@shortlist/contracts';

import { SESSION_COOKIE } from '../../src/http/middleware/session.js';
import { createPool } from '../../src/infra/postgres.js';
import { startTestApi } from '../support/api.js';
import { newBrowser } from '../support/browser.js';
import { createMigratedDatabase } from '../support/database.js';
import { ALLOWED_ORIGIN } from '../support/http.js';
import { createTestRedis, createUnreachableRedis } from '../support/redis.js';

// Small limits so quota and challenge behaviour show up within a few requests.
const POLICIES = {
  guestCreate: [{ subject: 'network', limit: 4, windowSeconds: 3600 }],
  guestCreateRisk: [{ subject: 'network', limit: 2, windowSeconds: 600 }],
};

let database;
let redis;
const servers = [];
const extraPools = [];

async function startApi(options = {}) {
  const api = await startTestApi({ database, redis, policies: POLICIES, ...options });

  servers.push(api.server);

  return api;
}

function createLink(browser, body, extraHeaders) {
  return browser.post('/api/v1/links', body, extraHeaders);
}

async function challengeToken(browser, action = 'guest-create') {
  const response = await browser.post('/api/v1/dev/challenge-token', { action });

  return (await response.json()).challengeToken;
}

async function errorOf(response) {
  return (await response.json()).error;
}

before(async () => {
  database = await createMigratedDatabase();
  redis = await createTestRedis();
});

after(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(extraPools.map((pool) => pool.end()));
  await redis.cleanup();
  await database.drop();
});

describe('guest link creation', () => {
  test('returns only code, short URL and expiry, and the short URL redirects', async () => {
    const { server } = await startApi();
    const browser = await newBrowser(server);

    const response = await createLink(browser, { destinationUrl: 'https://example.com/a?b=c' });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys(GuestCreateLinkResponseSchema.parse(body)).sort(), ['code', 'expiresAt', 'shortUrl']);
    assert.deepEqual(Object.keys(body).sort(), ['code', 'expiresAt', 'shortUrl'], 'no id or management fields');
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('etag'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(body.shortUrl, `${ALLOWED_ORIGIN}/r/${body.code}`);

    const days = (new Date(body.expiresAt) - Date.now()) / (24 * 60 * 60 * 1000);

    assert.ok(days > 6.99 && days <= 7, `expires in ${days} days`);

    const redirect = await browser.request(`/r/${body.code}`);

    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), 'https://example.com/a?b=c');
  });

  test('stores the link without an owner, as a generated code', async () => {
    const { server } = await startApi();
    const browser = await newBrowser(server);
    const { code } = await (await createLink(browser, { destinationUrl: 'https://example.com' })).json();

    const { rows } = await database.pool.query('SELECT owner_id, is_custom_alias FROM links WHERE code = $1', [code]);

    assert.deepEqual(rows, [{ owner_id: null, is_custom_alias: false }]);
  });

  test('guests cannot choose an alias or expiry, or assign an owner', async () => {
    const { server } = await startApi();
    const someUser = randomUUID();

    for (const extra of [{ customAlias: 'my-alias' }, { expiresAt: '2030-01-01T00:00:00Z' }, { ownerId: someUser }, { enabled: false }]) {
      const browser = await newBrowser(server);
      const response = await createLink(browser, { destinationUrl: 'https://example.com', ...extra });
      const error = await errorOf(response);

      assert.equal(response.status, 400, JSON.stringify(extra));
      assert.equal(error.code, 'VALIDATION_FAILED');
      assert.deepEqual(error.fields, [{ path: Object.keys(extra)[0], message: 'Unknown field.' }]);
    }

    const { rows } = await database.pool.query("SELECT count(*)::int AS n FROM links WHERE code = 'my-alias' OR owner_id = $1", [someUser]);

    assert.equal(rows[0].n, 0);
  });

  test('invalid destinations are field errors', async () => {
    const { server } = await startApi();
    const browser = await newBrowser(server);
    const response = await createLink(browser, { destinationUrl: 'http://192.168.0.1/router' });
    const error = await errorOf(response);

    assert.equal(response.status, 400);
    assert.equal(error.fields[0].path, 'destinationUrl');
  });
});

describe('session and CSRF', () => {
  test('requires the CSRF token from the browser session', async () => {
    const { server } = await startApi();
    const browser = await newBrowser(server);

    const response = await createLink(browser, { destinationUrl: 'https://example.com' }, { 'X-CSRF-Token': 'wrong' });

    assert.equal(response.status, 403);
    assert.equal((await errorOf(response)).code, 'CSRF_INVALID');
  });

  test('an unknown or expired session cookie is rejected, not treated as a guest', async () => {
    const { server } = await startApi();
    const browser = await newBrowser(server);

    const response = await createLink(browser, { destinationUrl: 'https://example.com' }, { Cookie: `${SESSION_COOKIE}=expired-or-forged` });

    assert.equal(response.status, 403);
    assert.equal((await errorOf(response)).code, 'CSRF_INVALID');
  });

  test('signed-in users do not get a guest link (registered creation is T17)', async () => {
    const { server, store } = await startApi();
    const { rows } = await database.pool.query(
      'INSERT INTO users (email, email_normalized, email_verified_at) VALUES ($1, $1, now()) RETURNING id, role, session_version',
      [`${randomUUID()}@example.com`],
    );

    const { token, session } = await store.rotate(null, { id: rows[0].id, role: rows[0].role, sessionVersion: rows[0].session_version });
    const browser = await newBrowser(server);

    browser.cookie = `${SESSION_COOKIE}=${token}`;
    browser.csrfToken = session.csrfToken;

    const response = await createLink(browser, { destinationUrl: 'https://example.com' });

    assert.equal(response.status, 501);
    assert.equal((await errorOf(response)).code, 'NOT_IMPLEMENTED');
  });
});

describe('suspicious activity, quotas and outages', () => {
  test('a burst requires a challenge, and a retry with a verified token succeeds', async () => {
    const { server } = await startApi();
    const browser = await newBrowser(server);
    const create = (body) => createLink(browser, { destinationUrl: 'https://example.com', ...body });

    assert.equal((await create()).status, 201);
    assert.equal((await create()).status, 201);

    const challenged = await create();

    assert.equal(challenged.status, 403);
    assert.equal((await errorOf(challenged)).code, 'CHALLENGE_REQUIRED');

    assert.equal((await create({ challengeToken: await challengeToken(browser) })).status, 201);
  });

  test('a used challenge token cannot be replayed', async () => {
    const { server } = await startApi();
    const browser = await newBrowser(server);
    const create = (body) => createLink(browser, { destinationUrl: 'https://example.com', ...body });
    const token = await challengeToken(browser);

    await create();
    await create();

    assert.equal((await create({ challengeToken: token })).status, 201);
    assert.equal((await create({ challengeToken: token })).status, 403);
  });

  test('a token for another action is refused', async () => {
    const { server } = await startApi();
    const browser = await newBrowser(server);

    await createLink(browser, { destinationUrl: 'https://example.com' });
    await createLink(browser, { destinationUrl: 'https://example.com' });

    const response = await createLink(browser, {
      destinationUrl: 'https://example.com',
      challengeToken: await challengeToken(browser, 'report'),
    });

    assert.equal(response.status, 403);
  });

  test('the quota applies even with valid challenge tokens, and 429 has Retry-After', async () => {
    const { server } = await startApi();
    const browser = await newBrowser(server);
    const statuses = [];

    for (let i = 0; i < 6; i += 1) {
      const response = await createLink(browser, {
        destinationUrl: 'https://example.com',
        challengeToken: await challengeToken(browser),
      });

      statuses.push(response.status);

      if (response.status === 429) {
        assert.equal((await errorOf(response)).code, 'RATE_LIMITED');
        assert.ok(Number(response.headers.get('retry-after')) > 3500);
      }
    }

    assert.deepEqual(statuses, [201, 201, 201, 201, 429, 429]);
  });

  test('the quota is per client network, not per session', async () => {
    const { server } = await startApi();
    const clientIp = '198.51.100.250';

    for (let i = 0; i < 4; i += 1) {
      const browser = await newBrowser(server, clientIp);

      await createLink(browser, { destinationUrl: 'https://example.com', challengeToken: await challengeToken(browser) });
    }

    const freshSession = await newBrowser(server, clientIp);
    const response = await createLink(freshSession, { destinationUrl: 'https://example.com' });

    assert.equal(response.status, 429, 'a new session from the same network does not reset the quota');
  });

  test('a Redis outage returns 503, never a link created without protection', async () => {
    const { server } = await startApi();
    const browser = await newBrowser(server);
    const down = createUnreachableRedis();

    try {
      const { server: offline } = await startApi({ redisClient: down });
      const { rows: before } = await database.pool.query('SELECT count(*)::int AS n FROM links');

      // The same browser (cookie, CSRF token) talking to an API instance whose Redis is down.
      const response = await fetch(`${offline.url}/api/v1/links`, {
        method: 'POST',
        headers: browser.headers(),
        body: JSON.stringify({ destinationUrl: 'https://example.com' }),
      });

      assert.equal(response.status, 503);
      assert.equal((await errorOf(response)).code, 'SERVICE_UNAVAILABLE');

      const { rows: afterRows } = await database.pool.query('SELECT count(*)::int AS n FROM links');

      assert.equal(afterRows[0].n, before[0].n);
    } finally {
      down.destroy();
    }
  });

  test('a PostgreSQL outage returns 503, not 500', async () => {
    const deadPool = createPool({ databaseUrl: 'postgres://user:secret@127.0.0.1:1/none', timeoutMs: 500 });

    extraPools.push(deadPool);

    const { server } = await startApi({ pool: deadPool });
    const browser = await newBrowser(server);
    const response = await createLink(browser, { destinationUrl: 'https://example.com' });

    assert.equal(response.status, 503);
    assert.equal((await errorOf(response)).code, 'SERVICE_UNAVAILABLE');
    assert.ok(response.headers.get('retry-after'));
  });
});
