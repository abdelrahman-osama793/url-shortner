import { domainToASCII } from 'node:url';

// Email normalisation for account uniqueness (database-schema.md, "Accounts and
// authentication"): trim, lower-case, and convert an internationalised domain to its ASCII
// (punycode) form so "Ünï.example" and "xn--n-yiab.example" are one domain.
// Dots and +suffixes are kept: whether they matter is up to each mail provider, and this
// policy does not claim universal mailbox equivalence.
// The address as the user typed it (trimmed) is kept separately for sending email.
export function normalizeEmail(email) {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');

  if (at <= 0 || at === trimmed.length - 1) return trimmed.toLowerCase();

  const local = trimmed.slice(0, at).toLowerCase();
  const domain = domainToASCII(trimmed.slice(at + 1).toLowerCase()) || trimmed.slice(at + 1).toLowerCase();

  return `${local}@${domain}`;
}
