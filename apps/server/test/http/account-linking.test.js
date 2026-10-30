import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { MeResponseSchema } from '@shortlist/contracts';

import { hashPassword } from '../../src/modules/accounts/rules/passwords.js';
import { startTestApi } from '../support/api.js';
import { newBrowser } from '../support/browser.js';
import { createMigratedDatabase } from '../support/database.js';
import { createTestGoogle } from '../support/google.js';
import { signedInOwner } from '../support/owners.js';
import { createTestRedis } from '../support/redis.js';

// Recent authentication and explicit Google linking (T16). Google ID tokens are signed with a
// local test key and checked by the application's real verification code.

const POLICIES = {
  googleAttempt: [{ subject: 'network', limit: 200, windowSeconds: 900 }],
  login: [{ subject: 'account', limit: 5, windowSeconds: 900 }],
};

const PASSWORD = 'correct horse battery staple';

let database;
let redis;
let google;
let api;
let passwordHash;

before(async () => {
  database = await createMigratedDatabase();
  redis = await createTestRedis();
  google = createTestGoogle();
  api = await startTestApi({ database, redis, policies: POLICIES, googleIdentity: google.identity });
  passwordHash = await hashPassword(PASSWORD);
});

after(async () => {
  await api.server.close();
  await redis.cleanup();
  await database.drop();
});

// A signed-in account with a password (signed in just now, so recently authenticated).
async function passwordOwner(email) {
  const browser = await signedInOwner({ database, api });

  await database.pool.query('INSERT INTO password_credentials (user_id, password_hash) VALUES ($1, $2)', [browser.userId, passwordHash]);

  if (email) {
    await database.pool.query('UPDATE users SET email = $2, email_normalized = $2 WHERE id = $1', [browser.userId, email]);
  }

  return browser;
}

// Makes the browser's last identity proof older than the recent-auth window.
async function makeAuthOld(browser) {
  const token = browser.cookie.split('=')[1];
  const key = `${redis.keyPrefix}session:${createHash('sha256').update(token).digest('base64url')}`;
  const session = JSON.parse(await redis.client.get(key));

  session.recentAuthAt = Date.now() - 60 * 60 * 1000;
  await redis.client.set(key, JSON.stringify(session), { KEEPTTL: true });
}

async function googleProof(browser, purpose, claims = {}) {
  const started = await browser.post('/api/v1/auth/google/start', { purpose });
  const { attemptId, nonce } = await started.json();
  const { credential, payload } = google.issue({ nonce, ...claims });

  // `proof` is exactly the request body; `payload` is what the Google token says (for asserts).
  return { proof: { attemptId, credential }, payload };
}

async function link(browser, claims = {}) {
  const { proof, payload } = await googleProof(browser, 'link', claims);
  const response = await browser.post('/api/v1/auth/google/link', proof);

  return { response, payload };
}

async function signInWithGoogle(claims) {
  const browser = await newBrowser(api.server);
  const { proof } = await googleProof(browser, 'login', claims);

  return browser.post('/api/v1/auth/google', proof);
}

const codeOf = async (response) => (await response.json()).error?.code;

async function googleIdentities(userId) {
  const { rows } = await database.pool.query("SELECT subject FROM external_identities WHERE user_id = $1 AND provider = 'google'", [userId]);

  return rows.map((row) => row.subject);
}

