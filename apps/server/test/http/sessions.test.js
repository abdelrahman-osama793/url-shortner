import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { MeResponseSchema } from '@shortlist/contracts';
import { Router } from 'express';

import { createApp } from '../../src/http/app.js';
import { createAuthGuards, SESSION_COOKIE } from '../../src/http/middleware/session.js';
import { createAuthRouter } from '../../src/http/routes/auth.js';
import { createSessionStore } from '../../src/modules/sessions/store.js';
import { createMigratedDatabase } from '../support/database.js';
import { ALLOWED_ORIGIN, createCapturingLogger, startServer, testConfig } from '../support/http.js';
import { createTestRedis, createUnreachableRedis } from '../support/redis.js';

const LIFETIMES = testConfig().sessionLifetimes;

let database;
let redis;
let store;
let server;
const extraServers = [];

// Routes that exist only in this test, to exercise the authorization guards.
function guardTestRouter(guards) {
  const router = Router();
  const ok = (_req, res) => res.json({ ok: true });

  router.post('/test/write', guards.session, guards.csrf, ok);
  router.get('/test/verified', guards.session, guards.user, guards.verified, ok);
  router.get('/test/admin', guards.session, guards.user, guards.admin, ok);
  router.get('/test/recent', guards.session, guards.user, guards.recentAuth(10 * 60 * 1000), ok);

  return router;
}

async function startAuthServer(sessionStore) {
  const guards = createAuthGuards({ store: sessionStore, pool: database.pool });
  const { logger } = createCapturingLogger();
  const app = createApp({
    config: testConfig(),
    logger,
    routers: [createAuthRouter({ store: sessionStore, guards }), guardTestRouter(guards)],
  });

  return startServer(app);
}

// Synthetic accounts and sessions, created directly. Only tests do this: the application has
// no endpoint that signs someone in without a password or Google proof.
async function createUser({ verified = true, role = 'user', status = 'active' } = {}) {
  const email = `${randomUUID()}@example.com`;

  const { rows } = await database.pool.query(
    `INSERT INTO users (email, email_normalized, email_verified_at, role, status)
     VALUES ($1, $1, $2, $3, $4)
     RETURNING id, role, session_version`,
    [email, verified ? new Date() : null, role, status],
  );

  return { id: rows[0].id, role: rows[0].role, sessionVersion: rows[0].session_version, email };
}

async function signIn(user) {
  const { token, session } = await store.rotate(null, user);

  return { cookie: `${SESSION_COOKIE}=${token}`, csrfToken: session.csrfToken, token, session };
}

function request(path, { method = 'GET', cookie, csrfToken, origin = ALLOWED_ORIGIN, target = server } = {}) {
  const headers = { Origin: origin };

  if (cookie) headers.Cookie = cookie;
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

  return fetch(`${target.url}${path}`, { method, headers });
}

async function errorCode(response) {
  return (await response.json()).error.code;
}

before(async () => {
  database = await createMigratedDatabase();
  redis = await createTestRedis();
  store = createSessionStore({ redis: redis.client, lifetimes: LIFETIMES, keyPrefix: redis.keyPrefix });
  server = await startAuthServer(store);
});

after(async () => {
  await server.close();
  await Promise.all(extraServers.map((extra) => extra.close()));
  await redis.cleanup();
  await database.drop();
});

