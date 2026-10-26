import { setTimeout as sleep } from 'node:timers/promises';

import { MailDeliveryError } from '../../infra/mailer.js';

import { claimDueMessages, markFailed, markSent, purgeUndeliverable } from './outbox.repository.js';
import { decryptPayload } from './rules/payload-crypto.js';
import { renderEmail } from './email.templates.js';

// Delivers outbox messages (worker process). Per batch:
//   1. claim due messages with a lease, in one short transaction;
//   2. send each one with no database transaction open (database-schema.md);
//   3. record success (erasing the secret) or schedule a retry with exponential backoff.
// If the worker dies between sending and recording, the lease expires and the same message,
// with the same token, is sent again. A rare duplicate email is the accepted trade-off;
// losing a committed message is not.
//
// Logs carry message id, kind, attempt and error code only: never the token, the payload or
// the recipient address.

export function createOutboxSender({
  pool,
  mailer,
  key,
  publicBaseUrl,
  logger,
  batchSize = 20,
  leaseMs = 60_000,
  maxAttempts = 8,
  baseRetryMs = 30_000,
  maxRetryMs = 60 * 60_000,
  pollMs = 1000,
}) {
  const retryDelay = (attempts) => Math.min(baseRetryMs * 2 ** (attempts - 1), maxRetryMs);

  async function deliver(message) {
    const context = { messageId: message.id, kind: message.kind, attempt: message.attempts };

    let payload;

    try {
      payload = decryptPayload(key, message.id, message.encryptedPayload);
    } catch {
      // Wrong key or tampered row: retrying cannot help.
      await markFailed(pool, message.id, { errorCode: 'PAYLOAD_UNREADABLE', retryInMs: 0, giveUp: true });
      logger?.error(context, 'email payload unreadable; giving up');
      return false;
    }

    try {
      const { subject, text } = renderEmail(message.kind, { publicBaseUrl, ...payload });

      await mailer.send({ to: payload.to, subject, text, idempotencyKey: message.id });
    } catch (error) {
      const delivery = error instanceof MailDeliveryError ? error : null;
      const errorCode = delivery?.code ?? 'INTERNAL';
      const giveUp = Boolean(delivery?.permanent) || message.attempts >= maxAttempts;

      await markFailed(pool, message.id, { errorCode, retryInMs: retryDelay(message.attempts), giveUp });

      logger?.warn({ ...context, errorCode, giveUp }, giveUp ? 'email delivery failed; giving up' : 'email delivery failed; will retry');
      return false;
    }

    await markSent(pool, message.id);
    logger?.info(context, 'email sent');

    return true;
  }

  // One pass: erase undeliverable secrets, then claim and deliver a batch.
  // Returns { claimed, sent }.
  async function processBatch() {
    await purgeUndeliverable(pool, { maxAttempts });

    const messages = await claimDueMessages(pool, { limit: batchSize, leaseMs, maxAttempts });
    let sent = 0;

    for (const message of messages) {
      if (await deliver(message)) sent += 1;
    }

    return { claimed: messages.length, sent };
  }

  // Runs until `signal` aborts. A full batch means more may be waiting, so it loops at once;
  // otherwise it waits `pollMs`. Database errors are logged and retried after a pause.
  async function run(signal) {
    while (!signal.aborted) {
      let claimed = 0;

      try {
        ({ claimed } = await processBatch());
      } catch (error) {
        logger?.error({ err: error }, 'email outbox pass failed');
      }

      if (claimed < batchSize) {
        try {
          await sleep(pollMs, undefined, { signal });
        } catch {
          // Aborted while waiting: the loop condition ends the run.
        }
      }
    }
  }

  return { processBatch, run };
}