describe('confirming identity with a password', () => {
  test('the right password records recent authentication; a wrong one is refused', async () => {
    const browser = await passwordOwner();

    await makeAuthOld(browser);

    const wrong = await browser.post('/api/v1/auth/reauthenticate', { password: 'not the password' });

    assert.equal(wrong.status, 401);
    assert.equal(await codeOf(wrong), 'INVALID_CREDENTIALS');
    assert.equal((await link(browser)).response.status, 403, 'still not recent');

    assert.equal((await browser.post('/api/v1/auth/reauthenticate', { password: PASSWORD })).status, 204);
    assert.equal((await link(browser)).response.status, 204, 'recent now');
  });

  test('a Google-only account is told to confirm with Google', async () => {
    const browser = await signedInOwner({ database, api });
    const response = await browser.post('/api/v1/auth/reauthenticate', { password: PASSWORD });

    assert.equal(response.status, 401);
    assert.match((await response.json()).error.message, /Confirm with Google/);
  });

  test('needs a signed-in session and is rate-limited like sign-in', async () => {
    const guest = await newBrowser(api.server);

    assert.equal((await guest.post('/api/v1/auth/reauthenticate', { password: PASSWORD })).status, 401);

    const browser = await passwordOwner();
    const statuses = [];

    for (let i = 0; i < 6; i += 1) statuses.push((await browser.post('/api/v1/auth/reauthenticate', { password: 'wrong guess' })).status);

    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
  });
});

describe('linking Google', () => {
  test('links the proven Google account; Google sign-in then reaches the same account', async () => {
    const browser = await passwordOwner();
    const { response, payload } = await link(browser);

    assert.equal(response.status, 204);
    assert.deepEqual(await googleIdentities(browser.userId), [payload.sub]);

    const signIn = await signInWithGoogle({ sub: payload.sub, email: payload.email });

    assert.equal(signIn.status, 200);
    assert.equal((await signIn.json()).user.id, browser.userId);
  });

  test('a matching email alone never links: the collision is resolved only by an explicit link', async () => {
    const email = `ada-${randomUUID()}@gmail.com`;
    const browser = await passwordOwner(email);
    const sub = `google-${randomUUID()}`;

    const collision = await signInWithGoogle({ sub, email });

    assert.equal(collision.status, 409);
    assert.equal(await codeOf(collision), 'ACCOUNT_LINK_REQUIRED');
    assert.deepEqual(await googleIdentities(browser.userId), [], 'nothing linked by the email match');

    assert.equal((await link(browser, { sub, email })).response.status, 204);
    assert.equal((await signInWithGoogle({ sub, email })).status, 200);

    const { rows } = await database.pool.query('SELECT count(*)::int AS n FROM users WHERE email_normalized = $1', [email]);

    assert.equal(rows[0].n, 1, 'still one account');
  });

  test('requires recent authentication of the account itself', async () => {
    const browser = await passwordOwner();

    await makeAuthOld(browser);

    const { response } = await link(browser);

    assert.equal(response.status, 403);
    assert.equal(await codeOf(response), 'REAUTHENTICATION_REQUIRED');
    assert.deepEqual(await googleIdentities(browser.userId), []);
  });

  test('attempts cannot be swapped between purposes, users or browsers, nor replayed', async () => {
    const browser = await passwordOwner();
    const other = await passwordOwner();

    const { proof: loginProof } = await googleProof(browser, 'login');

    assert.equal((await browser.post('/api/v1/auth/google/link', loginProof)).status, 401, 'sign-in attempt used to link');

    const { proof: reauthProof } = await googleProof(browser, 'reauthenticate');

    assert.equal((await browser.post('/api/v1/auth/google/link', reauthProof)).status, 401, 're-authentication attempt used to link');

    const { proof: linkProof } = await googleProof(browser, 'link');

    assert.equal((await other.post('/api/v1/auth/google/link', linkProof)).status, 401, "another user's attempt");

    const { proof: fresh } = await googleProof(browser, 'link');

    assert.equal((await browser.post('/api/v1/auth/google', fresh)).status, 401, 'link attempt used to sign in');

    const { proof: once } = await googleProof(browser, 'link');

    assert.equal((await browser.post('/api/v1/auth/google/link', once)).status, 204);
    assert.equal((await browser.post('/api/v1/auth/google/link', once)).status, 401, 'replay');

    assert.deepEqual(await googleIdentities(other.userId), []);
  });

  test('a Google account linked elsewhere, or a second Google account, is refused', async () => {
    const first = await passwordOwner();
    const second = await passwordOwner();
    const { payload } = await link(first);

    const taken = (await link(second, { sub: payload.sub })).response;

    assert.equal(taken.status, 409);
    assert.equal(await codeOf(taken), 'GOOGLE_ACCOUNT_IN_USE');

    const another = (await link(first)).response;

    assert.equal(another.status, 409);
    assert.equal(await codeOf(another), 'GOOGLE_ALREADY_LINKED');

    assert.equal((await link(first, { sub: payload.sub })).response.status, 204, 'linking the same account again changes nothing');
    assert.deepEqual(await googleIdentities(first.userId), [payload.sub]);
    assert.deepEqual(await googleIdentities(second.userId), []);
  });

  test('the database allows one Google identity per account, whatever the code path', async () => {
    const browser = await passwordOwner();

    await database.pool.query("INSERT INTO external_identities (user_id, provider, subject) VALUES ($1, 'google', $2)", [browser.userId, `g-${randomUUID()}`]);

    await assert.rejects(
      database.pool.query("INSERT INTO external_identities (user_id, provider, subject) VALUES ($1, 'google', $2)", [browser.userId, `g-${randomUUID()}`]),
      { code: '23505' },
    );
  });

  test('signed-out browsers cannot start or complete a link', async () => {
    const guest = await newBrowser(api.server);

    assert.equal((await guest.post('/api/v1/auth/google/start', { purpose: 'link' })).status, 401);
    assert.equal((await guest.post('/api/v1/auth/google/link', { attemptId: 'x', credential: 'y' })).status, 401);
  });
});

