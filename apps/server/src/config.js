import { z } from 'zod';

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
});

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
  });
}
