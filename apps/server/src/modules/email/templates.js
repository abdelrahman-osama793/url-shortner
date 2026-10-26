import { OUTBOX_KINDS } from './outbox.js';

// Email content per outbox kind. Links carry the token in the URL fragment (#token=…):
// fragments are not sent to servers or logged by proxies, and the page POSTs the token
// instead of consuming it on load, so link scanners cannot use it up (api-contracts.md).

const TEMPLATES = {
  [OUTBOX_KINDS.verification]: {
    subject: 'Confirm your Shortlist email address',
    path: '/verify-email',
    text: (link, expires) => [
      'Welcome to Shortlist.',
      '',
      'Confirm your email address to start creating and managing links:',
      link,
      '',
      `This link expires on ${expires}. If you did not sign up, you can ignore this email.`,
    ].join('\n'),
  },
  [OUTBOX_KINDS.reset]: {
    subject: 'Reset your Shortlist password',
    path: '/reset-password',
    text: (link, expires) => [
      'Someone asked to reset the password for this Shortlist account.',
      '',
      'Choose a new password here:',
      link,
      '',
      `This link works once and expires on ${expires}. If you did not ask for this, ignore this email; your password stays the same.`,
    ].join('\n'),
  },
};

// e.g. "26 Oct 2026, 18:30 UTC". Stated explicitly so the text matches the configured lifetime.
function formatExpiry(isoDate) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(isoDate)) + ' UTC';
}

export function renderEmail(kind, { publicBaseUrl, token, expiresAt }) {
  const template = TEMPLATES[kind];

  if (!template) throw new Error(`no email template for kind ${kind}`);

  const link = `${publicBaseUrl}${template.path}#token=${encodeURIComponent(token)}`;

  return { subject: template.subject, text: template.text(link, formatExpiry(expiresAt)) };
}
