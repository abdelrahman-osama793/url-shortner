import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { startTestApi } from '../support/api.js';
import { newBrowser } from '../support/browser.js';
import { createMigratedDatabase } from '../support/database.js';
import { signedInOwner } from '../support/owners.js';
import { createTestRedis } from '../support/redis.js';

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

function newOwner() {
  return signedInOwner({ database, api });
}

async function create(browser, body, key) {
  const headers = key === undefined ? {} : { 'Idempotency-Key': key };
  const response = await browser.post('/api/v1/links', { destinationUrl: 'https://example.com/a', ...body }, headers);

  return { response, body: await response.json() };
}

async function linkCount(ownerId) {
  const { rows } = await database.pool.query('SELECT count(*)::int AS n FROM links WHERE owner_id = $1', [ownerId]);

  return rows[0].n;
}

describe('Idempotency-Key on owned link creation', () => {
  test('a retry with the same key and body returns the original 201 and creates nothing new', async () => {
    const owner = await newOwner();
    const key = randomUUID();

    const first = await create(owner, {}, key);
    const retry = await create(owner, {}, key);

    assert.equal(first.response.status, 201);
    assert.equal(retry.response.status, 201);
    assert.deepEqual(retry.body, first.body);
    assert.equal(retry.response.headers.get('etag'), '"v1"');
    assert.equal(retry.response.headers.get('location'), `/api/v1/links/${first.body.id}`);
    assert.equal(first.response.headers.get('idempotent-replayed'), null);
    assert.equal(retry.response.headers.get('idempotent-replayed'), 'true');
    assert.equal(await linkCount(owner.userId), 1);
  });

  test('concurrent retries with one key create exactly one link and all get the same answer', async () => {
    const owner = await newOwner();
    const key = randomUUID();

    const results = await Promise.all(Array.from({ length: 10 }, () => create(owner, { customAlias: `race-${key.slice(0, 8)}` }, key)));

    assert.deepEqual(new Set(results.map(({ response }) => response.status)), new Set([201]));
    assert.equal(new Set(results.map(({ body }) => body.id)).size, 1);
    assert.equal(results.filter(({ response }) => response.headers.get('idempotent-replayed') === 'true').length, 9);
    assert.equal(await linkCount(owner.userId), 1);
  });

  test('the same key with a different body is a 409 conflict, and the original stays', async () => {
    const owner = await newOwner();
    const key = randomUUID();

    const original = await create(owner, {}, key);
    const conflict = await create(owner, { destinationUrl: 'https://example.com/different' }, key);

    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(await linkCount(owner.userId), 1);
    assert.deepEqual((await create(owner, {}, key)).body, original.body, 'the original request still replays');
  });

  test('equivalent bodies match: property order and an explicit null do not matter', async () => {
    const owner = await newOwner();
    const key = randomUUID();

    const first = await create(owner, { customAlias: null, expiresAt: null }, key);
    const reordered = await owner.post('/api/v1/links', { expiresAt: null, destinationUrl: 'https://example.com/a' }, { 'Idempotency-Key': key });

    assert.equal(reordered.status, 201);
    assert.equal((await reordered.json()).id, first.body.id);
  });

  test('a replay returns the original snapshot even after the link was edited; GET shows the current state', async () => {
    const owner = await newOwner();
    const key = randomUUID();
    const { body: original } = await create(owner, {}, key);

    await owner.request(`/api/v1/links/${original.id}`, {
      method: 'PATCH',
      body: { destinationUrl: 'https://example.org/edited' },
      headers: { 'If-Match': '"v1"' },
    });

    const replay = await create(owner, {}, key);
    const current = await (await owner.request(`/api/v1/links/${original.id}`)).json();

    assert.equal(replay.body.destinationUrl, 'https://example.com/a');
    assert.equal(replay.body.version, 1);
    assert.equal(current.destinationUrl, 'https://example.org/edited');
    assert.equal(current.version, 2);
  });

  test('keys are per account: another user with the same key gets their own link, never the first user\'s', async () => {
    const key = randomUUID();
    const alice = await newOwner();
    const bob = await newOwner();

    const aliceLink = await create(alice, { destinationUrl: 'https://example.com/alice' }, key);
    const bobLink = await create(bob, { destinationUrl: 'https://example.com/alice' }, key);

    assert.equal(bobLink.response.status, 201);
    assert.notEqual(bobLink.body.id, aliceLink.body.id);
    assert.equal(bobLink.response.headers.get('idempotent-replayed'), null);
  });

  test('failures are not recorded: a retry runs again', async () => {
    const owner = await newOwner();
    const takenAlias = `taken-${randomUUID().slice(0, 8)}`;
    const key = randomUUID();

    await create(await newOwner(), { customAlias: takenAlias });

    const failed = await create(owner, { customAlias: takenAlias }, key);
    const retried = await create(owner, { customAlias: takenAlias }, key);

    assert.equal(failed.response.status, 409);
    assert.equal(retried.body.error.code, 'ALIAS_UNAVAILABLE', 'executed again, not replayed');

    const { rows } = await database.pool.query('SELECT count(*)::int AS n FROM api_idempotency WHERE user_id = $1', [owner.userId]);

    assert.equal(rows[0].n, 0);
  });

  test('records are kept 24 hours; after that the key creates a new link', async () => {
    const owner = await newOwner();
    const key = randomUUID();
    const first = await create(owner, {}, key);

    const { rows } = await database.pool.query(
      'SELECT extract(epoch FROM expires_at - created_at)::int AS seconds FROM api_idempotency WHERE user_id = $1 AND key = $2',
      [owner.userId, key],
    );

    assert.equal(rows[0].seconds, 24 * 60 * 60);

    await database.pool.query("UPDATE api_idempotency SET expires_at = now() - interval '1 second' WHERE user_id = $1", [owner.userId]);

    const later = await create(owner, {}, key);

    assert.equal(later.response.status, 201);
    assert.notEqual(later.body.id, first.body.id);
    assert.equal(await linkCount(owner.userId), 2);
  });

  test('without a key every request creates a link', async () => {
    const owner = await newOwner();

    await create(owner, {});
    await create(owner, {});

    assert.equal(await linkCount(owner.userId), 2);
  });

  test('malformed keys are rejected before anything is created', async () => {
    const owner = await newOwner();

    for (const key of ['', 'x'.repeat(256), 'has space']) {
      const { response, body } = await create(owner, {}, key);

      assert.equal(response.status, 400, JSON.stringify(key));
      assert.equal(body.error.fields[0].path, 'Idempotency-Key');
    }

    assert.equal(await linkCount(owner.userId), 0);
  });

  test('guests may send the header but it has no effect (v1 contract)', async () => {
    const guest = await newBrowser(api.server);
    const key = randomUUID();

    const first = await guest.post('/api/v1/links', { destinationUrl: 'https://example.com' }, { 'Idempotency-Key': key });
    const second = await guest.post('/api/v1/links', { destinationUrl: 'https://example.com' }, { 'Idempotency-Key': key });

    assert.equal(first.status, 201);
    assert.notEqual((await second.json()).code, (await first.json()).code);
  });
});
