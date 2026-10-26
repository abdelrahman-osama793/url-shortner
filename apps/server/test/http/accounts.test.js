import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { LoginResponseSchema } from '@shortlist/contracts';
import argon2 from 'argon2';

import { createSmtpMailer } from '../../src/infra/mailer.js';
import { createOutboxSender } from '../../src/modules/email/email-delivery.service.js';
import { startTestApi } from '../support/api.js';
import { newBrowser } from '../support/browser.js';
import { createMigratedDatabase } from '../support/database.js';
import { messagesTo, testSmtpUrl, tokenFromEmail, uniqueAddress } from '../support/mail.js';
import { createTestRedis } from '../support/redis.js';

const PASSWORD = 'correct horse battery staple';

// The login account bucket is small so the lockout test needs only a few attempts; the email
// quota is generous because these tests are about sign-up behaviour, not mail limits.
const POLICIES = {
  accountEmail: [
    { subject: 'account', limit: 50, windowSeconds: 3600 },
    { subject: 'network', limit: 50, windowSeconds: 3600 },
    { subject: 'global', limit: 10_000, windowSeconds: 3600 },
  ],
  login: [
    { subject: 'network', limit: 100, windowSeconds: 900 },
    { subject: 'account', limit: 5, windowSeconds: 900 },
  ],
};

let database;
let redis;
let api;
let outbox;

before(async () => {
  database = await createMigratedDatabase();
  redis = await createTestRedis();
  api = await startTestApi({ database, redis, policies: POLICIES });

  // Plays the worker's role: delivers queued emails to Mailpit when a test asks.
  outbox = createOutboxSender({
    pool: database.pool,
    mailer: createSmtpMailer({ url: testSmtpUrl(), from: 'Shortlist test <no-reply@shortlist.local>' }),
    key: api.outboxKey,
    publicBaseUrl: 'http://localhost:4200',
  });
});

after(async () => {
  await api.server.close();
  await redis.cleanup();
  await database.drop();
});

async function register(browser, email, password = PASSWORD) {
  return browser.post('/api/v1/auth/register', { email, password });
}

async function login(browser, email, password = PASSWORD) {
  return browser.post('/api/v1/auth/login', { email, password });
}

// Delivers pending email and returns the newest verification token sent to `email`.
async function verificationTokenFor(email) {
  await outbox.processBatch();

  const messages = await messagesTo(email);

  assert.ok(messages.length > 0, `no email for ${email}`);

  return tokenFromEmail(messages[0]);
}

async function errorOf(response) {
  return (await response.json()).error;
}

async function userRows(emailNormalized) {
  const { rows } = await database.pool.query(
    `SELECT u.id, u.email, u.email_verified_at, p.password_hash
     FROM users u LEFT JOIN password_credentials p ON p.user_id = u.id
     WHERE u.email_normalized = $1`,
    [emailNormalized],
  );

  return rows;
}

describe('sign-up, verification and sign-in', () => {
  test('a new user signs up, gets a restricted session until verified, then full access', async () => {
    const email = uniqueAddress();
    const browser = await newBrowser(api.server);

    const registered = await register(browser, email);

    assert.equal(registered.status, 202);
    assert.deepEqual(await registered.json(), { status: 'accepted' });

    // Signing in before verifying works, but registered link features are refused.
    const loggedIn = await login(browser, email);
    const body = LoginResponseSchema.parse(await loggedIn.json());

    browser.csrfToken = body.csrfToken;

    assert.equal(loggedIn.status, 200);
    assert.equal(body.user.emailVerified, false);

    const restricted = await browser.post('/api/v1/links', { destinationUrl: 'https://example.com' });

    assert.equal(restricted.status, 403);
    assert.equal((await errorOf(restricted)).code, 'EMAIL_NOT_VERIFIED');

    // The emailed link verifies the address.
    const verified = await browser.post('/api/v1/auth/email/verify', { token: await verificationTokenFor(email) });

    assert.equal(verified.status, 204);

    const me = await (await browser.request('/api/v1/auth/me')).json();

    assert.equal(me.user.emailVerified, true);

    // Verified: past the restriction (registered creation itself arrives with T17).
    const unrestricted = await browser.post('/api/v1/links', { destinationUrl: 'https://example.com' });

    assert.equal(unrestricted.status, 501);
  });

  test('verifying does not sign anyone in', async () => {
    const email = uniqueAddress();

    await register(await newBrowser(api.server), email);

    const stranger = await newBrowser(api.server);

    assert.equal((await stranger.post('/api/v1/auth/email/verify', { token: await verificationTokenFor(email) })).status, 204);
    assert.equal((await stranger.request('/api/v1/auth/me')).status, 401);
  });

  test('sign-in replaces the session: new cookie, new CSRF token, old session gone', async () => {
    const email = uniqueAddress();
    const browser = await newBrowser(api.server);

    await register(browser, email);

    const anonymousCookie = browser.cookie;
    const anonymousCsrf = browser.csrfToken;
    const response = await login(browser, email);
    const { csrfToken } = await response.json();

    assert.notEqual(browser.cookie, anonymousCookie);
    assert.notEqual(csrfToken, anonymousCsrf);
    assert.equal(await api.sessionService.get(anonymousCookie.split('=')[1]), null, 'the pre-login session is deleted');
  });

  test('passwords are stored as Argon2id hashes with the configured cost', async () => {
    const email = uniqueAddress();

    await register(await newBrowser(api.server), email);

    const [row] = await userRows(email);

    assert.match(row.password_hash, /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    assert.equal(row.password_hash.includes(PASSWORD), false);
  });

  test('an outdated hash is upgraded on the next successful sign-in', async () => {
    const email = uniqueAddress();

    await register(await newBrowser(api.server), email);

    const [row] = await userRows(email);
    const weakHash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 8192, timeCost: 1, parallelism: 1 });

    await database.pool.query('UPDATE password_credentials SET password_hash = $2 WHERE user_id = $1', [row.id, weakHash]);

    assert.equal((await login(await newBrowser(api.server), email)).status, 200);

    const [upgraded] = await userRows(email);

    assert.match(upgraded.password_hash, /m=19456,p=1,t=2/);
  });
});

