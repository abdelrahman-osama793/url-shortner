// API process entry point: builds every dependency and wires them together.

import { once } from 'node:events';
import { promisify } from 'node:util';

import { loadConfig } from './config.js';
import { createApp } from './http/app.js';
import { createAuthGuards } from './http/middleware/session.js';
import { createAuthRouter } from './http/routes/auth.js';
import { createDevChallengeRouter } from './http/routes/dev-challenge.js';
import { createHealthRouter } from './http/routes/health.js';
import { createLinksRouter } from './http/routes/links.js';
import { createRedirectRouter } from './http/routes/redirects.js';
import { createLogger } from './infra/logger.js';
import { createPool, isDatabaseReachable } from './infra/postgres.js';
import { connectInBackground, createRedisClient } from './infra/redis.js';
import { onShutdown, runMain } from './lifecycle.js';
import { createChallengeGuard, createDevChallengeVerifier } from './modules/abuse/challenge.js';
import { createRateLimiter } from './modules/abuse/rate-limiter.js';
import { createRedirectResolver } from './modules/links/redirects.js';
import { createLinkService } from './modules/links/service.js';
import { createSessionStore } from './modules/sessions/store.js';

// Created before configuration so that configuration errors are logged too.
const logger = createLogger();

// once() resolves on 'listening' and rejects if 'error' (e.g. EADDRINUSE) fires first.
async function listen(app, port) {
  const server = app.listen(port);

  await once(server, 'listening');

  return server;
}

async function close(server) {
  const closeServer = promisify(server.close.bind(server));

  await closeServer();
}

async function main() {
  const config = loadConfig();

  logger.level = config.logLevel;

  const pool = createPool({
    databaseUrl: config.database.url,
    maxConnections: config.database.poolMax,
    logger,
  });

  // Redis connects in the background: redirects keep working while it is down, and
  // Redis-backed operations answer 503 until it is back.
  const redis = createRedisClient({ url: config.redisUrl, logger });

  connectInBackground(redis, logger);

  const store = createSessionStore({ redis, lifetimes: config.sessionLifetimes });
  const guards = createAuthGuards({ store, pool });
  const limiter = createRateLimiter({ redis, secret: config.rateLimit.secret, policies: config.rateLimit.policies });

  // Only the development challenge provider exists; config.js refuses production (T37).
  const verifier = createDevChallengeVerifier({ secret: config.rateLimit.secret });
  const challengeGuard = createChallengeGuard({ redis, verifier });

  const linkService = createLinkService({ pool, publicBaseUrl: config.publicBaseUrl, logger });

  const routers = [
    createHealthRouter({ checkDatabase: () => isDatabaseReachable(pool) }),
    createRedirectRouter({ resolver: createRedirectResolver({ pool }) }),
    createAuthRouter({ store, guards }),
    createLinksRouter({ guards, limiter, challengeGuard, linkService }),
  ];

  if (config.challenge.provider === 'dev') {
    routers.push(createDevChallengeRouter({ verifier }));
    logger.warn('development challenge provider enabled: challenges are mock, not real human verification');
  }

  const app = createApp({ config, logger, routers });
  const server = await listen(app, config.port);

  logger.info({ port: config.port }, 'api listening');

  onShutdown(async () => {
    await close(server);
    await pool.end();
    redis.destroy();
  }, logger);
}

runMain(main, logger);
