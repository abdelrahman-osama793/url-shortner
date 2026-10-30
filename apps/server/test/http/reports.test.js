import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { startTestApi } from '../support/api.js';
import { newBrowser } from '../support/browser.js';
import { createMigratedDatabase } from '../support/database.js';
import { signedInOwner } from '../support/owners.js';
import { createTestRedis } from '../support/redis.js';

// Public abuse reports (T29): the same acknowledgement for every code, rows only for real links,
// strict validation, CSRF and a per-network quota.

const POLICIES = {
  report: [{ subject: 'network', limit: 1000, windowSeconds: 3600 }],
  guestCreate: [{ subject: 'network', limit: 1000, windowSeconds: 3600 }],
  guestCreateRisk: [{ subject: 'network', limit: 1000, windowSeconds: 600 }],
};

let database;
let redis;
let api;
let guestCode;

before(async () => {
  database = await createMigratedDatabase();
  redis = await createTestRedis();
  api = await startTestApi({ database, redis, policies: POLICIES });

  const creator = await newBrowser(api.server);

  guestCode = (await (await creator.post('/api/v1/links', { destinationUrl: 'https://example.com/suspicious' })).json()).code;
});

after(async () => {
  await api.server.close();
  await redis.cleanup();
  await database.drop();
});

async function reportsFor(code) {
  const { rows } = await database.pool.query(
    `SELECT r.category, r.details, r.reporter_id, r.status FROM abuse_reports r JOIN links l ON l.id = r.link_id
     WHERE l.code = $1 ORDER BY r.created_at`,
    [code],
  );

  return rows;
}

const reportCount = async () => (await database.pool.query('SELECT count(*)::int AS n FROM abuse_reports')).rows[0].n;

describe('submitting a report', () => {
  test('a report for a real link is queued as open, with trimmed details', async () => {
    const browser = await newBrowser(api.server);
    const response = await browser.post('/api/v1/reports', { code: guestCode, category: 'phishing', details: '  Asks for my bank password.  ' });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { status: 'accepted' });

    const [report] = await reportsFor(guestCode);

    assert.deepEqual(report, { category: 'phishing', details: 'Asks for my bank password.', reporter_id: null, status: 'open' });
  });

  test('a signed-in reporter is recorded; empty details are stored as none', async () => {
    const reporter = await signedInOwner({ database, api });
    const own = await (await reporter.post('/api/v1/links', { destinationUrl: 'https://example.com/own' })).json();
    const response = await reporter.post('/api/v1/reports', { code: own.code, category: 'spam', details: '   ' });

    assert.equal(response.status, 202);
    assert.deepEqual(await reportsFor(own.code), [{ category: 'spam', details: null, reporter_id: reporter.userId, status: 'open' }]);
  });

  test('unknown, malformed and wrong-case codes get the same answer and store nothing', async () => {
    const browser = await newBrowser(api.server);
    const before = await reportCount();

    for (const code of ['doesNotExist1', 'not a code', '../../etc', guestCode.toUpperCase() === guestCode ? `${guestCode}x` : guestCode.toUpperCase()]) {
      const response = await browser.post('/api/v1/reports', { code, category: 'malware' });

      assert.equal(response.status, 202, code);
      assert.deepEqual(await response.json(), { status: 'accepted' }, code);
    }

    assert.equal(await reportCount(), before, 'no orphaned or misattributed rows');
  });

  test('fields are validated strictly', async () => {
    const browser = await newBrowser(api.server);
    const cases = [
      [{ code: guestCode }, 'category'],
      [{ code: guestCode, category: 'illegal' }, 'category'],
      [{ code: '', category: 'spam' }, 'code'],
      [{ code: 'x'.repeat(65), category: 'spam' }, 'code'],
      [{ code: guestCode, category: 'spam', details: 'x'.repeat(2001) }, 'details'],
      [{ code: guestCode, category: 'spam', details: 'nul \u0000 inside' }, 'details'],
      [{ code: guestCode, category: 'spam', status: 'resolved' }, null],
      [{ code: guestCode, category: 'spam', linkId: '00000000-0000-4000-8000-000000000000' }, null],
    ];

    for (const [body, field] of cases) {
      const response = await browser.post('/api/v1/reports', body);
      const { error } = await response.json();

      assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(error.code, 'VALIDATION_FAILED');
      if (field) assert.equal(error.fields[0].path, field, JSON.stringify(body).slice(0, 80));
    }

    assert.equal(
      (await browser.post('/api/v1/reports', { code: guestCode, category: 'other', details: 'x'.repeat(2000) })).status,
      202,
      'exactly 2000 characters is allowed',
    );
  });

  test('needs the CSRF token of the browser session', async () => {
    const browser = await newBrowser(api.server);

    await browser.post('/api/v1/reports', { code: guestCode, category: 'spam' });

    browser.csrfToken = 'forged';

    const response = await browser.post('/api/v1/reports', { code: guestCode, category: 'spam' });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'CSRF_INVALID');
  });

  test('the public cannot read the report queue', async () => {
    const browser = await newBrowser(api.server);

    for (const path of ['/api/v1/reports', '/api/v1/admin/reports']) {
      const response = await browser.request(path);

      assert.ok([401, 404, 405].includes(response.status), `${path} → ${response.status}`);
      assert.doesNotMatch(await response.text(), /phishing|bank password/);
    }
  });
});

describe('report quota', () => {
  test('is counted per network, including invalid attempts', async () => {
    // Its own Redis namespace, so earlier tests' reports do not count against this quota.
    const isolated = await createTestRedis();
    const limited = await startTestApi({ database, redis: isolated, policies: { report: [{ subject: 'network', limit: 3, windowSeconds: 3600 }] } });

    try {
      const browser = await newBrowser(limited.server);
      const statuses = [];

      statuses.push((await browser.post('/api/v1/reports', { code: guestCode, category: 'spam' })).status);
      statuses.push((await browser.post('/api/v1/reports', { code: guestCode, category: 'nonsense' })).status);
      statuses.push((await browser.post('/api/v1/reports', { code: 'unknown1', category: 'spam' })).status);

      const blocked = await browser.post('/api/v1/reports', { code: guestCode, category: 'spam' });

      statuses.push(blocked.status);

      assert.deepEqual(statuses, [202, 400, 202, 429]);
      assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
    } finally {
      await limited.server.close();
      await isolated.cleanup();
    }
  });
});
