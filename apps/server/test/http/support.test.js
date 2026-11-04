import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { startTestApi } from '../support/api.js';
import { newBrowser } from '../support/browser.js';
import { createMigratedDatabase } from '../support/database.js';
import { signedInOwner } from '../support/owners.js';
import { createTestRedis } from '../support/redis.js';

// Support messages (T44): anyone can write, guests must give a reply address, signed-in senders
// are answered at their account email, only admins read the inbox, and submission is limited.

const POLICIES = { support: [{ subject: 'network', limit: 1000, windowSeconds: 3600 }] };

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

const rows = async () => (await database.pool.query('SELECT user_id, reply_email, topic, message, status FROM support_messages ORDER BY created_at')).rows;

async function newAdmin() {
  const browser = await signedInOwner({ database, api });

  await database.pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [browser.userId]);

  return browser;
}

describe('sending a message', () => {
  test('a guest message is stored with its reply address; a guest without one is asked for it', async () => {
    await database.pool.query('DELETE FROM support_messages');

    const guest = await newBrowser(api.server);
    const missing = await guest.post('/api/v1/support', { topic: 'links', message: 'How do I change a link?' });

    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error.fields[0].path, 'email');

    const response = await guest.post('/api/v1/support', { topic: 'links', message: '  How do I change a link?  ', email: 'guest@example.com' });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { status: 'accepted' });
    assert.deepEqual(await rows(), [{ user_id: null, reply_email: 'guest@example.com', topic: 'links', message: 'How do I change a link?', status: 'open' }]);
  });

  test('a signed-in sender is answered at their account email, whatever address they type', async () => {
    await database.pool.query('DELETE FROM support_messages');

    const owner = await signedInOwner({ database, api });
    const { rows: [account] } = await database.pool.query('SELECT email FROM users WHERE id = $1', [owner.userId]);

    assert.equal((await owner.post('/api/v1/support', { topic: 'account', message: 'Help', email: 'someone-else@example.com' })).status, 202);
    assert.deepEqual(await rows(), [{ user_id: owner.userId, reply_email: account.email, topic: 'account', message: 'Help', status: 'open' }]);
  });

  test('fields are validated strictly', async () => {
    const guest = await newBrowser(api.server);
    const cases = [
      [{ topic: 'billing', message: 'x', email: 'a@example.com' }, 'topic'],
      [{ topic: 'other', message: '   ', email: 'a@example.com' }, 'message'],
      [{ topic: 'other', message: 'x'.repeat(4001), email: 'a@example.com' }, 'message'],
      [{ topic: 'other', message: 'nul \u0000', email: 'a@example.com' }, 'message'],
      [{ topic: 'other', message: 'x', email: 'not-an-email' }, 'email'],
      [{ topic: 'other', message: 'x', email: 'a@example.com', status: 'closed' }, null],
    ];

    for (const [body, field] of cases) {
      const response = await guest.post('/api/v1/support', body);
      const { error } = await response.json();

      assert.equal(response.status, 400, JSON.stringify(body).slice(0, 60));
      if (field) assert.equal(error.fields[0].path, field, JSON.stringify(body).slice(0, 60));
    }
  });

  test('needs the CSRF token, and is limited per network', async () => {
    const guest = await newBrowser(api.server);

    await guest.post('/api/v1/support', { topic: 'other', message: 'x', email: 'a@example.com' });
    guest.csrfToken = 'forged';
    assert.equal((await guest.post('/api/v1/support', { topic: 'other', message: 'x', email: 'a@example.com' })).status, 403);

    const limited = await startTestApi({ database, redis, policies: { support: [{ subject: 'network', limit: 2, windowSeconds: 3600 }] } });

    try {
      const sender = await newBrowser(limited.server);
      const statuses = [];

      for (let i = 0; i < 3; i += 1) statuses.push((await sender.post('/api/v1/support', { topic: 'other', message: `m${i}`, email: 'a@example.com' })).status);

      assert.deepEqual(statuses, [202, 202, 429]);
    } finally {
      await limited.server.close();
    }
  });
});

describe('the admin inbox', () => {
  test('only admins can read it; they see messages oldest first and can close and reopen them', async () => {
    await database.pool.query('DELETE FROM support_messages');

    const guest = await newBrowser(api.server);

    for (const message of ['first', 'second']) {
      assert.equal((await guest.post('/api/v1/support', { topic: 'privacy', message, email: 'g@example.com' })).status, 202);
    }

    const owner = await signedInOwner({ database, api });

    assert.equal((await guest.request('/api/v1/admin/support')).status, 401);
    assert.equal((await owner.request('/api/v1/admin/support')).status, 403);

    const admin = await newAdmin();
    const inbox = await (await admin.request('/api/v1/admin/support?limit=1')).json();

    assert.equal(inbox.items[0].message, 'first');
    assert.ok(inbox.nextCursor);

    const second = await (await admin.request(`/api/v1/admin/support?limit=1&cursor=${encodeURIComponent(inbox.nextCursor)}`)).json();

    assert.equal(second.items[0].message, 'second');
    assert.equal(second.nextCursor, null);

    const closed = await (await admin.request(`/api/v1/admin/support/${inbox.items[0].id}`, { method: 'PATCH', body: { status: 'closed' } })).json();

    assert.equal(closed.status, 'closed');
    assert.equal(closed.closedBy, admin.userId);
    assert.deepEqual((await (await admin.request('/api/v1/admin/support')).json()).items.map((m) => m.message), ['second']);

    const reopened = await (await admin.request(`/api/v1/admin/support/${inbox.items[0].id}`, { method: 'PATCH', body: { status: 'open' } })).json();

    assert.equal(reopened.closedAt, null);
    assert.equal((await owner.request(`/api/v1/admin/support/${inbox.items[0].id}`, { method: 'PATCH', body: { status: 'closed' } })).status, 403);
    assert.equal((await admin.request('/api/v1/admin/support/not-a-uuid', { method: 'PATCH', body: { status: 'closed' } })).status, 404);
  });
});
