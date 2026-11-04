import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { hashPassword } from '../../src/modules/accounts/rules/passwords.js';
import { startTestApi } from '../support/api.js';
import { newBrowser } from '../support/browser.js';
import { createMigratedDatabase } from '../support/database.js';
import { signedInOwner } from '../support/owners.js';
import { createTestRedis } from '../support/redis.js';

// Deactivating and deleting an account (T45). Deactivation pauses everything and is undone by
// signing in. Deletion removes the account and everything it owns, retires its codes for good
// and keeps only the moderation records.

const PASSWORD = 'a long enough test password';
const GENEROUS = (subject) => [{ subject, limit: 1000, windowSeconds: 3600 }];
const POLICIES = {
  guestCreate: GENEROUS('network'),
  guestCreateRisk: GENEROUS('network'),
  registeredCreate: GENEROUS('user'),
  report: GENEROUS('network'),
  support: GENEROUS('network'),
  accountEmail: GENEROUS('network'),
  accountClose: GENEROUS('user'),
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

const del = (browser, body) => browser.request('/api/v1/account', { method: 'DELETE', body });
const deactivate = (browser) => browser.request('/api/v1/account/deactivate', { method: 'POST' });
const redirectStatus = async (code) => (await fetch(`${api.server.url}/r/${code}`, { redirect: 'manual' })).status;
const errorCode = async (response) => (await response.json()).error?.code;

// A verified account with a password, signed in through the real login endpoint.
async function passwordOwner() {
  const email = `${randomUUID()}@example.com`;
  const { rows: [user] } = await database.pool.query(
    'INSERT INTO users (email, email_normalized, email_verified_at) VALUES ($1, $1, now()) RETURNING id',
    [email],
  );

  await database.pool.query('INSERT INTO password_credentials (user_id, password_hash) VALUES ($1, $2)', [user.id, await hashPassword(PASSWORD)]);

  const browser = await logIn(email);

  browser.userId = user.id;
  browser.email = email;

  return browser;
}

async function logIn(email) {
  const browser = await newBrowser(api.server);
  const response = await browser.post('/api/v1/auth/login', { email, password: PASSWORD });

  browser.status = response.status;
  if (response.status === 200) browser.csrfToken = (await response.json()).csrfToken;

  return browser;
}

async function makeAuthOld(browser) {
  const token = browser.cookie.split('=')[1];
  const key = `${redis.keyPrefix}session:${createHash('sha256').update(token).digest('base64url')}`;
  const session = JSON.parse(await redis.client.get(key));

  session.recentAuthAt = Date.now() - 60 * 60 * 1000;
  await redis.client.set(key, JSON.stringify(session), { KEEPTTL: true });
}

async function newLink(owner, body = {}) {
  const response = await owner.post('/api/v1/links', { destinationUrl: `https://example.com/${randomUUID()}`, ...body });

  assert.equal(response.status, 201);

  return response.json();
}

async function status(userId) {
  return (await database.pool.query('SELECT status FROM users WHERE id = $1', [userId])).rows[0]?.status;
}

describe('deactivating an account', () => {
  test('needs a recent sign-in and CSRF', async () => {
    const owner = await passwordOwner();

    await makeAuthOld(owner);
    const stale = await deactivate(owner);

    assert.equal(stale.status, 403);
    assert.equal(await errorCode(stale), 'REAUTHENTICATION_REQUIRED');

    const fresh = await passwordOwner();

    fresh.csrfToken = 'forged';
    assert.equal((await deactivate(fresh)).status, 403);
    assert.equal(await status(fresh.userId), 'active');
  });

  test('ends every session and stops every link; signing in again brings both back', async () => {
    const owner = await passwordOwner();
    const otherDevice = await logIn(owner.email);
    const link = await newLink(owner);

    assert.equal(await redirectStatus(link.code), 302);

    const response = await deactivate(owner);

    assert.equal(response.status, 204);
    assert.match(response.headers.get('set-cookie') ?? '', /__Host-session=;/, 'cookie cleared');
    assert.equal(await status(owner.userId), 'deactivated');
    assert.equal((await owner.request('/api/v1/auth/me')).status, 401);
    assert.equal((await otherDevice.request('/api/v1/auth/me')).status, 401, 'other sessions end too');
    assert.equal(await redirectStatus(link.code), 410);

    const back = await logIn(owner.email);

    assert.equal(back.status, 200);
    assert.equal(await status(owner.userId), 'active');
    assert.equal(await redirectStatus(link.code), 302);
    assert.equal((await back.request('/api/v1/auth/me')).status, 200);
  });

  test('an administrator lifting a suspension does not reactivate a deactivated account', async () => {
    const owner = await passwordOwner();
    const admin = await signedInOwner({ database, api });

    await database.pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.userId]);
    assert.equal((await deactivate(owner)).status, 204);

    const lift = await admin.request(`/api/v1/admin/users/${owner.userId}/moderation`, { method: 'PATCH', body: { suspended: false, reason: 'check' } });

    assert.equal(lift.status, 200);
    assert.equal(await status(owner.userId), 'deactivated');
  });

  test('the last active administrator cannot deactivate', async () => {
    await database.pool.query("UPDATE users SET role = 'user' WHERE role = 'admin'");

    const admin = await signedInOwner({ database, api });

    await database.pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.userId]);

    const response = await deactivate(admin);

    assert.equal(response.status, 409);
    assert.equal(await errorCode(response), 'LAST_ACTIVE_ADMIN');
    assert.equal(await status(admin.userId), 'active');
  });
});

