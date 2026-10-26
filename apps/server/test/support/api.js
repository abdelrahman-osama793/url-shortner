import { createApp } from '../../src/http/app.js';
import { createAuthGuards } from '../../src/http/middleware/session.js';
import { createAuthRouter } from '../../src/http/routes/auth.js';
import { createDevChallengeRouter } from '../../src/http/routes/dev-challenge.js';
import { createLinksRouter } from '../../src/http/routes/links.js';
import { createRedirectRouter } from '../../src/http/routes/redirects.js';
import { createChallengeGuard, createDevChallengeVerifier } from '../../src/modules/abuse/challenge.js';
import { DEFAULT_POLICIES } from '../../src/modules/abuse/policies.js';
import { createRateLimiter } from '../../src/modules/abuse/rate-limiter.js';
import { createAccountService } from '../../src/modules/accounts/service.js';
import { createRedirectResolver } from '../../src/modules/links/redirects.js';
import { createLinkService } from '../../src/modules/links/service.js';
import { createSessionStore } from '../../src/modules/sessions/store.js';

import { createCapturingLogger, startServer, testConfig } from './http.js';

const SECRET = 'integration-test-secret-32-characters';

// The real routers and middleware, wired the same way as src/api.js, with injectable
// dependencies. Trusts one proxy hop, so tests can simulate client addresses with
// X-Forwarded-For. Returns { server, store, logLines }.
export async function startTestApi({ database, redis, pool = database.pool, redisClient = redis.client, policies = {} }) {
  const config = testConfig({ TRUST_PROXY_HOPS: '1' });
  const { logger, lines } = createCapturingLogger();

  const store = createSessionStore({ redis: redisClient, lifetimes: config.sessionLifetimes, keyPrefix: redis.keyPrefix });
  const guards = createAuthGuards({ store, pool });
  const limiter = createRateLimiter({ redis: redisClient, secret: SECRET, policies: { ...DEFAULT_POLICIES, ...policies }, keyPrefix: redis.keyPrefix });
  const verifier = createDevChallengeVerifier({ secret: SECRET });
  const challengeGuard = createChallengeGuard({ redis: redisClient, verifier, keyPrefix: redis.keyPrefix });
  const linkService = createLinkService({ pool, publicBaseUrl: config.publicBaseUrl, logger });
  const accountService = createAccountService({ pool, outboxKey: config.mail.outboxKey, tokenLifetimes: config.tokenLifetimes, logger });

  const app = createApp({
    config,
    logger,
    routers: [
      createRedirectRouter({ resolver: createRedirectResolver({ pool }) }),
      createAuthRouter({ store, guards, limiter, accountService }),
      createLinksRouter({ guards, limiter, challengeGuard, linkService }),
      createDevChallengeRouter({ verifier }),
    ],
  });

  const server = await startServer(app);

  return { server, store, logLines: lines, outboxKey: config.mail.outboxKey };
}
