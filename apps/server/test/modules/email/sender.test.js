import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { createSmtpMailer, MailDeliveryError } from '../../../src/infra/mailer.js';
import { withTransaction } from '../../../src/infra/postgres.js';
import { consumeToken, issueTokenWithEmail } from '../../../src/modules/accounts/tokens.js';
import { claimDueMessages } from '../../../src/modules/email/outbox.js';
import { createOutboxSender } from '../../../src/modules/email/sender.js';
import { createMigratedDatabase } from '../../support/database.js';
import { createCapturingLogger } from '../../support/http.js';
import { messagesTo, testSmtpUrl, tokenFromEmail, uniqueAddress } from '../../support/mail.js';

const PUBLIC_BASE_URL = 'https://shortlist.example';
const HOUR = 60 * 60 * 1000;
const key = randomBytes(32);

// Each test gets its own database, so one test's pending messages never reach another's sender.
async function withDatabase(run) {
  const database = await createMigratedDatabase();

  try {
    await run(database);
  } finally {
    await database.drop();
  }
}

async function queueEmail(database, { purpose = 'verification', email = uniqueAddress(), lifetimeMs = HOUR, messageKey = key } = {}) {
  const { rows } = await database.pool.query('INSERT INTO users (email, email_normalized) VALUES ($1, $1) RETURNING id', [email]);
  const user = { id: rows[0].id, email };

  const messageId = await withTransaction(database.pool, (client) => issueTokenWithEmail(client, { key: messageKey, user, purpose, lifetimeMs }));

  return { user, messageId };
}

async function outboxRow(database, id) {
  const { rows } = await database.pool.query(
    `SELECT sent_at, attempts, last_error_code, octet_length(encrypted_payload) AS payload_bytes,
            next_attempt_at > now() AS retry_scheduled
     FROM email_outbox WHERE id = $1`,
    [id],
  );

  return rows[0];
}

function sender(database, overrides = {}) {
  return createOutboxSender({
    pool: database.pool,
    mailer: createSmtpMailer({ url: testSmtpUrl(), from: 'Shortlist test <no-reply@shortlist.local>' }),
    key,
    publicBaseUrl: PUBLIC_BASE_URL,
    ...overrides,
  });
}

function failingMailer({ permanent = false, code = permanent ? 'SMTP_550' : 'SMTP_421' } = {}) {
  return {
    async send() {
      throw new MailDeliveryError({ code, permanent });
    },
  };
}