describe('deleting an account', () => {
  test('needs the account email typed as confirmation, a recent sign-in, and refuses administrators', async () => {
    const owner = await passwordOwner();
    const wrong = await del(owner, { email: 'someone-else@example.com' });

    assert.equal(wrong.status, 400);
    assert.equal((await wrong.json()).error.fields[0].path, 'email');
    assert.equal((await del(owner, {})).status, 400);

    await makeAuthOld(owner);
    assert.equal(await errorCode(await del(owner, { email: owner.email })), 'REAUTHENTICATION_REQUIRED');
    assert.equal(await status(owner.userId), 'active');

    const admin = await passwordOwner();

    await database.pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.userId]);

    const refused = await del(admin, { email: admin.email.toUpperCase() });

    assert.equal(refused.status, 403);
    assert.equal(await status(admin.userId), 'active');
  });

  test('removes everything the account owns, retires its codes and keeps moderation records', async () => {
    const owner = await passwordOwner();
    const stranger = await signedInOwner({ database, api });
    const admin = await signedInOwner({ database, api });

    await database.pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.userId]);

    // Links (one with an alias, one made with an idempotency key), clicks and analytics.
    const aliased = await newLink(owner, { customAlias: `gone-${randomUUID().slice(0, 8)}` });
    const keyed = await (await owner.post('/api/v1/links', { destinationUrl: 'https://example.com/keyed' }, { 'Idempotency-Key': randomUUID() })).json();
    const linkIds = [aliased.id, keyed.id];

    await database.pool.query(
      `INSERT INTO click_events (event_id, link_id, occurred_at, link_version, country_code, device_type, referrer_host)
       VALUES ($1, $2, now(), 1, 'unknown', 'desktop', 'direct_or_unknown')`,
      [randomUUID(), aliased.id],
    );
    await database.pool.query("INSERT INTO link_totals (link_id, clicks) VALUES ($1, 1)", [aliased.id]);
    await database.pool.query("INSERT INTO daily_metrics (link_id, day, dimension, bucket, clicks) VALUES ($1, current_date, 'total', 'all', 1)", [aliased.id]);

    // A Google identity, a pending reset email and token, a support message.
    await database.pool.query("INSERT INTO external_identities (user_id, provider, subject) VALUES ($1, 'google', $2)", [owner.userId, randomUUID()]);
    assert.equal((await (await newBrowser(api.server)).post('/api/v1/auth/password/forgot', { email: owner.email })).status, 202);
    assert.equal((await owner.post('/api/v1/support', { topic: 'privacy', message: 'Please delete my data' })).status, 202);

    // Reports: one the owner filed about someone else's link, one someone filed about theirs.
    const strangersLink = await newLink(stranger);

    assert.equal((await owner.post('/api/v1/reports', { code: strangersLink.code, category: 'spam' })).status, 202);
    assert.equal((await stranger.post('/api/v1/reports', { code: aliased.code, category: 'phishing' })).status, 202);

    // Moderation history about the owner: suspended, then reactivated.
    for (const suspended of [true, false]) {
      const response = await admin.request(`/api/v1/admin/users/${owner.userId}/moderation`, { method: 'PATCH', body: { suspended, reason: 'test' } });

      assert.equal(response.status, 200);
    }

    const session = await logIn(owner.email);
    const response = await del(session, { email: `  ${owner.email.toUpperCase()}  ` });

    assert.equal(response.status, 204);
    assert.match(response.headers.get('set-cookie') ?? '', /__Host-session=;/);

    // Nothing about the person or their links remains, apart from moderation records.
    const left = async (sql, params) => (await database.pool.query(sql, params)).rows[0].n;
    const checks = {
      users: ['SELECT count(*)::int AS n FROM users WHERE id = $1', [owner.userId]],
      passwords: ['SELECT count(*)::int AS n FROM password_credentials WHERE user_id = $1', [owner.userId]],
      identities: ['SELECT count(*)::int AS n FROM external_identities WHERE user_id = $1', [owner.userId]],
      tokens: ['SELECT count(*)::int AS n FROM auth_tokens WHERE user_id = $1', [owner.userId]],
      emails: ['SELECT count(*)::int AS n FROM email_outbox WHERE user_id = $1', [owner.userId]],
      support: ['SELECT count(*)::int AS n FROM support_messages WHERE user_id = $1', [owner.userId]],
      idempotency: ['SELECT count(*)::int AS n FROM api_idempotency WHERE user_id = $1', [owner.userId]],
      links: ['SELECT count(*)::int AS n FROM links WHERE owner_id = $1 OR id = ANY($2::uuid[])', [owner.userId, linkIds]],
      clicks: ['SELECT count(*)::int AS n FROM click_events WHERE link_id = ANY($1::uuid[])', [linkIds]],
      totals: ['SELECT count(*)::int AS n FROM link_totals WHERE link_id = ANY($1::uuid[])', [linkIds]],
      daily: ['SELECT count(*)::int AS n FROM daily_metrics WHERE link_id = ANY($1::uuid[])', [linkIds]],
      reports: ['SELECT count(*)::int AS n FROM abuse_reports WHERE reporter_id = $1 OR link_id = ANY($2::uuid[])', [owner.userId, linkIds]],
      emailAnywhere: ['SELECT count(*)::int AS n FROM users WHERE email_normalized = $1', [owner.email]],
    };

    for (const [name, [sql, params]] of Object.entries(checks)) assert.equal(await left(sql, params), 0, name);

    assert.equal(await left('SELECT count(*)::int AS n FROM admin_audit WHERE target_id = $1', [owner.userId]), 2, 'moderation history is kept');

    // The codes are retired: old links are 404, and nobody can claim the alias again.
    assert.equal(await left("SELECT count(*)::int AS n FROM code_reservations WHERE code = ANY($1) AND reason = 'tombstone'", [[aliased.code, keyed.code]]), 2);
    assert.equal(await redirectStatus(aliased.code), 404);

    const claim = await stranger.post('/api/v1/links', { destinationUrl: 'https://example.com/new', customAlias: aliased.code });

    assert.equal(claim.status, 409);

    // Signed out everywhere, and the password no longer works.
    assert.equal((await owner.request('/api/v1/auth/me')).status, 401);
    assert.equal((await logIn(owner.email)).status, 401);

    // Other people's data is untouched.
    assert.equal(await redirectStatus(strangersLink.code), 302);
  });

  test("a former administrator's account keeps only an anonymous row for the records that name it", async () => {
    const former = await passwordOwner();
    const target = await signedInOwner({ database, api });

    await database.pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [former.userId]);

    const signedIn = await logIn(former.email);
    const action = await signedIn.request(`/api/v1/admin/users/${target.userId}/moderation`, { method: 'PATCH', body: { suspended: true, reason: 'test' } });

    assert.equal(action.status, 200);
    await database.pool.query("UPDATE users SET role = 'user' WHERE id = $1", [former.userId]);

    assert.equal((await del(signedIn, { email: former.email })).status, 204);

    const { rows: [row] } = await database.pool.query('SELECT email, email_normalized, role, status, email_verified_at FROM users WHERE id = $1', [former.userId]);

    assert.deepEqual(row, { email: 'deleted account', email_normalized: `deleted:${former.userId}`, role: 'user', status: 'deleted', email_verified_at: null });
    assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM password_credentials WHERE user_id = $1', [former.userId])).rows[0].n, 0);
    assert.equal((await database.pool.query('SELECT count(*)::int AS n FROM admin_audit WHERE actor_user_id = $1', [former.userId])).rows[0].n, 1);
    assert.equal((await logIn(former.email)).status, 401);
  });

  test('links can still never be deleted without retiring their code first', async () => {
    const owner = await signedInOwner({ database, api });
    const link = await newLink(owner);

    await assert.rejects(database.pool.query('DELETE FROM links WHERE id = $1', [link.id]), /tombstone/);
  });
});
