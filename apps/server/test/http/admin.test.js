import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { AdminLinkSchema, AuditListResponseSchema, ReportQueueResponseSchema } from '@shortlist/contracts';

import { startTestApi } from '../support/api.js';
import { newBrowser } from '../support/browser.js';
import { createMigratedDatabase } from '../support/database.js';
import { signedInOwner } from '../support/owners.js';
import { createTestRedis } from '../support/redis.js';

// Administration (T30): roles, recent authentication, separate report/block actions, link
// versions, account suspension with self/last-admin protection, and audit entries that commit
// together with every change.

const POLICIES = {
  report: [{ subject: 'network', limit: 1000, windowSeconds: 3600 }],
  memberRead: [{ subject: 'user', limit: 1000, windowSeconds: 60 }],
  adminWrite: [{ subject: 'user', limit: 1000, windowSeconds: 60 }],
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

// An admin signed in just now (so recently authenticated). Roles are read from the users row.
async function newAdmin() {
  const browser = await signedInOwner({ database, api });

  await database.pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [browser.userId]);

  return browser;
}

const patch = (browser, path, body, headers) => browser.request(path, { method: 'PATCH', body, headers });

async function ownedLink(owner) {
  return (await owner.post('/api/v1/links', { destinationUrl: `https://example.com/${randomUUID()}` })).json();
}

async function report(code, category = 'phishing', details = 'Looks like a fake bank page.') {
  const reporter = await newBrowser(api.server);

  assert.equal((await reporter.post('/api/v1/reports', { code, category, details })).status, 202);
}

async function makeAuthOld(browser) {
  const token = browser.cookie.split('=')[1];
  const key = `${redis.keyPrefix}session:${createHash('sha256').update(token).digest('base64url')}`;
  const session = JSON.parse(await redis.client.get(key));

  session.recentAuthAt = Date.now() - 60 * 60 * 1000;
  await redis.client.set(key, JSON.stringify(session), { KEEPTTL: true });
}

async function audits(targetId) {
  const { rows } = await database.pool.query('SELECT action, reason, actor_user_id, request_id FROM admin_audit WHERE target_id = $1 ORDER BY created_at', [targetId]);

  return rows;
}

const codeOf = async (response) => (await response.json()).error?.code;
const redirectStatus = async (code) => (await fetch(`${api.server.url}/r/${code}`, { redirect: 'manual' })).status;

describe('access', () => {
  test('owners and signed-out visitors cannot use any admin endpoint', async () => {
    const owner = await signedInOwner({ database, api });
    const guest = await newBrowser(api.server);
    const id = randomUUID();
    const calls = [
      (b) => b.request('/api/v1/admin/reports'),
      (b) => patch(b, `/api/v1/admin/reports/${id}`, { status: 'resolved', note: 'x' }),
      (b) => b.request('/api/v1/admin/links?code=abcd'),
      (b) => patch(b, `/api/v1/admin/links/${id}/moderation`, { blocked: true, reason: 'x' }, { 'If-Match': '"v1"' }),
      (b) => patch(b, `/api/v1/admin/users/${id}/moderation`, { suspended: true, reason: 'x' }),
      (b) => b.request('/api/v1/admin/audit'),
    ];

    for (const call of calls) {
      const asOwner = await call(owner);

      assert.equal(asOwner.status, 403);
      assert.equal(await codeOf(asOwner), 'FORBIDDEN');
      assert.equal((await call(guest)).status, 401);
    }
  });

  test('changes need recent authentication and the CSRF token; reads do not', async () => {
    const admin = await newAdmin();
    const owner = await signedInOwner({ database, api });
    const link = await ownedLink(owner);

    await makeAuthOld(admin);

    assert.equal((await admin.request('/api/v1/admin/reports')).status, 200);

    const stale = await patch(admin, `/api/v1/admin/links/${link.id}/moderation`, { blocked: true, reason: 'Phishing' }, { 'If-Match': '"v1"' });

    assert.equal(stale.status, 403);
    assert.equal(await codeOf(stale), 'REAUTHENTICATION_REQUIRED');

    const fresh = await newAdmin();

    fresh.csrfToken = 'forged';

    const forged = await patch(fresh, `/api/v1/admin/links/${link.id}/moderation`, { blocked: true, reason: 'Phishing' }, { 'If-Match': '"v1"' });

    assert.equal(forged.status, 403);
    assert.equal(await codeOf(forged), 'CSRF_INVALID');
    assert.deepEqual(await audits(link.id), []);
  });
});