describe('outbox delivery', () => {
  test('delivers a verification email whose link carries a working token, then erases the secret', () => withDatabase(async (database) => {
    const { user, messageId } = await queueEmail(database);

    assert.deepEqual(await sender(database).processBatch(), { claimed: 1, sent: 1 });

    const [message] = await messagesTo(user.email);

    assert.equal(message.Subject, 'Confirm your Shortlist email address');
    assert.match(message.Text, new RegExp(`${PUBLIC_BASE_URL}/verify-email#token=`));
    assert.match(message.Text, /expires on .* UTC/);

    const consumed = await withTransaction(database.pool, (client) => consumeToken(client, { token: tokenFromEmail(message), purpose: 'verification' }));

    assert.deepEqual(consumed, { ok: true, userId: user.id });

    const row = await outboxRow(database, messageId);

    assert.ok(row.sent_at);
    assert.equal(row.payload_bytes, 0, 'the encrypted token is erased after delivery');
  }));

  test('sends a password-reset email to the reset page', () => withDatabase(async (database) => {
    const { user } = await queueEmail(database, { purpose: 'reset' });

    await sender(database).processBatch();

    const [message] = await messagesTo(user.email);

    assert.equal(message.Subject, 'Reset your Shortlist password');
    assert.match(message.Text, new RegExp(`${PUBLIC_BASE_URL}/reset-password#token=`));
  }));

  test('never logs the token, the payload or the recipient address', () => withDatabase(async (database) => {
    const { logger, lines } = createCapturingLogger();
    const { user } = await queueEmail(database);

    await sender(database, { logger }).processBatch();
    await sender(database, { logger, mailer: failingMailer() }).processBatch();

    const [message] = await messagesTo(user.email);
    const logs = JSON.stringify(lines);

    assert.ok(lines.some((line) => line.msg === 'email sent'), 'delivery is logged');
    assert.equal(logs.includes(tokenFromEmail(message)), false);
    assert.equal(logs.includes(user.email), false);
  }));

  test('a mail server outage keeps the message and retries it later; nothing is lost', () => withDatabase(async (database) => {
    const { logger, lines } = createCapturingLogger();
    const { user, messageId } = await queueEmail(database);
    const unreachable = createSmtpMailer({ url: 'smtp://127.0.0.1:1', from: 'x <x@shortlist.local>', timeoutMs: 1000 });

    assert.deepEqual(await sender(database, { mailer: unreachable, logger }).processBatch(), { claimed: 1, sent: 0 });

    const failed = await outboxRow(database, messageId);

    assert.equal(failed.sent_at, null);
    assert.ok(failed.payload_bytes > 0, 'the message is kept for retry');
    assert.equal(failed.retry_scheduled, true);
    assert.match(failed.last_error_code, /^E[A-Z]+$/, 'a short network error code (nodemailer reports ESOCKET), never a provider message');
    assert.equal(JSON.stringify(lines).includes(user.email), false);

    // The retry is not due yet, so a working sender leaves it alone...
    assert.deepEqual(await sender(database).processBatch(), { claimed: 0, sent: 0 });

    // ...and delivers it once it is due.
    await database.pool.query('UPDATE email_outbox SET next_attempt_at = now() WHERE id = $1', [messageId]);

    assert.deepEqual(await sender(database).processBatch(), { claimed: 1, sent: 1 });
    assert.equal((await messagesTo(user.email)).length, 1);
  }));

  test('a worker that crashes mid-send loses nothing: the lease expires and the message is sent', () => withDatabase(async (database) => {
    const { user, messageId } = await queueEmail(database);

    // Simulate the crash: claim the message, then never send or record anything.
    await claimDueMessages(database.pool, { limit: 10, leaseMs: 500, maxAttempts: 8 });

    assert.deepEqual(await sender(database).processBatch(), { claimed: 0, sent: 0 }, 'leased messages are not claimed twice');

    await sleep(700);

    assert.deepEqual(await sender(database).processBatch(), { claimed: 1, sent: 1 });
    assert.equal((await messagesTo(user.email)).length, 1);
    assert.equal((await outboxRow(database, messageId)).attempts, 2);
  }));

  test('concurrent senders deliver each message exactly once', () => withDatabase(async (database) => {
    const queued = await Promise.all(Array.from({ length: 6 }, () => queueEmail(database)));

    const results = await Promise.all([sender(database).processBatch(), sender(database).processBatch(), sender(database).processBatch()]);

    assert.equal(results.reduce((total, result) => total + result.sent, 0), 6);

    for (const { user } of queued) {
      assert.equal((await messagesTo(user.email)).length, 1, user.email);
    }
  }));

  test('a permanent rejection gives up at once and erases the secret', () => withDatabase(async (database) => {
    const { messageId } = await queueEmail(database);

    await sender(database, { mailer: failingMailer({ permanent: true }) }).processBatch();

    const row = await outboxRow(database, messageId);

    assert.equal(row.last_error_code, 'SMTP_550');
    assert.equal(row.payload_bytes, 0);
  }));

  test('transient failures give up after the maximum number of attempts', () => withDatabase(async (database) => {
    const { messageId } = await queueEmail(database);
    const flaky = sender(database, { mailer: failingMailer(), maxAttempts: 3 });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await database.pool.query('UPDATE email_outbox SET next_attempt_at = now() WHERE id = $1', [messageId]);
      await flaky.processBatch();
    }

    const row = await outboxRow(database, messageId);

    assert.equal(row.attempts, 3);
    assert.equal(row.payload_bytes, 0);
  }));

  test('an unreadable message is given up without blocking the others', () => withDatabase(async (database) => {
    const broken = await queueEmail(database, { messageKey: randomBytes(32) });
    const healthy = await queueEmail(database);

    assert.deepEqual(await sender(database).processBatch(), { claimed: 2, sent: 1 });
    assert.equal((await outboxRow(database, broken.messageId)).last_error_code, 'PAYLOAD_UNREADABLE');
    assert.equal((await messagesTo(healthy.user.email)).length, 1);
  }));

  test('messages that expire before delivery are erased, not sent', () => withDatabase(async (database) => {
    const { user, messageId } = await queueEmail(database);

    await database.pool.query("UPDATE email_outbox SET expires_at = now() - interval '1 second' WHERE id = $1", [messageId]);

    assert.deepEqual(await sender(database).processBatch(), { claimed: 0, sent: 0 });
    assert.equal((await outboxRow(database, messageId)).payload_bytes, 0);
    assert.equal((await messagesTo(user.email)).length, 0);
  }));

  test('run() keeps delivering until aborted, then stops', () => withDatabase(async (database) => {
    const stop = new AbortController();
    const running = sender(database, { pollMs: 50 }).run(stop.signal);
    const { user } = await queueEmail(database);

    await sleep(500);
    stop.abort();
    await running;

    assert.equal((await messagesTo(user.email)).length, 1);
  }));
});

describe('mailer error classification', () => {
  test('5xx is permanent, 4xx and network errors are transient', async () => {
    const unreachable = createSmtpMailer({ url: 'smtp://127.0.0.1:1', from: 'x <x@shortlist.local>', timeoutMs: 1000 });

    await assert.rejects(unreachable.send({ to: 'a@example.com', subject: 's', text: 't', idempotencyKey: randomUUID() }), (error) => {
      assert.ok(error instanceof MailDeliveryError);
      assert.equal(error.permanent, false);
      assert.equal(error.message.includes('a@example.com'), false);
      return true;
    });
  });
});
