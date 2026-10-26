import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { createApp } from '../../src/http/app.js';
import { createRedirectsController } from '../../src/http/controllers/redirects.controller.js';
import { createRedirectRouter } from '../../src/http/routes/redirects.routes.js';
import { createPool, withTransaction } from '../../src/infra/postgres.js';
import { createRedirectService } from '../../src/modules/links/redirects.service.js';
import { createLinkService } from '../../src/modules/links/links.service.js';
import { createMigratedDatabase } from '../support/database.js';
import { ALLOWED_ORIGIN, createCapturingLogger, startServer, testConfig } from '../support/http.js';

let database;
let linkService;
let ownerId;
const servers = [];
const extraPools = [];

async function startRedirectServer(redirectService) {
  const { logger } = createCapturingLogger();
  const app = createApp({ config: testConfig(), logger, routers: [createRedirectRouter({ controller: createRedirectsController({ redirectService }) })] });
  const server = await startServer(app);

  servers.push(server);

  return server;
}

// Like a separate API process: its own connection pool to the same database.
async function startSeparateInstance() {
  const pool = createPool({ databaseUrl: database.url, maxConnections: 2 });

  extraPools.push(pool);

  return startRedirectServer(createRedirectService({ pool }));
}

function get(server, path, options = {}) {
  return fetch(`${server.url}${path}`, { redirect: 'manual', ...options });
}

// A pool stand-in that only records whether it was queried.
function spyPool(waitingCount = 0) {
  const pool = {
    waitingCount,
    queries: 0,
    async query() {
      pool.queries += 1;
      return { rows: [] };
    },
  };

  return pool;
}

async function createOwnedLink(overrides = {}) {
  return linkService.createOwnedLink({ ownerId, destinationUrl: 'https://example.com/landing?ref=owner', ...overrides });
}

before(async () => {
  database = await createMigratedDatabase();
  linkService = createLinkService({ pool: database.pool, publicBaseUrl: 'https://shortlist.example' });

  const { rows } = await database.pool.query(
    "INSERT INTO users (email, email_normalized) VALUES ($1, $1) RETURNING id",
    [`${randomUUID()}@example.com`],
  );

  ownerId = rows[0].id;
});

after(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(extraPools.map((pool) => pool.end()));
  await database.drop();
});

describe('active links', () => {
  let server;

  before(async () => {
    server = await startRedirectServer(createRedirectService({ pool: database.pool }));
  });

  test('redirect with 302 to the stored destination, uncached', async () => {
    const link = await createOwnedLink();
    const response = await get(server, `/r/${link.code}`);

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://example.com/landing?ref=owner');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  test('never append the incoming query string', async () => {
    const link = await createOwnedLink();
    const response = await get(server, `/r/${link.code}?utm_source=x&token=abc`);

    assert.equal(response.headers.get('location'), 'https://example.com/landing?ref=owner');
  });

  test('guest links redirect too', async () => {
    const link = await linkService.createGuestLink({ destinationUrl: 'https://example.com/guest' });
    const response = await get(server, `/r/${link.code}`);

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://example.com/guest');
  });

  test('HEAD returns the same status and headers with no body', async () => {
    const link = await createOwnedLink();
    const response = await get(server, `/r/${link.code}`, { method: 'HEAD' });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://example.com/landing?ref=owner');
    assert.equal(await response.text(), '');
  });
});

