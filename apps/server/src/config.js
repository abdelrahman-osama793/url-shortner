import { z } from 'zod';

import { resolvePolicies } from './modules/abuse/policies.js';
import { parseOutboxKey } from './modules/email/payload-crypto.js';

// Reads and validates environment variables once at startup.
// Every other module receives configuration as an argument instead of reading process.env.

const commaSeparatedOrigins = z
  .string()
  .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
  .pipe(z.array(z.url({ protocol: /^https?$/ })).min(1));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  // Public origin users see, e.g. https://shortlist.example. Short URLs are built from it.
  PUBLIC_BASE_URL: z.url({ protocol: /^https?$/ }),

  // Origins allowed to send state-changing browser requests. Defaults to PUBLIC_BASE_URL's origin.
  ALLOWED_ORIGINS: commaSeparatedOrigins.optional(),

  // Number of reverse proxies in front of the API whose X-Forwarded-For can be trusted.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

  REDIS_URL: z.url({ protocol: /^rediss?$/ }),

  // Keys the HMAC that hashes rate-limit subjects (IPs, emails) before they reach Redis.
  RATE_LIMIT_SECRET: z.string().min(32, 'must be at least 32 characters'),

  // Optional JSON replacing default policies, e.g. {"guestCreate":[{"subject":"network","limit":10,"windowSeconds":3600}]}
  RATE_LIMIT_POLICIES: z.string().optional(),

  // Human-verification provider. Only the development stand-in exists until T37.
  CHALLENGE_PROVIDER: z.enum(['dev']).optional(),

  // Session lifetimes (provisional, technical-design §4): idle timeout and absolute limit.
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(24 * 60),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(7 * 24),
  ADMIN_SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(60),
  ADMIN_SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),
  ANONYMOUS_SESSION_MINUTES: z.coerce.number().int().positive().default(120),

  // Outgoing mail. In development this is Mailpit, which never delivers (real provider: T37).
  SMTP_URL: z.url({ protocol: /^smtps?$/ }),
  MAIL_FROM: z.string().min(3).default('Shortlist <no-reply@shortlist.local>'),

  // 32 random bytes, base64. Encrypts one-time tokens inside queued emails.
  EMAIL_OUTBOX_KEY: z.string(),

  // One-time token lifetimes (provisional, technical-design §4).
  VERIFICATION_TOKEN_HOURS: z.coerce.number().int().positive().default(24),
  RESET_TOKEN_MINUTES: z.coerce.number().int().positive().default(30),
});

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

// The development challenge verifier accepts tokens anyone can mint from a dev-only
// endpoint, so it must never run in production. No real provider exists yet (T36/T37),
// so production configuration is refused rather than silently running unprotected.
function resolveChallengeProvider(environment, requested) {
  if (environment === 'production') {
    throw new Error('Invalid configuration: CHALLENGE_PROVIDER: no production challenge provider is configured yet (T37)');
  }

  return requested ?? 'dev';
}

function describeIssues(error) {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

export function loadConfig(env = process.env) {
  const parsed = EnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${describeIssues(parsed.error)}`);
  }

  const vars = parsed.data;
  const publicOrigin = new URL(vars.PUBLIC_BASE_URL).origin;
  const allowedOrigins = (vars.ALLOWED_ORIGINS ?? [publicOrigin]).map((origin) => new URL(origin).origin);

  return Object.freeze({
    environment: vars.NODE_ENV,
    port: vars.PORT,
    logLevel: vars.LOG_LEVEL,
    database: Object.freeze({
      url: vars.DATABASE_URL,
      poolMax: vars.DATABASE_POOL_MAX,
    }),
    publicBaseUrl: vars.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    allowedOrigins: Object.freeze(allowedOrigins),
    trustProxyHops: vars.TRUST_PROXY_HOPS,
    redisUrl: vars.REDIS_URL,
    rateLimit: Object.freeze({
      secret: vars.RATE_LIMIT_SECRET,
      policies: resolvePolicies(vars.RATE_LIMIT_POLICIES),
    }),
    sessionLifetimes: Object.freeze({
      member: { idleMs: vars.SESSION_IDLE_MINUTES * MINUTE_MS, absoluteMs: vars.SESSION_ABSOLUTE_HOURS * HOUR_MS },
      admin: { idleMs: vars.ADMIN_SESSION_IDLE_MINUTES * MINUTE_MS, absoluteMs: vars.ADMIN_SESSION_ABSOLUTE_HOURS * HOUR_MS },
      anonymous: { idleMs: vars.ANONYMOUS_SESSION_MINUTES * MINUTE_MS, absoluteMs: vars.ANONYMOUS_SESSION_MINUTES * MINUTE_MS },
    }),
    mail: Object.freeze({
      smtpUrl: vars.SMTP_URL,
      from: vars.MAIL_FROM,
      outboxKey: parseOutboxKey(vars.EMAIL_OUTBOX_KEY),
    }),
    tokenLifetimes: Object.freeze({
      verificationMs: vars.VERIFICATION_TOKEN_HOURS * HOUR_MS,
      resetMs: vars.RESET_TOKEN_MINUTES * MINUTE_MS,
    }),
    challenge: Object.freeze({
      provider: resolveChallengeProvider(vars.NODE_ENV, vars.CHALLENGE_PROVIDER),
    }),
  });
}
