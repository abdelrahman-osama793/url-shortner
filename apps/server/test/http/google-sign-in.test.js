import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { GoogleStartResponseSchema, LoginResponseSchema } from '@shortlist/contracts';

import { startTestApi } from '../support/api.js';
import { newBrowser } from '../support/browser.js';
import { createMigratedDatabase } from '../support/database.js';
import { TEST_GOOGLE_CLIENT_ID, createTestGoogle } from '../support/google.js';
import { createTestRedis } from '../support/redis.js';

// Google ID tokens here are signed with a local test key and checked by the application's real
// verification code (signature, issuer, audience, expiry, nonce). The real Google account flow
// is verified manually with the development check page.

const POLICIES = {
  googleAttempt: [{ subject: 'network', limit: 50, windowSeconds: 900 }],
};

let database;
let redis;
let google;
let api;

before(async () => {
  database = await createMigratedDatabase();
  redis = await createTestRedis();
  google = createTestGoogle();
  api = await startTestApi({ database, redis, policies: POLICIES, googleIdentity: google.identity });
});

after(async () => {
  await api.server.close();
  await redis.cleanup();
  await database.drop();
});

async function startAttempt(browser, purpose = 'login') {
  const response = await browser.post('/api/v1/auth/google/start', { purpose });

  return { status: response.status, ...(await response.json()) };
}

// The full browser flow: start an attempt, "sign in with Google" (a token carrying the attempt's
// nonce), then exchange the credential for a session.
async function signInWithGoogle(browser, claims = {}, { signWith } = {}) {
  const { attemptId, nonce } = await startAttempt(browser);
  const { credential, payload } = google.issue({ nonce, ...claims }, { signWith });
  const response = await browser.post('/api/v1/auth/google', { attemptId, credential });

  return { response, payload, attemptId, credential };
}

async function errorOf(response) {
  return (await response.json()).error;
}

async function identityCount(subject) {
  const { rows } = await database.pool.query("SELECT count(*)::int AS n FROM external_identities WHERE provider = 'google' AND subject = $1", [subject]);

  return rows[0].n;
}

describe('signing in with Google', () => {
  test('starting an attempt returns the configured client ID with the nonce', async () => {
    const attempt = GoogleStartResponseSchema.parse(await startAttempt(await newBrowser(api.server)));

    assert.equal(attempt.clientId, TEST_GOOGLE_CLIENT_ID);
    assert.ok(attempt.nonce.length >= 32);
  });

  test('a new Gmail user gets a verified, password-less account and a fresh session', async () => {
    const browser = await newBrowser(api.server);
    const anonymousCookie = browser.cookie;

    const { response, payload } = await signInWithGoogle(browser);
    const body = LoginResponseSchema.parse(await response.json());

    assert.equal(response.status, 200);
    assert.equal(body.user.email, payload.email);
    assert.equal(body.user.emailVerified, true);
    assert.notEqual(browser.cookie, anonymousCookie, 'the session is rotated');

    browser.csrfToken = body.csrfToken;

    assert.equal((await browser.request('/api/v1/auth/me')).status, 200);
    assert.equal(await identityCount(payload.sub), 1);

    const { rows } = await database.pool.query('SELECT count(*)::int AS n FROM password_credentials WHERE user_id = $1', [body.user.id]);

    assert.equal(rows[0].n, 0, 'no password is created');
  });

  test('a returning user is found by Google subject, even if their Google email changed', async () => {
    const subject = `google-${randomUUID()}`;
    const first = await signInWithGoogle(await newBrowser(api.server), { sub: subject });
    const firstUser = (await first.response.json()).user;

    const again = await signInWithGoogle(await newBrowser(api.server), { sub: subject, email: `renamed-${randomUUID()}@gmail.com` });
    const againUser = (await again.response.json()).user;

    assert.equal(againUser.id, firstUser.id);
    assert.equal(againUser.email, firstUser.email, 'the contact email is not silently replaced');
  });

  test('a Workspace account (hd claim) counts as verified', async () => {
    const { response } = await signInWithGoogle(await newBrowser(api.server), {
      email: `staff-${randomUUID()}@company.example`,
      hd: 'company.example',
    });

    assert.equal((await response.json()).user.emailVerified, true);
  });

  test('a non-Google email domain stays unverified until our own email link is used', async () => {
    const browser = await newBrowser(api.server);
    const { response, payload } = await signInWithGoogle(browser, { email: `person-${randomUUID()}@yahoo.example` });
    const body = await response.json();

    browser.csrfToken = body.csrfToken;

    assert.equal(body.user.emailVerified, false);

    const { rows } = await database.pool.query("SELECT count(*)::int AS n FROM email_outbox WHERE user_id = $1 AND kind = 'verification'", [body.user.id]);

    assert.equal(rows[0].n, 1, 'a verification email is queued');

    const restricted = await browser.post('/api/v1/links', { destinationUrl: 'https://example.com' });

    assert.equal(restricted.status, 403);
    assert.equal((await errorOf(restricted)).code, 'EMAIL_NOT_VERIFIED');
    assert.ok(payload.email_verified, 'Google said verified, but Google is not authoritative for this domain');
  });

  test('concurrent first sign-ins of one Google identity create exactly one account', async () => {
    const subject = `google-${randomUUID()}`;
    const email = `race-${randomUUID()}@gmail.com`;
    const browsers = await Promise.all(Array.from({ length: 5 }, () => newBrowser(api.server)));

    const results = await Promise.all(browsers.map((browser) => signInWithGoogle(browser, { sub: subject, email })));
    const userIds = await Promise.all(results.map(async ({ response }) => (await response.json()).user.id));

    assert.equal(new Set(userIds).size, 1);
    assert.equal(await identityCount(subject), 1);
  });
});