describe('no account discovery and no credential overwrite', () => {
  test('registering an existing email answers the same, changes nothing and sends nothing', async () => {
    const email = uniqueAddress();

    await register(await newBrowser(api.server), email, PASSWORD);
    await outbox.processBatch();

    const again = await register(await newBrowser(api.server), email.toUpperCase(), 'a different password entirely');

    assert.equal(again.status, 202);
    assert.deepEqual(await again.json(), { status: 'accepted' });
    assert.equal((await userRows(email)).length, 1);

    await outbox.processBatch();

    assert.equal((await messagesTo(email)).length, 1, 'no second email');
    assert.equal((await login(await newBrowser(api.server), email, 'a different password entirely')).status, 401);
    assert.equal((await login(await newBrowser(api.server), email, PASSWORD)).status, 200, 'the original password still works');
  });

  test('concurrent sign-ups for one address create exactly one account and one email', async () => {
    const email = uniqueAddress();
    const browsers = await Promise.all(Array.from({ length: 5 }, () => newBrowser(api.server)));

    const statuses = await Promise.all(browsers.map(async (browser) => (await register(browser, email)).status));

    await outbox.processBatch();

    assert.deepEqual(new Set(statuses), new Set([202]));
    assert.equal((await userRows(email)).length, 1);
    assert.equal((await messagesTo(email)).length, 1);
  });

  test('wrong password, unknown email and password-less accounts get the identical 401', async () => {
    const email = uniqueAddress();
    const googleOnly = uniqueAddress();

    await register(await newBrowser(api.server), email);
    await database.pool.query('INSERT INTO users (email, email_normalized) VALUES ($1, $1)', [googleOnly]);

    const answers = [];

    for (const [address, password] of [[email, 'wrong password here'], [uniqueAddress(), PASSWORD], [googleOnly, PASSWORD]]) {
      const response = await login(await newBrowser(api.server), address, password);
      const error = await errorOf(response);

      answers.push(JSON.stringify({ status: response.status, code: error.code, message: error.message }));
    }

    assert.equal(new Set(answers).size, 1, answers.join(' / '));
    assert.match(answers[0], /"status":401,"code":"INVALID_CREDENTIALS"/);
  });

  test('an unknown email still pays for a password check (no timing shortcut)', async () => {
    const email = uniqueAddress();

    await register(await newBrowser(api.server), email);

    async function timedLogin(address) {
      const browser = await newBrowser(api.server);
      const startedAt = performance.now();

      await login(browser, address, 'wrong password here');

      return performance.now() - startedAt;
    }

    const wrongPassword = await timedLogin(email);
    const unknownEmail = await timedLogin(uniqueAddress());

    // Both include an Argon2id verification (~30 ms here); skipping it would take ~1-2 ms.
    assert.ok(unknownEmail > wrongPassword / 3, `unknown ${unknownEmail.toFixed(1)} ms vs wrong password ${wrongPassword.toFixed(1)} ms`);
  });

  test('resend answers the same for unknown, verified and unverified addresses, and only mails the last', async () => {
    const unverified = uniqueAddress();
    const verified = uniqueAddress();
    const unknown = uniqueAddress();

    await register(await newBrowser(api.server), unverified);
    await register(await newBrowser(api.server), verified);
    await (await newBrowser(api.server)).post('/api/v1/auth/email/verify', { token: await verificationTokenFor(verified) });

    for (const address of [unverified, verified, unknown]) {
      const response = await (await newBrowser(api.server)).post('/api/v1/auth/email/resend', { email: address });

      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { status: 'accepted' });
    }

    await outbox.processBatch();

    assert.equal((await messagesTo(unverified)).length, 2, 'original + resend');
    assert.equal((await messagesTo(verified)).length, 1, 'no resend after verification');
    assert.equal((await messagesTo(unknown)).length, 0);
  });
});

