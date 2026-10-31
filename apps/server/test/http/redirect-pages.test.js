import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { createApp } from '../../src/http/app.js';
import { createRedirectsController } from '../../src/http/controllers/redirects.controller.js';
import { createRedirectRouter } from '../../src/http/routes/redirects.routes.js';
import { createRedirectService } from '../../src/modules/links/redirects.service.js';
import { createLinkService } from '../../src/modules/links/links.service.js';
import { createMigratedDatabase } from '../support/database.js';
import { createCapturingLogger, startServer, testConfig } from '../support/http.js';

// Public failure pages for short links (T32): browsers get a small HTML page with the right
// status; API clients keep the JSON envelope. Nothing about the owner, the destination or the
// reason for inactivity is revealed.

const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const SECRET_DESTINATION = 'https://secret-destination.example/private?token=abc';
const OWNER_EMAIL = `owner-${randomUUID()}@example.com`;
const BLOCK_REASON = 'Internal note: phishing kit reported by Alice';

let database;
let linkService;
let ownerId;
let server;
const servers = [];

async function startRedirectServer(redirectService) {
  const { logger } = createCapturingLogger();
  const app = createApp({ config: testConfig(), logger, routers: [createRedirectRouter({ controller: createRedirectsController({ redirectService }) })] });
  const started = await startServer(app);

  servers.push(started);

  return started;
}

const open = (target, path, options = {}) => fetch(`${target.url}${path}`, { redirect: 'manual', headers: { Accept: BROWSER_ACCEPT }, ...options });

// The page text without the line that names the code, so pages for different links compare equal.
const withoutCode = (html) => html.replace(/<p class="code">.*?<\/p>/s, '').replace(/\?code=[^"]*/g, '');

before(async () => {
  database = await createMigratedDatabase();
  linkService = createLinkService({ pool: database.pool, publicBaseUrl: 'https://shortlist.example' });

  const { rows } = await database.pool.query('INSERT INTO users (email, email_normalized) VALUES ($1, $1) RETURNING id', [OWNER_EMAIL]);

  ownerId = rows[0].id;
  server = await startRedirectServer(createRedirectService({ pool: database.pool }));
});

after(async () => {
  await Promise.all(servers.map((started) => started.close()));
  await database.drop();
});

async function newLink() {
  return linkService.createOwnedLink({ ownerId, destinationUrl: SECRET_DESTINATION });
}

describe('failure pages for people', () => {
  test('a missing code gets a 404 page that is not cached, scripted or framed', async () => {
    const response = await open(server, '/r/NoSuchCode9');
    const html = await response.text();

    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(html, /<h1>This short link doesn't exist<\/h1>/);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /href="\/"/);
    assert.doesNotMatch(html, /<script/i);
  });

  test('every kind of inactive link gets the same 410 page, revealing nothing', async () => {
    const pages = [];

    const disabled = await newLink();
    await database.pool.query('UPDATE links SET owner_disabled_at = now(), version = version + 1 WHERE id = $1', [disabled.id]);

    const expired = await newLink();
    await database.pool.query("UPDATE links SET expires_at = now() - interval '1 minute', version = version + 1 WHERE id = $1", [expired.id]);

    const blocked = await newLink();
    await database.pool.query('UPDATE links SET admin_blocked_at = now(), admin_block_reason = $2, version = version + 1 WHERE id = $1', [blocked.id, BLOCK_REASON]);

    // A link whose owner is suspended (owners can never change, so the account is suspended after).
    const { rows } = await database.pool.query('INSERT INTO users (email, email_normalized) VALUES ($1, $1) RETURNING id', [`${randomUUID()}@example.com`]);
    const suspended = await linkService.createOwnedLink({ ownerId: rows[0].id, destinationUrl: SECRET_DESTINATION });
    await database.pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [rows[0].id]);

    for (const link of [disabled, expired, blocked, suspended]) {
      const response = await open(server, `/r/${link.code}`);
      const html = await response.text();

      assert.equal(response.status, 410, link.code);
      assert.match(html, /This link is no longer available/);
      assert.match(html, new RegExp(`href="/report\\?code=${link.code}"`), 'offers reporting this link');
      // Internal data never appears. (The shared wording mentions expiry generically, which is
      // why "expired" is not in this list; the page is identical for every reason, checked below.)
      for (const secret of ['secret-destination', OWNER_EMAIL, 'Alice', 'phishing', 'blocked', 'suspended', 'disabled', 'moderation']) {
        assert.doesNotMatch(html.toLowerCase(), new RegExp(secret.toLowerCase()), `${link.code} leaks "${secret}"`);
      }

      pages.push(withoutCode(html));
    }

    assert.equal(new Set(pages).size, 1, 'identical pages whatever the reason');
  });

  test('an overloaded service gets a 503 page with Retry-After and a retry link', async () => {
    const overloaded = await startRedirectServer(createRedirectService({ pool: { waitingCount: 50, query: async () => ({ rows: [] }) }, maxWaiting: 50 }));
    const response = await open(overloaded, '/r/SomeCode1');
    const html = await response.text();

    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '2');
    assert.match(html, /Shortlist is briefly unavailable/);
    assert.match(html, /href="\/r\/SomeCode1">Try again/);
  });

  test('codes that cannot exist are never echoed into the page', async () => {
    for (const path of ['/r/%3Cscript%3Ealert(1)%3C%2Fscript%3E', '/r/%E0%A4', '/r/x"onmouseover="y']) {
      const response = await open(server, path);
      const html = await response.text();

      assert.ok([400, 404].includes(response.status), `${path} → ${response.status}`);
      assert.doesNotMatch(html, /<script|onmouseover|alert\(/i, path);
      assert.doesNotMatch(html, /<p class="code">/, path);
    }
  });

  test('HEAD answers with the status and no body', async () => {
    const link = await newLink();

    await database.pool.query('UPDATE links SET owner_disabled_at = now(), version = version + 1 WHERE id = $1', [link.id]);

    const response = await open(server, `/r/${link.code}`, { method: 'HEAD' });

    assert.equal(response.status, 410);
    assert.equal(await response.text(), '');
  });

  test('API clients still get the JSON envelope, and active links still redirect directly', async () => {
    const json = await fetch(`${server.url}/r/NoSuchCode9`, { redirect: 'manual' });

    assert.equal(json.status, 404);
    assert.equal((await json.json()).error.code, 'NOT_FOUND');

    const link = await newLink();
    const redirect = await open(server, `/r/${link.code}`);

    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), SECRET_DESTINATION);
  });
});