describe('existing accounts are never linked by email', () => {
  test('a Google email matching a password account gets 409 after valid proof, and nothing changes', async () => {
    const email = `owner-${randomUUID()}@gmail.com`;
    const owner = await newBrowser(api.server);

    await owner.post('/api/v1/auth/register', { email, password: 'the owner passphrase' });

    const browser = await newBrowser(api.server);
    const { response, payload } = await signInWithGoogle(browser, { email });

    assert.equal(response.status, 409);
    assert.equal((await errorOf(response)).code, 'ACCOUNT_LINK_REQUIRED');
    assert.equal(await identityCount(payload.sub), 0, 'no identity is attached');
    assert.equal((await browser.request('/api/v1/auth/me')).status, 401, 'no session is created');

    const login = await (await newBrowser(api.server)).post('/api/v1/auth/login', { email, password: 'the owner passphrase' });

    assert.equal(login.status, 200, 'the existing account is untouched');
  });

  test('without valid proof, a matching email gets the generic 401, not 409', async () => {
    const email = `owner-${randomUUID()}@gmail.com`;

    await (await newBrowser(api.server)).post('/api/v1/auth/register', { email, password: 'the owner passphrase' });

    const { response } = await signInWithGoogle(await newBrowser(api.server), { email }, { signWith: 'untrusted' });

    assert.equal(response.status, 401, 'account existence is not revealed to forged tokens');
  });
});

describe('rejected credentials all get the same 401', () => {
  for (const [label, claims, options] of [
    ['issued for another app (audience)', { aud: '999-otherapp.apps.googleusercontent.com' }],
    ['issued by someone other than Google (issuer)', { iss: 'https://evil.example' }],
    ['expired', { iat: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) - 3600 }],
    ['signed with a key Google never published', {}, { signWith: 'untrusted' }],
    ['carrying another attempt\'s nonce', { nonce: 'not-the-attempt-nonce' }],
  ]) {
    test(label, async () => {
      const browser = await newBrowser(api.server);
      const { attemptId, nonce } = await startAttempt(browser);
      const { credential } = google.issue({ nonce, ...claims }, options);

      const response = await browser.post('/api/v1/auth/google', { attemptId, credential });

      assert.equal(response.status, 401);
      assert.equal((await errorOf(response)).code, 'GOOGLE_SIGN_IN_FAILED');
      assert.equal((await browser.request('/api/v1/auth/me')).status, 401);
    });
  }

  test('a token without a nonce, a malformed token and an unknown attempt', async () => {
    const browser = await newBrowser(api.server);

    const noNonce = await startAttempt(browser);
    const { credential: withoutNonce } = google.issue({ nonce: undefined });

    assert.equal((await browser.post('/api/v1/auth/google', { attemptId: noNonce.attemptId, credential: withoutNonce })).status, 401);

    const malformed = await startAttempt(browser);

    assert.equal((await browser.post('/api/v1/auth/google', { attemptId: malformed.attemptId, credential: 'not.a.jwt' })).status, 401);

    const { credential } = google.issue({ nonce: 'x' });

    assert.equal((await browser.post('/api/v1/auth/google', { attemptId: 'never-issued', credential })).status, 401);
  });
});

