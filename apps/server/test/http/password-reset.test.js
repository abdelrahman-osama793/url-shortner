import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createSmtpMailer } from '../../src/infra/mailer.js';
import { createOutboxSender } from '../../src/modules/email/email-delivery.service.js';
import { startTestApi } from '../support/api.js';
import { newBrowser } from '../support/browser.js';
import { createMigratedDatabase } from '../support/database.js';
import { messagesTo, testSmtpUrl, tokenFromEmail, uniqueAddress } from '../support/mail.js';
import { createTestRedis } from '../support/redis.js';

const OLD_PASSWORD = 'the original passphrase';
const NEW_PASSWORD = 'a brand new passphrase';

// Generous email quota: these tests are about recovery behaviour, not mail limits.
const POLICIES = {
  accountEmail: [
    { subject: 'account', limit: 50, windowSeconds: 3600 },
    { subject: 'network', limit: 50, windowSeconds: 3600 },
    { subject: 'global', limit: 10_000, windowSeconds: 3600 },
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

async function errorOf(response) {
  return (await response.json()).error;
}

// A verified account with OLD_PASSWORD. Returns its email.
async function createAccount() {
  const email = uniqueAddress();
  const browser = await newBrowser(api.server);

  await browser.post('/api/v1/auth/register', { email, password: OLD_PASSWORD });
  await database.pool.query('UPDATE users SET email_verified_at = now() WHERE email_normalized = $1', [email]);
  await outbox.processBatch();

  return email;
}

async function signIn(email, password = OLD_PASSWORD) {
  const browser = await newBrowser(api.server);
  const response = await browser.post('/api/v1/auth/login', { email, password });

  if (response.status === 200) browser.csrfToken = (await response.json()).csrfToken;

  return { browser, status: response.status };
}

async function requestReset(email) {
  return (await newBrowser(api.server)).post('/api/v1/auth/password/forgot', { email });
}

// Delivers queued email and returns the token from the newest reset email to `email`.
async function resetTokenFor(email) {
  await outbox.processBatch();

  const resetEmails = (await messagesTo(email)).filter((message) => message.Subject === 'Reset your Shortlist password');

  assert.ok(resetEmails.length > 0, `no reset email for ${email}`);

  return tokenFromEmail(resetEmails[0]);
}

async function resetPassword(token, newPassword = NEW_PASSWORD) {
  return (await newBrowser(api.server)).post('/api/v1/auth/password/reset', { token, newPassword });
}

async function resetEmailCount(email) {
  await outbox.processBatch();

  return (await messagesTo(email)).filter((message) => message.Subject === 'Reset your Shortlist password').length;
}

describe('password recovery', () => {
  test('the emailed link sets a new password: the new one works, the old one does not', async () => {
    const email = await createAccount();

    assert.equal((await requestReset(email)).status, 202);

    const token = await resetTokenFor(email);

    assert.equal((await resetPassword(token)).status, 204);
    assert.equal((await signIn(email, NEW_PASSWORD)).status, 200);
    assert.equal((await signIn(email, OLD_PASSWORD)).status, 401);
  });

  test('the reset email links to the reset page with the token in the fragment', async () => {
    const email = await createAccount();

    await requestReset(email);
    await outbox.processBatch();

    const [message] = (await messagesTo(email)).filter((candidate) => candidate.Subject === 'Reset your Shortlist password');

    assert.match(message.Text, /http:\/\/localhost:4200\/reset-password#token=/);
    assert.match(message.Text, /works once and expires on .* UTC/);
  });

  test('every existing session of the account stops working, on every device', async () => {
    const email = await createAccount();
    const laptop = await signIn(email);
    const phone = await signIn(email);

    assert.equal((await laptop.browser.request('/api/v1/auth/me')).status, 200);

    await requestReset(email);
    await resetPassword(await resetTokenFor(email));

    for (const device of [laptop, phone]) {
      const response = await device.browser.request('/api/v1/auth/me');

      assert.equal(response.status, 401);
      assert.equal((await errorOf(response)).code, 'AUTHENTICATION_REQUIRED');
    }

    const fresh = await signIn(email, NEW_PASSWORD);

    assert.equal((await fresh.browser.request('/api/v1/auth/me')).status, 200, 'a new sign-in works normally');
  });

  test('resetting does not sign anyone in', async () => {
    const email = await createAccount();

    await requestReset(email);

    const browser = await newBrowser(api.server);

    assert.equal((await browser.post('/api/v1/auth/password/reset', { token: await resetTokenFor(email), newPassword: NEW_PASSWORD })).status, 204);
    assert.equal((await browser.request('/api/v1/auth/me')).status, 401);
  });

  test('a reset also verifies the email, because the link proves control of the mailbox', async () => {
    const email = uniqueAddress();

    await (await newBrowser(api.server)).post('/api/v1/auth/register', { email, password: OLD_PASSWORD });
    await requestReset(email);
    await resetPassword(await resetTokenFor(email));

    const { browser } = await signIn(email, NEW_PASSWORD);
    const me = await (await browser.request('/api/v1/auth/me')).json();

    assert.equal(me.user.emailVerified, true);
  });
});

describe('no account discovery', () => {
  test('known, unknown, password-less and suspended addresses get the identical answer; only the eligible one is mailed', async () => {
    const known = await createAccount();
    const unknown = uniqueAddress();
    const googleOnly = uniqueAddress();
    const suspended = await createAccount();

    await database.pool.query('INSERT INTO users (email, email_normalized) VALUES ($1, $1)', [googleOnly]);
    await database.pool.query("UPDATE users SET status = 'suspended' WHERE email_normalized = $1", [suspended]);

    const answers = [];

    for (const email of [known, unknown, googleOnly, suspended]) {
      const response = await requestReset(email);

      answers.push(JSON.stringify({ status: response.status, body: await response.json() }));
    }

    assert.equal(new Set(answers).size, 1, answers.join(' / '));
    assert.equal(answers[0], JSON.stringify({ status: 202, body: { status: 'accepted' } }));

    assert.equal(await resetEmailCount(known), 1);
    assert.equal(await resetEmailCount(unknown), 0);
    assert.equal(await resetEmailCount(googleOnly), 0, 'no password enrolment through reset');
    assert.equal(await resetEmailCount(suspended), 0);
  });
});

describe('reset tokens', () => {
  test('cannot be used twice', async () => {
    const email = await createAccount();

    await requestReset(email);

    const token = await resetTokenFor(email);

    assert.equal((await resetPassword(token)).status, 204);

    const reused = await resetPassword(token, 'yet another passphrase');

    assert.equal(reused.status, 400);
    assert.equal((await errorOf(reused)).code, 'TOKEN_USED');
    assert.equal((await signIn(email, 'yet another passphrase')).status, 401);
  });

  test('concurrent use of one token changes the password exactly once', async () => {
    const email = await createAccount();

    await requestReset(email);

    const token = await resetTokenFor(email);
    const candidates = Array.from({ length: 5 }, (_, i) => `concurrent passphrase ${i}`);

    const responses = await Promise.all(candidates.map((password) => resetPassword(token, password)));
    const winners = candidates.filter((_, i) => responses[i].status === 204);

    assert.equal(winners.length, 1);

    for (const [i, response] of responses.entries()) {
      if (response.status !== 204) assert.equal((await errorOf(response)).code, 'TOKEN_USED', candidates[i]);
    }

    assert.equal((await signIn(email, winners[0])).status, 200);

    const { rows } = await database.pool.query('SELECT session_version FROM users WHERE email_normalized = $1', [email]);

    assert.equal(rows[0].session_version, 2, 'sessions revoked once');
  });

  test('expired tokens fail and leave the password unchanged', async () => {
    const email = await createAccount();

    await requestReset(email);

    const token = await resetTokenFor(email);

    await database.pool.query(
      "UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE purpose = 'reset' AND user_id = (SELECT id FROM users WHERE email_normalized = $1)",
      [email],
    );

    const response = await resetPassword(token);

    assert.equal(response.status, 400);
    assert.equal((await errorOf(response)).code, 'TOKEN_EXPIRED');
    assert.equal((await signIn(email, OLD_PASSWORD)).status, 200);
  });

  test('a newer reset request revokes the earlier link', async () => {
    const email = await createAccount();

    await requestReset(email);

    const first = await resetTokenFor(email);

    await requestReset(email);

    const second = await resetTokenFor(email);

    assert.notEqual(first, second);
    assert.equal((await errorOf(await resetPassword(first))).code, 'TOKEN_USED');
    assert.equal((await resetPassword(second)).status, 204);
  });

  test('a verification token cannot be used as a reset token', async () => {
    const email = uniqueAddress();

    await (await newBrowser(api.server)).post('/api/v1/auth/register', { email, password: OLD_PASSWORD });
    await outbox.processBatch();

    const [verification] = await messagesTo(email);
    const response = await resetPassword(tokenFromEmail(verification));

    assert.equal(response.status, 400);
    assert.equal((await errorOf(response)).code, 'TOKEN_INVALID');
  });

  test('the new password must follow the policy, and a rejected one does not consume the token', async () => {
    const email = await createAccount();

    await requestReset(email);

    const token = await resetTokenFor(email);
    const tooShort = await resetPassword(token, 'short');

    assert.equal(tooShort.status, 400);
    assert.equal((await errorOf(tooShort)).fields[0].path, 'newPassword');
    assert.equal((await resetPassword(token)).status, 204, 'the token still works');
  });
});

describe('protections', () => {
  test('forgot and reset need the CSRF token', async () => {
    const browser = await newBrowser(api.server);

    browser.csrfToken = null;

    for (const [path, body] of [
      ['/api/v1/auth/password/forgot', { email: uniqueAddress() }],
      ['/api/v1/auth/password/reset', { token: 'x', newPassword: NEW_PASSWORD }],
    ]) {
      assert.equal((await browser.post(path, body)).status, 403, path);
    }
  });

  test('passwords and tokens never reach the logs', async () => {
    const email = await createAccount();

    await requestReset(email);

    const token = await resetTokenFor(email);

    await resetPassword(token);

    const logs = JSON.stringify(api.logLines);

    for (const secret of [OLD_PASSWORD, NEW_PASSWORD, token]) {
      assert.equal(logs.includes(secret), false, secret);
    }
  });
});
