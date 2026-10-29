import { z } from 'zod';

// Rate-limit policies (technical-design §6). Every number is a provisional default, not an
// approved requirement; RATE_LIMIT_POLICIES (JSON) replaces any policy's buckets without a
// code change. A request must pass every bucket of its policy.
//
// Bucket subjects:
//   network: client IPv4 address or IPv6 /64      user: authenticated user id
//   account: normalised email being acted on      global: one shared counter

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DEFAULT_POLICIES = Object.freeze({
  // Guests creating links.
  guestCreate: [
    { subject: 'network', limit: 5, windowSeconds: HOUR },
    { subject: 'network', limit: 20, windowSeconds: DAY },
  ],

  // Not a quota: exceeding it marks guest creation as suspicious and requires a challenge.
  guestCreateRisk: [
    { subject: 'network', limit: 2, windowSeconds: 10 * MINUTE },
  ],

  // Registered users creating links, plus a per-network safety limit.
  registeredCreate: [
    { subject: 'user', limit: 10, windowSeconds: MINUTE },
    { subject: 'user', limit: 100, windowSeconds: DAY },
    { subject: 'network', limit: 300, windowSeconds: DAY },
  ],

  // Password and Google sign-in. Temporary cooldowns, never a permanent lockout.
  login: [
    { subject: 'network', limit: 20, windowSeconds: 15 * MINUTE },
    { subject: 'account', limit: 10, windowSeconds: 15 * MINUTE },
  ],

  // Starting a Google sign-in, link or re-authentication attempt.
  googleAttempt: [
    { subject: 'network', limit: 20, windowSeconds: 15 * MINUTE },
  ],

  // Verification and password-reset emails, with a global budget protecting the mail quota.
  accountEmail: [
    { subject: 'account', limit: 3, windowSeconds: HOUR },
    { subject: 'network', limit: 10, windowSeconds: HOUR },
    { subject: 'global', limit: 200, windowSeconds: HOUR },
  ],

  // Owners changing their links.
  linkUpdate: [
    { subject: 'user', limit: 60, windowSeconds: MINUTE },
  ],

  // Dashboard and analytics reads (tuned against normal polling).
  memberRead: [
    { subject: 'user', limit: 120, windowSeconds: MINUTE },
  ],

  // Public abuse reports.
  report: [
    { subject: 'network', limit: 5, windowSeconds: HOUR },
  ],
});

const BucketSchema = z.strictObject({
  subject: z.enum(['network', 'user', 'account', 'global']),
  limit: z.number().int().positive(),
  windowSeconds: z.number().int().positive().max(30 * DAY),
});

const OverridesSchema = z.partialRecord(
  z.enum(Object.keys(DEFAULT_POLICIES)),
  z.array(BucketSchema).min(1),
);

// Merges JSON overrides (from RATE_LIMIT_POLICIES) into the defaults.
export function resolvePolicies(overridesJson) {
  if (!overridesJson) return DEFAULT_POLICIES;

  let parsedJson;

  try {
    parsedJson = JSON.parse(overridesJson);
  } catch {
    throw new Error('RATE_LIMIT_POLICIES is not valid JSON');
  }

  const result = OverridesSchema.safeParse(parsedJson);

  if (!result.success) {
    throw new Error(`RATE_LIMIT_POLICIES is invalid: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }

  return Object.freeze({ ...DEFAULT_POLICIES, ...result.data });
}