describe('attempts', () => {
  test('cannot be replayed, and a credential cannot be reused with a new attempt', async () => {
    const browser = await newBrowser(api.server);
    const { attemptId, credential, response } = await signInWithGoogle(browser);

    assert.equal(response.status, 200);

    const replayBrowser = await newBrowser(api.server);

    assert.equal((await replayBrowser.post('/api/v1/auth/google', { attemptId, credential })).status, 401, 'same attempt');

    const fresh = await startAttempt(replayBrowser);

    assert.equal((await replayBrowser.post('/api/v1/auth/google', { attemptId: fresh.attemptId, credential })).status, 401, 'old nonce');
  });

  test('are bound to the browser session that started them', async () => {
    const starter = await newBrowser(api.server);
    const { attemptId, nonce } = await startAttempt(starter);
    const { credential } = google.issue({ nonce });

    const otherBrowser = await newBrowser(api.server);

    assert.equal((await otherBrowser.post('/api/v1/auth/google', { attemptId, credential })).status, 401);
  });

  test('expire after five minutes', async () => {
    const browser = await newBrowser(api.server);
    const { attemptId, nonce } = await startAttempt(browser);
    const key = `${redis.keyPrefix}login-attempt:${attemptId}`;
    const ttl = await redis.client.pTTL(key);

    assert.ok(ttl > 290_000 && ttl <= 300_000, `ttl ${ttl}`);

    await redis.client.del(key);

    assert.equal((await browser.post('/api/v1/auth/google', { attemptId, credential: google.issue({ nonce }).credential })).status, 401);
  });

  test('for linking or re-authentication require a signed-in user', async () => {
    const browser = await newBrowser(api.server);

    for (const purpose of ['link', 'reauthenticate']) {
      const { status } = await startAttempt(browser, purpose);

      assert.equal(status, 401, purpose);
    }
  });

  test('of another purpose cannot be used to sign in', async () => {
    const browser = await newBrowser(api.server);
    const signedIn = await signInWithGoogle(browser);

    browser.csrfToken = (await signedIn.response.json()).csrfToken;

    const { attemptId, nonce } = await startAttempt(browser, 'link');
    const response = await browser.post('/api/v1/auth/google', { attemptId, credential: google.issue({ nonce }).credential });

    assert.equal(response.status, 401);
  });
});

describe('protections and failures', () => {
  test('a suspended account is refused after valid proof', async () => {
    const subject = `google-${randomUUID()}`;
    const first = await signInWithGoogle(await newBrowser(api.server), { sub: subject });
    const { id } = (await first.response.json()).user;

    await database.pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [id]);

    const { response } = await signInWithGoogle(await newBrowser(api.server), { sub: subject });

    assert.equal(response.status, 403);
    assert.equal((await errorOf(response)).code, 'ACCOUNT_SUSPENDED');
  });

  test('when Google\'s signing keys cannot be fetched, sign-in answers 503, not 401', async () => {
    const browser = await newBrowser(api.server);

    google.setUnavailable(true);

    try {
      const { response } = await signInWithGoogle(browser);

      assert.equal(response.status, 503);
      assert.equal((await errorOf(response)).code, 'SERVICE_UNAVAILABLE');
    } finally {
      google.setUnavailable(false);
    }
  });

  test('both endpoints need the CSRF token', async () => {
    const browser = await newBrowser(api.server);

    browser.csrfToken = null;

    assert.equal((await browser.post('/api/v1/auth/google/start', { purpose: 'login' })).status, 403);
    assert.equal((await browser.post('/api/v1/auth/google', { attemptId: 'x', credential: 'y' })).status, 403);
  });

  test('starting attempts is rate-limited per network', async () => {
    const limited = await startTestApi({
      database,
      redis,
      googleIdentity: google.identity,
      policies: { googleAttempt: [{ subject: 'network', limit: 2, windowSeconds: 900 }] },
    });

    try {
      const browser = await newBrowser(limited.server);
      const statuses = [];

      for (let i = 0; i < 3; i += 1) statuses.push((await startAttempt(browser)).status);

      assert.deepEqual(statuses, [200, 200, 429]);
    } finally {
      await limited.server.close();
    }
  });

  test('Google routes do not exist when no client ID is configured', async () => {
    const withoutGoogle = await startTestApi({ database, redis });

    try {
      const browser = await newBrowser(withoutGoogle.server);

      assert.equal((await browser.post('/api/v1/auth/google/start', { purpose: 'login' })).status, 404);
    } finally {
      await withoutGoogle.server.close();
    }
  });

  test('credentials never reach the logs', async () => {
    const { credential } = await signInWithGoogle(await newBrowser(api.server));

    assert.equal(JSON.stringify(api.logLines).includes(credential), false);
  });
});