describe('confirming identity with Google', () => {
  test('only the Google account linked to this account counts; the subject never changes', async () => {
    const browser = await passwordOwner();
    const { payload } = await link(browser);

    await makeAuthOld(browser);

    const { proof: stranger } = await googleProof(browser, 'reauthenticate');

    assert.equal((await browser.post('/api/v1/auth/google/reauthenticate', stranger)).status, 401, 'a different Google account');

    const { proof: own } = await googleProof(browser, 'reauthenticate', { sub: payload.sub, email: payload.email });

    assert.equal((await browser.post('/api/v1/auth/google/reauthenticate', own)).status, 204);
    assert.deepEqual(await googleIdentities(browser.userId), [payload.sub], 'identity unchanged');
    assert.equal((await link(browser, { sub: payload.sub })).response.status, 204, 'recent again');
  });

  test('accounts without Google cannot use it, and sign-in attempts do not count', async () => {
    const browser = await passwordOwner();
    const { proof } = await googleProof(browser, 'reauthenticate');

    assert.equal((await browser.post('/api/v1/auth/google/reauthenticate', proof)).status, 401);

    const { proof: loginProof } = await googleProof(browser, 'login');

    assert.equal((await browser.post('/api/v1/auth/google/reauthenticate', loginProof)).status, 401);
  });
});

describe('the account summary (GET /auth/me)', () => {
  const me = async (browser) => MeResponseSchema.parse(await (await browser.request('/api/v1/auth/me')).json());

  test('lists the sign-in methods and how long the session counts as recently authenticated', async () => {
    const browser = await passwordOwner();
    const fresh = await me(browser);

    assert.deepEqual(fresh.signInMethods, { password: true, google: false });
    assert.ok(Date.parse(fresh.recentAuthUntil) > Date.now(), 'just signed in');

    await link(browser);
    await makeAuthOld(browser);

    const later = await me(browser);

    assert.deepEqual(later.signInMethods, { password: true, google: true });
    assert.equal(later.recentAuthUntil, null);
  });

  test('a Google-only account has no password method', async () => {
    const browser = await newBrowser(api.server);
    const { proof } = await googleProof(browser, 'login');
    const body = await (await browser.post('/api/v1/auth/google', proof)).json();

    browser.csrfToken = body.csrfToken;

    assert.deepEqual((await me(browser)).signInMethods, { password: false, google: true });
  });
});
