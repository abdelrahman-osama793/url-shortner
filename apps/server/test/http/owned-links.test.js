import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { LinkListResponseSchema, LinkSchema } from '@shortlist/contracts';

import { SESSION_COOKIE } from '../../src/http/middleware/session.js';
import { startTestApi } from '../support/api.js';
import { newBrowser } from '../support/browser.js';
import { createMigratedDatabase } from '../support/database.js';
import { createTestRedis } from '../support/redis.js';

const HOUR = 60 * 60 * 1000;

// Generous quotas: these tests are about link management, not limits (one test checks the quota).
const POLICIES = {
  registeredCreate: [{ subject: 'user', limit: 500, windowSeconds: 60 }],
  memberRead: [{ subject: 'user', limit: 500, windowSeconds: 60 }],
  linkUpdate: [{ subject: 'user', limit: 500, windowSeconds: 60 }],
};

let database;
let redis;
let api;

before(async () => {
  database = await createMigratedDatabase();
  redis = await createTestRedis();
  api = await startTestApi({ database, redis, policies: POLICIES });
});

after(async () => {
  await api.server.close();
  await redis.cleanup();
  await database.drop();
});

// A signed-in browser for a synthetic account created directly in the database. Only tests do
// this; real accounts come from sign-up and sign-in.
async function signedInOwner({ verified = true, server = api.server, sessions = api.sessionService } = {}) {
  const email = `${randomUUID()}@example.com`;

  const { rows } = await database.pool.query(
    `INSERT INTO users (email, email_normalized, email_verified_at)
     VALUES ($1, $1, $2)
     RETURNING id, role, session_version`,
    [email, verified ? new Date() : null],
  );

  const user = { id: rows[0].id, role: rows[0].role, sessionVersion: rows[0].session_version };
  const { token, session } = await sessions.rotate(null, user);
  const browser = await newBrowser(server);

  browser.cookie = `${SESSION_COOKIE}=${token}`;
  browser.csrfToken = session.csrfToken;
  browser.userId = user.id;

  return browser;
}

async function create(browser, body = {}) {
  const response = await browser.post('/api/v1/links', { destinationUrl: 'https://example.com/start', ...body });

  return { response, link: response.status === 201 ? await response.json() : null };
}

function patch(browser, id, body, ifMatch) {
  return browser.request(`/api/v1/links/${id}`, {
    method: 'PATCH',
    body,
    headers: ifMatch === undefined ? {} : { 'If-Match': ifMatch },
  });
}

async function errorOf(response) {
  return (await response.json()).error;
}

async function follow(browser, code) {
  const response = await browser.request(`/r/${code}`);

  return { status: response.status, location: response.headers.get('location') };
}