describe('GET /api/v1/auth/csrf', () => {
  test('creates an anonymous session in a __Host- cookie with secure attributes', async () => {
    const response = await request('/api/v1/auth/csrf');
    const [cookie] = response.headers.getSetCookie();

    assert.equal(response.status, 200);
    assert.ok((await response.json()).csrfToken);
    assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43};`));
    assert.match(cookie, /; Path=\//);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /; SameSite=Lax/);
    assert.doesNotMatch(cookie, /Domain=/i);
  });

  test('returns the existing token for a valid session without issuing a new cookie', async () => {
    const first = await request('/api/v1/auth/csrf');
    const cookie = first.headers.getSetCookie()[0].split(';')[0];
    const { csrfToken } = await first.json();

    const second = await request('/api/v1/auth/csrf', { cookie });

    assert.equal((await second.json()).csrfToken, csrfToken);
    assert.deepEqual(second.headers.getSetCookie(), []);
  });
});

describe('CSRF protection', () => {
  test('state changes need the session token in X-CSRF-Token', async () => {
    const { cookie, csrfToken } = await signIn(await createUser());
    const other = await signIn(await createUser());

    assert.equal((await request('/test/write', { method: 'POST', cookie, csrfToken })).status, 200);

    for (const [label, options] of [
      ['missing header', { cookie }],
      ['wrong token', { cookie, csrfToken: 'wrong' }],
      ["another session's token", { cookie, csrfToken: other.csrfToken }],
      ['no session at all', { csrfToken }],
    ]) {
      const response = await request('/test/write', { method: 'POST', ...options });

      assert.equal(response.status, 403, label);
      assert.equal(await errorCode(response), 'CSRF_INVALID', label);
    }
  });

  test('anonymous pre-login sessions are CSRF protected too', async () => {
    const anonymous = await request('/api/v1/auth/csrf');
    const cookie = anonymous.headers.getSetCookie()[0].split(';')[0];
    const { csrfToken } = await anonymous.json();

    assert.equal((await request('/test/write', { method: 'POST', cookie, csrfToken })).status, 200);
    assert.equal((await request('/test/write', { method: 'POST', cookie })).status, 403);
  });

  test('a forged Origin fails even with a valid CSRF token', async () => {
    const { cookie, csrfToken } = await signIn(await createUser());
    const response = await request('/test/write', { method: 'POST', cookie, csrfToken, origin: 'https://evil.example' });

    assert.equal(response.status, 403);
    assert.equal(await errorCode(response), 'ORIGIN_NOT_ALLOWED');
  });
});

describe('GET /api/v1/auth/me', () => {
  test('returns the current user for a valid session', async () => {
    const user = await createUser();
    const { cookie } = await signIn(user);

    const response = await request('/api/v1/auth/me', { cookie });
    const body = MeResponseSchema.parse(await response.json());

    assert.equal(response.status, 200);
    assert.deepEqual(body.user, { id: user.id, email: user.email, emailVerified: true, role: 'user', status: 'active' });
  });

  test('requires a signed-in session', async () => {
    const anonymous = await request('/api/v1/auth/csrf');
    const anonymousCookie = anonymous.headers.getSetCookie()[0].split(';')[0];

    for (const cookie of [undefined, anonymousCookie, `${SESSION_COOKIE}=unknown-token`]) {
      const response = await request('/api/v1/auth/me', { cookie });

      assert.equal(response.status, 401);
      assert.equal(await errorCode(response), 'AUTHENTICATION_REQUIRED');
    }
  });

  test('an unknown session cookie is cleared', async () => {
    const response = await request('/api/v1/auth/me', { cookie: `${SESSION_COOKIE}=unknown-token` });

    assert.match(response.headers.getSetCookie()[0], new RegExp(`^${SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`));
  });

  test('a session version bump (password reset) revokes existing sessions immediately', async () => {
    const user = await createUser();
    const { cookie, token } = await signIn(user);

    await database.pool.query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [user.id]);

    const response = await request('/api/v1/auth/me', { cookie });

    assert.equal(response.status, 401);
    assert.equal(await store.get(token), null, 'the revoked session is deleted');
  });

  test('suspension takes effect on the next request', async () => {
    const user = await createUser();
    const { cookie, token } = await signIn(user);

    await database.pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [user.id]);

    const response = await request('/api/v1/auth/me', { cookie });

    assert.equal(response.status, 403);
    assert.equal(await errorCode(response), 'ACCOUNT_SUSPENDED');
    assert.equal(await store.get(token), null);
  });

  test('an expired session is rejected', async () => {
    let now = Date.now();
    const timedStore = createSessionStore({ redis: redis.client, lifetimes: LIFETIMES, keyPrefix: redis.keyPrefix, clock: () => now });
    const timedServer = await startAuthServer(timedStore);

    extraServers.push(timedServer);

    const { token } = await timedStore.rotate(null, await createUser());

    now += LIFETIMES.member.idleMs + 1;

    const response = await request('/api/v1/auth/me', { cookie: `${SESSION_COOKIE}=${token}`, target: timedServer });

    assert.equal(response.status, 401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  test('destroys the server session and clears the cookie', async () => {
    const { cookie, csrfToken, token } = await signIn(await createUser());

    const response = await request('/api/v1/auth/logout', { method: 'POST', cookie, csrfToken });

    assert.equal(response.status, 204);
    assert.match(response.headers.getSetCookie()[0], new RegExp(`^${SESSION_COOKIE}=;`));
    assert.equal(await store.get(token), null);
    assert.equal((await request('/api/v1/auth/me', { cookie })).status, 401, 'the old cookie no longer works');
  });

  test('requires the CSRF token, so another site cannot log the user out', async () => {
    const { cookie, token } = await signIn(await createUser());

    assert.equal((await request('/api/v1/auth/logout', { method: 'POST', cookie })).status, 403);
    assert.ok(await store.get(token), 'the session survives');
  });
});

describe('authorization guards', () => {
  test('verified email is required where registered features need it', async () => {
    const unverified = await signIn(await createUser({ verified: false }));
    const verified = await signIn(await createUser());

    const rejected = await request('/test/verified', { cookie: unverified.cookie });

    assert.equal(rejected.status, 403);
    assert.equal(await errorCode(rejected), 'EMAIL_NOT_VERIFIED');
    assert.equal((await request('/test/verified', { cookie: verified.cookie })).status, 200);
  });

  test('admin routes check the current role in PostgreSQL, not the session', async () => {
    const user = await createUser();
    const { cookie } = await signIn(user);

    const rejected = await request('/test/admin', { cookie });

    assert.equal(rejected.status, 403);
    assert.equal(await errorCode(rejected), 'FORBIDDEN');

    await database.pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);
    assert.equal((await request('/test/admin', { cookie })).status, 200);

    await database.pool.query("UPDATE users SET role = 'user' WHERE id = $1", [user.id]);
    assert.equal((await request('/test/admin', { cookie })).status, 403, 'demotion applies immediately');
  });

  test('recent authentication expires after its window', async () => {
    const fresh = await signIn(await createUser());

    assert.equal((await request('/test/recent', { cookie: fresh.cookie })).status, 200);

    // A store whose clock runs 11 minutes behind: its sessions authenticated 11 minutes ago.
    const elevenMinutesAgo = () => Date.now() - 11 * 60 * 1000;
    const laggingStore = createSessionStore({ redis: redis.client, lifetimes: LIFETIMES, keyPrefix: redis.keyPrefix, clock: elevenMinutesAgo });
    const laggingServer = await startAuthServer(laggingStore);

    extraServers.push(laggingServer);

    const { token } = await laggingStore.rotate(null, await createUser());
    const stale = await request('/test/recent', { cookie: `${SESSION_COOKIE}=${token}`, target: laggingServer });

    assert.equal(stale.status, 403);
    assert.equal(await errorCode(stale), 'REAUTHENTICATION_REQUIRED');
  });

  test('no endpoint signs someone in without proof (no test login shortcut)', async () => {
    for (const path of ['/api/v1/auth/login', '/api/v1/auth/test-login', '/api/v1/auth/session']) {
      assert.equal((await request(path, { method: 'POST' })).status, 404, path);
    }
  });
});

describe('Redis outage', () => {
  test('never authorizes: protected, CSRF and session-creating requests return 503', async () => {
    const down = createUnreachableRedis();

    try {
      const offlineStore = createSessionStore({ redis: down, lifetimes: LIFETIMES });
      const offline = await startAuthServer(offlineStore);

      extraServers.push(offline);

      const { cookie, csrfToken } = await signIn(await createUser());

      for (const [path, options] of [
        ['/api/v1/auth/me', { cookie }],
        ['/api/v1/auth/csrf', {}],
        ['/api/v1/auth/logout', { method: 'POST', cookie, csrfToken }],
        ['/test/write', { method: 'POST', cookie, csrfToken }],
      ]) {
        const response = await request(path, { ...options, target: offline });

        assert.equal(response.status, 503, path);
        assert.equal(await errorCode(response), 'SERVICE_UNAVAILABLE', path);
      }
    } finally {
      down.destroy();
    }
  });
});