describe('missing and malformed codes', () => {
  let server;

  before(async () => {
    server = await startRedirectServer(createRedirectService({ pool: database.pool }));
  });

  test('unknown codes return 404, uncached', async () => {
    const response = await get(server, '/r/NoSuchCode');

    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  test('matching is exact and case-sensitive, in the path and the code', async () => {
    await createOwnedLink({ customAlias: 'CaseTest' });

    assert.equal((await get(server, '/r/CaseTest')).status, 302);
    assert.equal((await get(server, '/r/casetest')).status, 404);
    assert.equal((await get(server, '/R/CaseTest')).status, 404);
  });

  test('malformed and overlong codes are rejected without a database query', async () => {
    const pool = spyPool();
    const isolated = await startRedirectServer(createRedirectService({ pool }));

    for (const path of ['/r/abc', `/r/${'a'.repeat(33)}`, '/r/a%2Fb', '/r/has%20space', '/r/%C3%A9t%C3%A9']) {
      assert.equal((await get(isolated, path)).status, 404, path);
    }

    assert.equal(pool.queries, 0);
  });

  test('malformed percent-encoding returns 400', async () => {
    const response = await get(server, '/r/%E0%A4%A');

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'BAD_REQUEST');
  });

  test('methods other than GET and HEAD return 405 with Allow', async () => {
    const link = await createOwnedLink();
    const response = await fetch(`${server.url}/r/${link.code}`, {
      method: 'POST',
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  });
});

describe('inactive links', () => {
  let server;

  before(async () => {
    server = await startRedirectServer(createRedirectService({ pool: database.pool }));
  });

  async function setState(linkId, sql) {
    await database.pool.query(`UPDATE links SET ${sql}, version = version + 1 WHERE id = $1`, [linkId]);
  }

  test('expired, disabled, blocked and owner-suspended links all get the same generic 410', async () => {
    const expired = await createOwnedLink();
    const disabled = await createOwnedLink();
    const blocked = await createOwnedLink();

    await setState(expired.id, "expires_at = now() - interval '1 minute'");
    await setState(disabled.id, 'owner_disabled_at = now()');
    await setState(blocked.id, "admin_blocked_at = now(), admin_block_reason = 'phishing campaign'");

    const { rows } = await database.pool.query(
      "INSERT INTO users (email, email_normalized, status) VALUES ($1, $1, 'suspended') RETURNING id",
      [`${randomUUID()}@example.com`],
    );

    const suspended = await linkService.createOwnedLink({ ownerId: rows[0].id, destinationUrl: 'https://example.com' });

    const bodies = [];

    for (const link of [expired, disabled, blocked, suspended]) {
      const response = await get(server, `/r/${link.code}`);
      const body = await response.json();

      assert.equal(response.status, 410, link.code);
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');

      bodies.push({ code: body.error.code, message: body.error.message });
    }

    assert.ok(bodies.every((body) => JSON.stringify(body) === JSON.stringify(bodies[0])), 'no reason may leak');
    assert.equal(JSON.stringify(bodies).includes('phishing'), false);
  });

  test('expiry is judged by the database clock at request time', async () => {
    const link = await createOwnedLink();

    await setState(link.id, "expires_at = now() + interval '1 second'");

    assert.equal((await get(server, `/r/${link.code}`)).status, 302);

    await sleep(1200);

    assert.equal((await get(server, `/r/${link.code}`)).status, 410);
  });
});

describe('immediate visibility of committed updates (decision D12)', () => {
  test('an update committed through one instance is used by the next request on another', async () => {
    const instanceA = await startSeparateInstance();
    const instanceB = await startSeparateInstance();
    const link = await createOwnedLink();

    for (let round = 1; round <= 20; round += 1) {
      const destination = `https://example.com/version-${round}`;

      // The "edit" commits before we send the next redirect request.
      await withTransaction(database.pool, (client) => client.query(
        'UPDATE links SET destination_url = $2, version = version + 1 WHERE id = $1',
        [link.id, destination],
      ));

      const server = round % 2 === 0 ? instanceA : instanceB;
      const response = await get(server, `/r/${link.code}`);

      assert.equal(response.headers.get('location'), destination, `round ${round}`);
    }
  });

  test('disabling and re-enabling apply to the very next request', async () => {
    const instance = await startSeparateInstance();
    const link = await createOwnedLink();

    await database.pool.query('UPDATE links SET owner_disabled_at = now(), version = version + 1 WHERE id = $1', [link.id]);
    assert.equal((await get(instance, `/r/${link.code}`)).status, 410);

    await database.pool.query('UPDATE links SET owner_disabled_at = NULL, version = version + 1 WHERE id = $1', [link.id]);
    assert.equal((await get(instance, `/r/${link.code}`)).status, 302);
  });
});

describe('dependency failure and overload', () => {
  test('an unreachable database returns 503 with Retry-After, quickly', async () => {
    const pool = createPool({ databaseUrl: 'postgres://user:secret@127.0.0.1:1/none', timeoutMs: 500 });

    extraPools.push(pool);

    const server = await startRedirectServer(createRedirectService({ pool }));
    const startedAt = Date.now();
    const response = await get(server, '/r/SomeCode1');

    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '2');
    assert.equal((await response.json()).error.code, 'SERVICE_UNAVAILABLE');
    assert.ok(Date.now() - startedAt < 2000);
  });

  test('requests are shed with 503 when too many already wait for a connection', async () => {
    const pool = spyPool(50);
    const server = await startRedirectServer(createRedirectService({ pool, maxWaiting: 50 }));

    assert.equal((await get(server, '/r/SomeCode1')).status, 503);
    assert.equal(pool.queries, 0, 'an overloaded resolver must not queue another query');
  });

  test('a burst larger than the pool is served, not failed, when it fits the wait budget', async () => {
    const pool = createPool({ databaseUrl: database.url, maxConnections: 2 });

    extraPools.push(pool);

    const server = await startRedirectServer(createRedirectService({ pool, maxWaiting: 100 }));
    const link = await createOwnedLink();

    const statuses = await Promise.all(Array.from({ length: 40 }, async () => (await get(server, `/r/${link.code}`)).status));

    assert.deepEqual(new Set(statuses), new Set([302]));
  });
});
