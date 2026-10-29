import { createApp } from '../../src/http/app.js';
import { createAuthController } from '../../src/http/controllers/auth.controller.js';
import { createDevChallengeController } from '../../src/http/controllers/dev-challenge.controller.js';
import { createGoogleController } from '../../src/http/controllers/google.controller.js';
import { createLinksController } from '../../src/http/controllers/links.controller.js';
import { createRedirectsController } from '../../src/http/controllers/redirects.controller.js';
import { createAuthGuards } from '../../src/http/middleware/session.js';
import { createAuthRouter } from '../../src/http/routes/auth.routes.js';
import { createDevChallengeRouter } from '../../src/http/routes/dev-challenge.routes.js';
import { createGoogleRouter } from '../../src/http/routes/google.routes.js';
import { createLinksRouter } from '../../src/http/routes/links.routes.js';
import { createRedirectRouter } from '../../src/http/routes/redirects.routes.js';
import { createChallengeGuard, createDevChallengeVerifier } from '../../src/modules/abuse/challenge.service.js';
import { DEFAULT_POLICIES } from '../../src/modules/abuse/rate-limit.policies.js';
import { createRateLimiter } from '../../src/modules/abuse/rate-limit.service.js';
import { createAccountService } from '../../src/modules/accounts/accounts.service.js';
import { createClickCaptureService } from '../../src/modules/analytics/click-capture.service.js';
import { createGoogleAttemptsService } from '../../src/modules/accounts/google-attempts.service.js';
import { createGoogleSignInService } from '../../src/modules/accounts/google-sign-in.service.js';
import { createLinkService } from '../../src/modules/links/links.service.js';
import { createRedirectService } from '../../src/modules/links/redirects.service.js';
import { createSessionService } from '../../src/modules/sessions/sessions.service.js';

import { createCapturingLogger, startServer, testConfig } from './http.js';

const SECRET = 'integration-test-secret-32-characters';

// The real routers, controllers, middleware and services, wired the same way as src/api.js,
// with injectable dependencies. Trusts one proxy hop, so tests can simulate client addresses
// with X-Forwarded-For. Pass `googleIdentity` (see support/google.js) to enable Google sign-in and
// `capture` options to tune click capture (e.g. { queueCap }).
// Returns { server, sessionService, clickCapture, logLines, outboxKey }.
export async function startTestApi({ database, redis, pool = database.pool, redisClient = redis.client, policies = {}, googleIdentity = null, capture = {} }) {
  const config = testConfig({ TRUST_PROXY_HOPS: '1' });
  const { logger, lines } = createCapturingLogger();

  const sessionService = createSessionService({ redis: redisClient, lifetimes: config.sessionLifetimes, keyPrefix: redis.keyPrefix });
  const limiter = createRateLimiter({ redis: redisClient, secret: SECRET, policies: { ...DEFAULT_POLICIES, ...policies }, keyPrefix: redis.keyPrefix });
  const verifier = createDevChallengeVerifier({ secret: SECRET });
  const challengeGuard = createChallengeGuard({ redis: redisClient, verifier, keyPrefix: redis.keyPrefix });
  const linkService = createLinkService({ pool, publicBaseUrl: config.publicBaseUrl, cursorSecret: SECRET, logger });
  const redirectService = createRedirectService({ pool });
  const clickCapture = createClickCaptureService({ redis: redisClient, keyPrefix: redis.keyPrefix, logger, ...capture });
  const accountService = createAccountService({ pool, outboxKey: config.mail.outboxKey, tokenLifetimes: config.tokenLifetimes, logger });
  const guards = createAuthGuards({ sessionService, pool });

  const routers = [
    createRedirectRouter({ controller: createRedirectsController({ redirectService, clickCapture, countryHeader: capture.countryHeader }) }),
    createAuthRouter({ controller: createAuthController({ sessionService, accountService }), guards, limiter }),
    createLinksRouter({ controller: createLinksController({ linkService }), guards, limiter, challengeGuard }),
    createDevChallengeRouter({ controller: createDevChallengeController({ verifier }) }),
  ];

  if (googleIdentity) {
    const googleAttempts = createGoogleAttemptsService({ redis: redisClient, keyPrefix: redis.keyPrefix });
    const googleSignIn = createGoogleSignInService({
      pool,
      attempts: googleAttempts,
      identity: googleIdentity,
      outboxKey: config.mail.outboxKey,
      tokenLifetimes: config.tokenLifetimes,
      logger,
    });

    routers.push(createGoogleRouter({ controller: createGoogleController({ googleAttempts, googleSignIn, sessionService }), guards, limiter }));
  }

  const app = createApp({ config, logger, routers });

  const server = await startServer(app);

  return { server, sessionService, clickCapture, logLines: lines, outboxKey: config.mail.outboxKey };
}
