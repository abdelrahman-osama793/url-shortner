import nodemailer from 'nodemailer';

// SMTP mail adapter. In development it points at Mailpit, which catches mail and never
// delivers it. A real provider (chosen in T36, verified in T37) plugs in by implementing the
// same send() shape; until then no real email is sent by this project.

export class MailDeliveryError extends Error {
  // `code` is safe to store and log (e.g. SMTP_550, ECONNREFUSED); the provider's message is
  // not, because it can contain the recipient address.
  constructor({ code, permanent, cause }) {
    super(`mail delivery failed: ${code}`, { cause });
    this.name = 'MailDeliveryError';
    this.code = code;
    this.permanent = permanent;
  }
}

function classify(error) {
  const smtpStatus = Number(error.responseCode);

  if (smtpStatus >= 500 && smtpStatus < 600) {
    return new MailDeliveryError({ code: `SMTP_${smtpStatus}`, permanent: true, cause: error });
  }

  if (smtpStatus >= 400 && smtpStatus < 500) {
    return new MailDeliveryError({ code: `SMTP_${smtpStatus}`, permanent: false, cause: error });
  }

  return new MailDeliveryError({ code: String(error.code ?? 'UNKNOWN').slice(0, 32), permanent: false, cause: error });
}

export function createSmtpMailer({ url, from, timeoutMs = 10_000 }) {
  const transport = nodemailer.createTransport(url, {
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });

  // `idempotencyKey` is the outbox message id. SMTP has no idempotency, but providers with an
  // HTTP API can use it to drop the duplicate sent after a worker crash.
  async function send({ to, subject, text, idempotencyKey }) {
    try {
      await transport.sendMail({
        from,
        to,
        subject,
        text,
        headers: { 'X-Shortlist-Message-Id': idempotencyKey },
      });
    } catch (error) {
      throw classify(error);
    }
  }

  return { send, close: () => transport.close() };
}