describe('creating owned links', () => {
  test('a verified user gets the full link, a Location and a version ETag', async () => {
    const owner = await signedInOwner();
    const expiresAt = new Date(Date.now() + 24 * HOUR).toISOString();
    const alias = `my-${randomUUID().slice(0, 8)}`;

    const { response, link } = await create(owner, { customAlias: alias, expiresAt });

    assert.equal(response.status, 201);
    LinkSchema.parse(link);
    assert.equal(link.code, alias);
    assert.equal(link.expiresAt, expiresAt);
    assert.equal(link.enabled, true);
    assert.equal(link.effectiveStatus, 'active');
    assert.equal(response.headers.get('location'), `/api/v1/links/${link.id}`);
    assert.equal(response.headers.get('etag'), '"v1"');
    assert.deepEqual(await follow(owner, alias), { status: 302, location: 'https://example.com/start' });
  });

  test('without an alias the code is generated and the link never expires (D10)', async () => {
    const { link } = await create(await signedInOwner());

    assert.match(link.code, /^[0-9A-Za-z]{8}$/);
    assert.equal(link.expiresAt, null);
  });

  test('taken and reserved aliases get the same 409', async () => {
    const owner = await signedInOwner();
    const alias = `taken-${randomUUID().slice(0, 8)}`;

    await create(owner, { customAlias: alias });

    for (const customAlias of [alias, 'admin']) {
      const { response } = await create(await signedInOwner(), { customAlias });

      assert.equal(response.status, 409, customAlias);
      assert.equal((await errorOf(response)).code, 'ALIAS_UNAVAILABLE');
    }
  });

  test('cannot assign an owner, set enabled or use a past expiry', async () => {
    const owner = await signedInOwner();

    for (const extra of [{ ownerId: randomUUID() }, { enabled: false }]) {
      const { response } = await create(owner, extra);

      assert.equal(response.status, 400, JSON.stringify(extra));
    }

    const { response } = await create(owner, { expiresAt: new Date(Date.now() - HOUR).toISOString() });

    assert.equal(response.status, 400);
    assert.equal((await errorOf(response)).fields[0].path, 'expiresAt');
  });

  test('an unverified account is refused', async () => {
    const { response } = await create(await signedInOwner({ verified: false }));

    assert.equal(response.status, 403);
    assert.equal((await errorOf(response)).code, 'EMAIL_NOT_VERIFIED');
  });

  test('creation is rate-limited per user', async () => {
    const limited = await startTestApi({
      database,
      redis,
      policies: { ...POLICIES, registeredCreate: [{ subject: 'user', limit: 2, windowSeconds: 60 }] },
    });

    try {
      const owner = await signedInOwner({ server: limited.server, sessions: limited.sessionService });
      const statuses = [];

      for (let i = 0; i < 3; i += 1) statuses.push((await create(owner)).response.status);

      assert.deepEqual(statuses, [201, 201, 429]);
    } finally {
      await limited.server.close();
    }
  });
});

describe('listing owned links', () => {
  test('pages through every link exactly once, newest first, and only the owner\'s', async () => {
    const owner = await signedInOwner();
    const someoneElse = await signedInOwner();

    await create(someoneElse);

    const created = [];

    for (let i = 0; i < 25; i += 1) created.push((await create(owner, { destinationUrl: `https://example.com/${i}` })).link.id);

    const first = LinkListResponseSchema.parse(await (await owner.request('/api/v1/links')).json());

    assert.equal(first.items.length, 20, 'default page size');
    assert.ok(first.nextCursor);

    const second = await (await owner.request(`/api/v1/links?cursor=${encodeURIComponent(first.nextCursor)}`)).json();

    assert.equal(second.items.length, 5);
    assert.equal(second.nextCursor, null);

    const listed = [...first.items, ...second.items].map((link) => link.id);

    assert.deepEqual(listed, [...created].reverse());
  });

  test('links created in the same instant are neither skipped nor repeated', async () => {
    const owner = await signedInOwner();
    const sameInstant = '2026-10-29 12:00:00.123456+00';

    const ids = [];

    for (let i = 0; i < 3; i += 1) {
      const { rows } = await database.pool.query(
        `INSERT INTO links (owner_id, code, destination_url, created_at)
         VALUES ($1, $2, 'https://example.com', $3) RETURNING id`,
        [owner.userId, `same-${randomUUID().slice(0, 8)}`, sameInstant],
      );

      ids.push(rows[0].id);
    }

    const seen = [];
    let cursor = null;

    do {
      const query = cursor ? `?limit=1&cursor=${encodeURIComponent(cursor)}` : '?limit=1';
      const page = await (await owner.request(`/api/v1/links${query}`)).json();

      seen.push(...page.items.map((link) => link.id));
      cursor = page.nextCursor;
    } while (cursor);

    assert.deepEqual([...seen].sort(), [...ids].sort());
  });

  test('cursors cannot be edited or used by another account', async () => {
    const owner = await signedInOwner();

    for (let i = 0; i < 3; i += 1) await create(owner);

    const { nextCursor } = await (await owner.request('/api/v1/links?limit=1')).json();
    const [payload, signature] = nextCursor.split('.');
    const tampered = `${payload.slice(0, -2)}AA.${signature}`;

    assert.equal((await owner.request(`/api/v1/links?cursor=${encodeURIComponent(tampered)}`)).status, 400);

    const intruder = await signedInOwner();
    const reused = await intruder.request(`/api/v1/links?cursor=${encodeURIComponent(nextCursor)}`);

    assert.equal(reused.status, 400);
    assert.equal((await errorOf(reused)).fields[0].path, 'cursor');
  });

  test('page size is between 1 and 100', async () => {
    const owner = await signedInOwner();

    assert.equal((await owner.request('/api/v1/links?limit=101')).status, 400);
    assert.equal((await owner.request('/api/v1/links?limit=0')).status, 400);
    assert.equal((await owner.request('/api/v1/links?limit=100')).status, 200);
  });

  test('requires a signed-in account', async () => {
    const guest = await newBrowser(api.server);

    assert.equal((await guest.request('/api/v1/links')).status, 401);
  });
});