describe('verification tokens', () => {
  test('a used link fails with TOKEN_USED, an expired one with TOKEN_EXPIRED, garbage with TOKEN_INVALID', async () => {
    const email = uniqueAddress();

    await register(await newBrowser(api.server), email);

    const token = await verificationTokenFor(email);
    const browser = await newBrowser(api.server);
    const verify = (value) => browser.post('/api/v1/auth/email/verify', { token: value });

    assert.equal((await verify(token)).status, 204);
    assert.equal((await errorOf(await verify(token))).code, 'TOKEN_USED');
    assert.equal((await errorOf(await verify('not-a-real-token'))).code, 'TOKEN_INVALID');

    const other = uniqueAddress();

    await register(await newBrowser(api.server), other);

    const otherToken = await verificationTokenFor(other);

    await database.pool.query(
      "UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE user_id = (SELECT id FROM users WHERE email_normalized = $1)",
      [other],
    );

    const expired = await verify(otherToken);

    assert.equal(expired.status, 400);
    assert.equal((await errorOf(expired)).code, 'TOKEN_EXPIRED');
  });

  test('a resent link replaces the earlier one', async () => {
    const email = uniqueAddress();

    await register(await newBrowser(api.server), email);

    const firstToken = await verificationTokenFor(email);

    await (await newBrowser(api.server)).post('/api/v1/auth/email/resend', { email });

    const secondToken = await verificationTokenFor(email);
    const browser = await newBrowser(api.server);

    assert.notEqual(secondToken, firstToken);
    assert.equal((await errorOf(await browser.post('/api/v1/auth/email/verify', { token: firstToken }))).code, 'TOKEN_USED');
    assert.equal((await browser.post('/api/v1/auth/email/verify', { token: secondToken })).status, 204);
  });
});

describe('input rules and protections', () => {
  test('passwords need 12 to 256 characters', async () => {
    const browser = await newBrowser(api.server);

    const tooShort = await register(browser, uniqueAddress(), 'x'.repeat(11));
    const tooLong = await register(browser, uniqueAddress(), 'x'.repeat(257));

    assert.equal(tooShort.status, 400);
    assert.deepEqual((await errorOf(tooShort)).fields, [{ path: 'password', message: 'Use at least 12 characters.' }]);
    assert.equal(tooLong.status, 400);
    assert.equal((await register(browser, uniqueAddress(), 'x'.repeat(12))).status, 202);
  });

  test('emails are matched case-insensitively but stored and shown as typed', async () => {
    const typed = `Mixed.Case+Tag-${Date.now()}@Example.COM`;

    await register(await newBrowser(api.server), typed);

    const response = await login(await newBrowser(api.server), typed.toLowerCase());

    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.email, typed, 'the address is shown as the user typed it');
  });

  test('a suspended account with the right password gets 403; with a wrong one, the generic 401', async () => {
    const email = uniqueAddress();

    await register(await newBrowser(api.server), email);
    await database.pool.query("UPDATE users SET status = 'suspended' WHERE email_normalized = $1", [email]);

    const correct = await login(await newBrowser(api.server), email);
    const wrong = await login(await newBrowser(api.server), email, 'wrong password here');

    assert.equal(correct.status, 403);
    assert.equal((await errorOf(correct)).code, 'ACCOUNT_SUSPENDED');
    assert.equal(wrong.status, 401);
  });

  test('repeated sign-in attempts on one account are slowed down with 429', async () => {
    const email = uniqueAddress();

    await register(await newBrowser(api.server), email);

    const statuses = [];

    // Each attempt comes from a different network: the per-account bucket still applies.
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await login(await newBrowser(api.server), email, 'wrong password here')).status);
    }

    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
  });

  test('sign-up, sign-in, verify and resend all need the CSRF token', async () => {
    const browser = await newBrowser(api.server);

    browser.csrfToken = null;

    for (const [path, body] of [
      ['/api/v1/auth/register', { email: uniqueAddress(), password: PASSWORD }],
      ['/api/v1/auth/login', { email: uniqueAddress(), password: PASSWORD }],
      ['/api/v1/auth/email/verify', { token: 'x' }],
      ['/api/v1/auth/email/resend', { email: uniqueAddress() }],
    ]) {
      const response = await browser.post(path, body);

      assert.equal(response.status, 403, path);
      assert.equal((await errorOf(response)).code, 'CSRF_INVALID', path);
    }
  });

  test('passwords never reach the logs', async () => {
    const email = uniqueAddress();
    const browser = await newBrowser(api.server);

    await register(browser, email);
    await login(browser, email);
    await login(browser, email, 'another secret password');

    const logs = JSON.stringify(api.logLines);

    assert.equal(logs.includes(PASSWORD), false);
    assert.equal(logs.includes('another secret password'), false);
  });
});
