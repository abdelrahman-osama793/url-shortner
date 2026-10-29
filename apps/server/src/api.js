// API process entry point and composition root: builds every dependency and wires them
// together. Reading order for any endpoint: routes → controller → service → repository.

import { once } from 'node:events';
import { promisify } from 'node:util';

import { loadConfig } from './config.js';
import { createApp } from './http/app.js';
import { createAuthController } from './http/controllers/auth.controller.js';
import { createDevChallengeController } from './http/controllers/dev-challenge.controller.js';
import { createGoogleController } from './http/controllers/google.controller.js';
import { createHealthController } from './http/controllers/health.controller.js';
import { createLinksController } from './http/controllers/links.controller.js';
import { createRedirectsController } from './http/controllers/redirects.controller.js';
import { createAuthGuards } from './http/middleware/session.js';
import { createAuthRouter } from './http/routes/auth.routes.js';
import { createDevChallengeRouter } from './http/routes/dev-challenge.routes.js';
import { createGoogleRouter } from './http/routes/google.routes.js';
import { createHealthRouter } from './http/routes/health.routes.js';
import { createLinksRouter } from './http/routes/links.routes.js';
import { createRedirectRouter } from './http/routes/redirects.routes.js';
import { createLogger } from './infra/logger.js';
import { createPool, isDatabaseReachable } from './infra/postgres.js';
import { connectInBackground, createRedisClient } from './infra/redis.js';
import { onShutdown, runMain } from './lifecycle.js';
import { createChallengeGuard, createDevChallengeVerifier } from './modules/abuse/challenge.service.js';
import { createRateLimiter } from './modules/abuse/rate-limit.service.js';
import { createAccountService } from './modules/accounts/accounts.service.js';
import { createClickCaptureService } from './modules/analytics/click-capture.service.js';
import { createGoogleAttemptsService } from './modules/accounts/google-attempts.service.js';
import { createGoogleIdentityService } from './modules/accounts/google-identity.service.js';
import { createGoogleSignInService } from './modules/accounts/google-sign-in.service.js';
import { createLinkService } from './modules/links/links.service.js';
import { createRedirectService } from './modules/links/redirects.service.js';
import { createSessionService } from './modules/sessions/sessions.service.js';

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

  // Services: business rules and data access.
  const sessionService = createSessionService({ redis, lifetimes: config.sessionLifetimes });
  const limiter = createRateLimiter({ redis, secret: config.rateLimit.secret, policies: config.rateLimit.policies });
  const linkService = createLinkService({ pool, publicBaseUrl: config.publicBaseUrl, cursorSecret: config.rateLimit.secret, logger });
  const redirectService = createRedirectService({ pool });
  const clickCapture = createClickCaptureService({
    redis,
    queueCap: config.analytics.queueCap,
    publishTimeoutMs: config.analytics.publishTimeoutMs,
    logger,
  });
  const accountService = createAccountService({
    pool,
    outboxKey: config.mail.outboxKey,
    tokenLifetimes: config.tokenLifetimes,
    logger,
  });

  // Only the development challenge provider exists; config.js refuses production (T37).
  const verifier = createDevChallengeVerifier({ secret: config.rateLimit.secret });
  const challengeGuard = createChallengeGuard({ redis, verifier });

  // HTTP: guards (reusable middleware), controllers (request → service → response), routers.
  const guards = createAuthGuards({ sessionService, pool });

  const routers = [
    createHealthRouter({ controller: createHealthController({ checkDatabase: () => isDatabaseReachable(pool) }) }),
    createRedirectRouter({
      controller: createRedirectsController({ redirectService, clickCapture, countryHeader: config.analytics.countryHeader }),
    }),
    createAuthRouter({ controller: createAuthController({ sessionService, accountService }), guards, limiter }),
    createLinksRouter({ controller: createLinksController({ linkService }), guards, limiter, challengeGuard }),
  ];

  if (config.google.clientId) {
    const googleAttempts = createGoogleAttemptsService({ redis });
    const googleSignIn = createGoogleSignInService({
      pool,
      attempts: googleAttempts,
      identity: createGoogleIdentityService({ clientId: config.google.clientId }),
      outboxKey: config.mail.outboxKey,
      tokenLifetimes: config.tokenLifetimes,
      logger,
    });

    routers.push(createGoogleRouter({
      controller: createGoogleController({ googleAttempts, googleSignIn, sessionService }),
      guards,
      limiter,
    }));
  } else {
    logger.warn('GOOGLE_CLIENT_ID not set: Google sign-in is disabled');
  }

  if (config.challenge.provider === 'dev') {
    routers.push(createDevChallengeRouter({ controller: createDevChallengeController({ verifier }) }));
    logger.warn('development challenge provider enabled: challenges are mock, not real human verification');
  }

  const app = createApp({ config, logger, routers });
  const server = await listen(app, config.port);

  logger.info({ port: config.port }, 'api listening');

  const stopCaptureStats = clickCapture.startStatsLog();

  onShutdown(async () => {
    stopCaptureStats();
    await close(server);
    await pool.end();
    redis.destroy();
  }, logger);
}

runMain(main, logger);