describe('reading one link', () => {
  test('the owner gets it with its ETag; everyone else gets 404', async () => {
    const owner = await signedInOwner();
    const { link } = await create(owner);
    const guestLink = await (await (await newBrowser(api.server)).post('/api/v1/links', { destinationUrl: 'https://example.com' })).json();

    const own = await owner.request(`/api/v1/links/${link.id}`);

    assert.equal(own.status, 200);
    assert.equal(own.headers.get('etag'), '"v1"');

    const { rows } = await database.pool.query('SELECT id FROM links WHERE code = $1', [guestLink.code]);

    for (const id of [link.id, rows[0].id, randomUUID(), 'not-a-uuid']) {
      const viewer = id === link.id ? await signedInOwner() : owner;

      assert.equal((await viewer.request(`/api/v1/links/${id}`)).status, 404, id);
    }
  });
});

describe('editing owned links', () => {
  test('a destination change applies to the very next redirect (D12) and bumps the version', async () => {
    const owner = await signedInOwner();
    const { link } = await create(owner);

    const response = await patch(owner, link.id, { destinationUrl: 'https://example.org/updated' }, '"v1"');
    const updated = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('etag'), '"v2"');
    assert.equal(updated.version, 2);
    assert.equal(updated.code, link.code, 'the code never changes');
    assert.deepEqual(await follow(owner, link.code), { status: 302, location: 'https://example.org/updated' });
  });

  test('If-Match is required: missing or malformed is 428', async () => {
    const owner = await signedInOwner();
    const { link } = await create(owner);

    for (const ifMatch of [undefined, 'v1', '"1"', 'W/"v1"', '*']) {
      const response = await patch(owner, link.id, { enabled: false }, ifMatch);

      assert.equal(response.status, 428, String(ifMatch));
      assert.equal((await errorOf(response)).code, 'PRECONDITION_REQUIRED');
    }
  });

  test('a stale version is 412 and changes nothing', async () => {
    const owner = await signedInOwner();
    const { link } = await create(owner);

    await patch(owner, link.id, { destinationUrl: 'https://example.org/first' }, '"v1"');

    const stale = await patch(owner, link.id, { destinationUrl: 'https://example.org/stale' }, '"v1"');

    assert.equal(stale.status, 412);
    assert.equal((await errorOf(stale)).code, 'PRECONDITION_FAILED');
    assert.equal((await follow(owner, link.code)).location, 'https://example.org/first');
  });

  test('concurrent edits from the same version: exactly one wins', async () => {
    const owner = await signedInOwner();
    const { link } = await create(owner);

    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => patch(owner, link.id, { destinationUrl: `https://example.org/${i}` }, '"v1"')));
    const statuses = responses.map((response) => response.status);

    assert.equal(statuses.filter((status) => status === 200).length, 1);
    assert.equal(statuses.filter((status) => status === 412).length, 9);
  });

  test('someone else\'s link is 404, even with the right version', async () => {
    const { link } = await create(await signedInOwner());
    const intruder = await signedInOwner();

    assert.equal((await patch(intruder, link.id, { destinationUrl: 'https://evil.example' }, '"v1"')).status, 404);
  });

  test('disable and re-enable take effect on the next redirect', async () => {
    const owner = await signedInOwner();
    const { link } = await create(owner);

    const disabled = await (await patch(owner, link.id, { enabled: false }, '"v1"')).json();

    assert.equal(disabled.enabled, false);
    assert.equal(disabled.effectiveStatus, 'disabled');
    assert.equal((await follow(owner, link.code)).status, 410);

    const enabled = await (await patch(owner, link.id, { enabled: true }, '"v2"')).json();

    assert.equal(enabled.effectiveStatus, 'active');
    assert.equal((await follow(owner, link.code)).status, 302);
  });

  test('enabling never overrides an admin block or an expiry', async () => {
    const owner = await signedInOwner();
    const blocked = (await create(owner)).link;
    const expired = (await create(owner)).link;

    await database.pool.query("UPDATE links SET admin_blocked_at = now(), version = version + 1 WHERE id = $1", [blocked.id]);
    await database.pool.query("UPDATE links SET expires_at = now() - interval '1 minute', version = version + 1 WHERE id = $1", [expired.id]);

    const stillBlocked = await (await patch(owner, blocked.id, { enabled: true }, '"v2"')).json();
    const stillExpired = await (await patch(owner, expired.id, { enabled: true }, '"v2"')).json();

    assert.equal(stillBlocked.effectiveStatus, 'blocked');
    assert.equal(stillExpired.effectiveStatus, 'expired');
    assert.equal((await follow(owner, blocked.code)).status, 410);

    // Removing the expiry is the way back for an expired link (if nothing else applies).
    const revived = await (await patch(owner, expired.id, { expiresAt: null }, '"v3"')).json();

    assert.equal(revived.effectiveStatus, 'active');
    assert.equal(revived.expiresAt, null);
  });

  test('expiry must be in the future; destination rules still apply', async () => {
    const owner = await signedInOwner();
    const { link } = await create(owner);

    const past = await patch(owner, link.id, { expiresAt: new Date(Date.now() - HOUR).toISOString() }, '"v1"');
    const privateTarget = await patch(owner, link.id, { destinationUrl: 'http://10.0.0.1/' }, '"v1"');

    assert.equal(past.status, 400);
    assert.equal(privateTarget.status, 400);
    assert.equal((await errorOf(privateTarget)).fields[0].path, 'destinationUrl');
  });

  test('code, alias and owner cannot be edited, and an empty change is refused', async () => {
    const owner = await signedInOwner();
    const { link } = await create(owner);

    for (const body of [{ code: 'renamed' }, { customAlias: 'renamed' }, { ownerId: randomUUID() }, {}]) {
      assert.equal((await patch(owner, link.id, body, '"v1"')).status, 400, JSON.stringify(body));
    }
  });

  test('edits need the CSRF token', async () => {
    const owner = await signedInOwner();
    const { link } = await create(owner);

    owner.csrfToken = null;

    assert.equal((await patch(owner, link.id, { enabled: false }, '"v1"')).status, 403);
  });

  test('a suspended owner can no longer list or edit', async () => {
    const owner = await signedInOwner();
    const { link } = await create(owner);

    await database.pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [owner.userId]);

    const listing = await owner.request('/api/v1/links');

    assert.equal(listing.status, 403);
    assert.equal((await errorOf(listing)).code, 'ACCOUNT_SUSPENDED');

    // That request ended the suspended session, so the browser is now signed out: reads get
    // 401, and writes fail CSRF first because no session remains to match the token.
    assert.equal((await owner.request(`/api/v1/links/${link.id}`)).status, 401);

    const edit = await patch(owner, link.id, { enabled: false }, '"v1"');

    assert.equal(edit.status, 403);
    assert.equal((await errorOf(edit)).code, 'CSRF_INVALID');
    assert.equal((await follow(owner, link.code)).status, 410, 'and the owner\'s links stop redirecting');
  });
});