describe('report queue', () => {
  test('lists open reports oldest first with signed cursors bound to the status', async () => {
    const admin = await newAdmin();
    const owner = await signedInOwner({ database, api });
    const links = [await ownedLink(owner), await ownedLink(owner), await ownedLink(owner)];

    for (const link of links) await report(link.code);

    const codes = [];
    let cursor = null;

    do {
      const response = await admin.request(`/api/v1/admin/reports?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const page = ReportQueueResponseSchema.parse(await response.json());

      codes.push(...page.items.map((item) => item.code));
      cursor = page.nextCursor;

      if (cursor) {
        const elsewhere = await admin.request(`/api/v1/admin/reports?status=resolved&cursor=${encodeURIComponent(cursor)}`);

        assert.equal(elsewhere.status, 400, 'a cursor is only valid for its own status');
      }
    } while (cursor);

    const ours = codes.filter((code) => links.some((link) => link.code === code));

    assert.deepEqual(ours, links.map((link) => link.code));
    assert.equal((await admin.request('/api/v1/admin/reports?cursor=tampered.value')).status, 400);
  });

  test('resolving a report records who and why, and does not touch the link', async () => {
    const admin = await newAdmin();
    const owner = await signedInOwner({ database, api });
    const link = await ownedLink(owner);

    await report(link.code);

    const { rows } = await database.pool.query('SELECT r.id FROM abuse_reports r JOIN links l ON l.id = r.link_id WHERE l.code = $1', [link.code]);
    const reportId = rows[0].id;

    assert.equal((await patch(admin, `/api/v1/admin/reports/${reportId}`, { status: 'resolved' })).status, 400, 'a note is required');

    const resolved = await patch(admin, `/api/v1/admin/reports/${reportId}`, { status: 'resolved', note: '  Checked: harmless marketing page.  ' });
    const body = await resolved.json();

    assert.equal(resolved.status, 200);
    assert.equal(body.status, 'resolved');
    assert.equal(body.resolvedBy, admin.userId);
    assert.ok(body.resolvedAt);

    const [entry] = await audits(reportId);

    assert.equal(entry.action, 'report.resolved');
    assert.equal(entry.reason, 'Checked: harmless marketing page.');
    assert.equal(entry.actor_user_id, admin.userId);
    assert.match(entry.request_id, /^req_/);
    assert.equal(await redirectStatus(link.code), 302, 'resolving never blocks');

    const reopened = await (await patch(admin, `/api/v1/admin/reports/${reportId}`, { status: 'open', note: 'Reopened for a second look.' })).json();

    assert.deepEqual([reopened.status, reopened.resolvedAt, reopened.resolvedBy], ['open', null, null]);
    assert.equal((await patch(admin, `/api/v1/admin/reports/${randomUUID()}`, { status: 'resolved', note: 'x' })).status, 404);
    assert.equal((await patch(admin, '/api/v1/admin/reports/not-a-uuid', { status: 'resolved', note: 'x' })).status, 404);
  });
});

describe('link moderation', () => {
  test('inspection is by exact code and shows owner, reports and version', async () => {
    const admin = await newAdmin();
    const owner = await signedInOwner({ database, api });
    const link = await ownedLink(owner);

    await report(link.code);

    const response = await admin.request(`/api/v1/admin/links?code=${link.code}`);
    const body = AdminLinkSchema.parse(await response.json());

    assert.equal(response.headers.get('ETag'), '"v1"');
    assert.equal(body.ownerId, owner.userId);
    assert.equal(body.openReports, 1);
    assert.equal(body.effectiveStatus, 'active');

    const swapped = link.code === link.code.toUpperCase() ? link.code.toLowerCase() : link.code.toUpperCase();

    if (swapped !== link.code) assert.equal((await admin.request(`/api/v1/admin/links?code=${swapped}`)).status, 404);
    assert.equal((await admin.request('/api/v1/admin/links?code=no-such-code')).status, 404);
  });

  test('blocking needs the current version, stops redirects, and the owner can neither clear nor overwrite it', async () => {
    const admin = await newAdmin();
    const owner = await signedInOwner({ database, api });
    const link = await ownedLink(owner);
    const path = `/api/v1/admin/links/${link.id}/moderation`;

    assert.equal((await patch(admin, path, { blocked: true, reason: 'Phishing' })).status, 428);
    assert.equal((await patch(admin, path, { blocked: true, reason: 'Phishing' }, { 'If-Match': '"v9"' })).status, 412);

    const blocked = await patch(admin, path, { blocked: true, reason: 'Phishing kit reported twice' }, { 'If-Match': '"v1"' });
    const body = await blocked.json();

    assert.equal(blocked.status, 200);
    assert.equal(blocked.headers.get('ETag'), '"v2"');
    assert.deepEqual([body.effectiveStatus, body.blockReason, body.version], ['blocked', 'Phishing kit reported twice', 2]);
    assert.equal(await redirectStatus(link.code), 410);

    const ownerView = await (await owner.request(`/api/v1/links/${link.id}`)).json();

    assert.equal(ownerView.effectiveStatus, 'blocked');
    assert.equal(ownerView.blockReason, undefined, 'owners never see the reason');

    const staleOwnerEdit = await patch(owner, `/api/v1/links/${link.id}`, { destinationUrl: 'https://example.com/new' }, { 'If-Match': '"v1"' });

    assert.equal(staleOwnerEdit.status, 412, 'the owner edit started before the block');

    const enable = await (await patch(owner, `/api/v1/links/${link.id}`, { enabled: true }, { 'If-Match': '"v2"' })).json();

    assert.equal(enable.effectiveStatus, 'blocked', 'enabling never lifts a block');
    assert.equal(await redirectStatus(link.code), 410);

    const unblocked = await (await patch(admin, path, { blocked: false, reason: 'Owner fixed the page' }, { 'If-Match': `"v${enable.version}"` })).json();

    assert.deepEqual([unblocked.effectiveStatus, unblocked.blockedAt, unblocked.blockReason], ['active', null, null]);
    assert.equal(await redirectStatus(link.code), 302);
    assert.deepEqual((await audits(link.id)).map((entry) => entry.action), ['link.blocked', 'link.unblocked']);
  });

  test('a change and its audit entry commit together: if the audit fails, nothing changes', async () => {
    const admin = await newAdmin();
    const owner = await signedInOwner({ database, api });
    const link = await ownedLink(owner);

    await database.pool.query(`
      CREATE FUNCTION test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.reason = 'make the audit fail' THEN RAISE EXCEPTION 'audit write failed'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_fail_audit BEFORE INSERT ON admin_audit FOR EACH ROW EXECUTE FUNCTION test_fail_audit();
    `);

    try {
      const response = await patch(admin, `/api/v1/admin/links/${link.id}/moderation`, { blocked: true, reason: 'make the audit fail' }, { 'If-Match': '"v1"' });

      assert.equal(response.status, 500);

      const { rows } = await database.pool.query('SELECT admin_blocked_at, version FROM links WHERE id = $1', [link.id]);

      assert.deepEqual(rows[0], { admin_blocked_at: null, version: 1 });
      assert.equal(await redirectStatus(link.code), 302);
    } finally {
      await database.pool.query('DROP TRIGGER test_fail_audit ON admin_audit; DROP FUNCTION test_fail_audit();');
    }
  });
});

describe('account moderation', () => {
  test('suspension takes effect on the next request and on every redirect; reactivation needs a new sign-in', async () => {
    const admin = await newAdmin();
    const owner = await signedInOwner({ database, api });
    const link = await ownedLink(owner);
    const path = `/api/v1/admin/users/${owner.userId}/moderation`;

    const suspended = await (await patch(admin, path, { suspended: true, reason: 'Spam campaign' })).json();

    assert.equal(suspended.status, 'suspended');

    const next = await owner.request('/api/v1/links');

    assert.equal(next.status, 403);
    assert.equal(await codeOf(next), 'ACCOUNT_SUSPENDED');
    assert.equal(await redirectStatus(link.code), 410);

    assert.equal((await patch(admin, path, { suspended: true, reason: 'Again' })).status, 200);
    assert.equal((await audits(owner.userId)).length, 1, 'no change, no audit entry');

    assert.equal((await (await patch(admin, path, { suspended: false, reason: 'Appeal accepted' })).json()).status, 'active');
    assert.equal(await redirectStatus(link.code), 302);
    assert.equal((await owner.request('/api/v1/links')).status, 401, 'old sessions stay signed out');
    assert.deepEqual((await audits(owner.userId)).map((entry) => entry.action), ['user.suspended', 'user.reactivated']);
  });

  test('an admin cannot suspend themself', async () => {
    const admin = await newAdmin();
    const response = await patch(admin, `/api/v1/admin/users/${admin.userId}/moderation`, { suspended: true, reason: 'Testing' });

    assert.equal(response.status, 409);
    assert.equal(await codeOf(response), 'SELF_MODERATION');
  });

  test('two admins suspending each other at once can never leave no active admin', async () => {
    await database.pool.query("UPDATE users SET status = 'suspended' WHERE role = 'admin'");

    const first = await newAdmin();
    const second = await newAdmin();

    // Hold the account-status lock so both requests pass their guards (both admins still
    // active) and queue behind it; then they run one after the other. Only the last-admin
    // rule can stop the second one.
    const holder = await database.pool.connect();

    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(1005, 0)');

      const pending = [
        patch(first, `/api/v1/admin/users/${second.userId}/moderation`, { suspended: true, reason: 'Race' }),
        patch(second, `/api/v1/admin/users/${first.userId}/moderation`, { suspended: true, reason: 'Race' }),
      ];

      for (let waiting = 0; waiting < 2;) {
        await sleep(20);
        const { rows } = await database.pool.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted");

        waiting = rows[0].n;
      }

      await holder.query('COMMIT');

      const answers = await Promise.all(pending);
      const codes = await Promise.all(answers.map(async (response) => (response.status === 200 ? 'ok' : codeOf(response))));

      assert.deepEqual(codes.sort(), ['LAST_ACTIVE_ADMIN', 'ok']);
    } finally {
      holder.release();
    }

    const { rows } = await database.pool.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active'");

    assert.equal(rows[0].n, 1);
  });
});

describe('audit history', () => {
  test('is listed newest first, per target, with cursors bound to the filter', async () => {
    const admin = await newAdmin();
    const owner = await signedInOwner({ database, api });
    const link = await ownedLink(owner);
    const path = `/api/v1/admin/links/${link.id}/moderation`;

    await patch(admin, path, { blocked: true, reason: 'one' }, { 'If-Match': '"v1"' });
    await patch(admin, path, { blocked: false, reason: 'two' }, { 'If-Match': '"v2"' });
    await patch(admin, path, { blocked: true, reason: 'three' }, { 'If-Match': '"v3"' });

    const first = AuditListResponseSchema.parse(await (await admin.request(`/api/v1/admin/audit?targetType=link&targetId=${link.id}&limit=2`)).json());

    assert.deepEqual(first.items.map((entry) => entry.reason), ['three', 'two']);
    assert.ok(first.nextCursor);

    const second = await (await admin.request(`/api/v1/admin/audit?targetType=link&targetId=${link.id}&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)).json();

    assert.deepEqual(second.items.map((entry) => entry.reason), ['one']);
    assert.equal(second.nextCursor, null);

    assert.equal((await admin.request(`/api/v1/admin/audit?cursor=${encodeURIComponent(first.nextCursor)}`)).status, 400, 'cursor bound to its filter');
    assert.equal((await admin.request('/api/v1/admin/audit?targetType=link')).status, 400, 'type without id');
  });
});
