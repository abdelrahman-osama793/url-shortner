import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { Router } from 'express';
import { z } from 'zod';

import { createApp } from '../../src/http/app.js';
import { requireChallengeWhenSuspicious } from '../../src/http/middleware/challenge.js';
import { rateLimit } from '../../src/http/middleware/rate-limit.js';
import { validateBody } from '../../src/http/middleware/validate.js';
import { createDevChallengeController } from '../../src/http/controllers/dev-challenge.controller.js';
import { createDevChallengeRouter } from '../../src/http/routes/dev-challenge.routes.js';
import { createChallengeGuard, createDevChallengeVerifier } from '../../src/modules/abuse/challenge.service.js';
import { createRateLimiter } from '../../src/modules/abuse/rate-limit.service.js';
import { ALLOWED_ORIGIN, createCapturingLogger, startServer, testConfig } from '../support/http.js';
import { createTestRedis, createUnreachableRedis } from '../support/redis.js';

const SECRET = 'protections-test-secret-32-characters';

const POLICIES = {
  create: [{ subject: 'network', limit: 4, windowSeconds: 60 }],
  createRisk: [{ subject: 'network', limit: 1, windowSeconds: 60 }],
};

const BodySchema = z.strictObject({ challengeToken: z.string().optional() });

const byNetwork = (req) => ({ network: req.clientNetwork });

// One "API instance": its own Redis client, limiter, guard and HTTP server.
async function startInstance({ redisClient, keyPrefix, trustProxyHops = 0 }) {
  const limiter = createRateLimiter({ redis: redisClient, secret: SECRET, policies: POLICIES, keyPrefix });
  const verifier = createDevChallengeVerifier({ secret: SECRET });
  const guard = createChallengeGuard({ redis: redisClient, verifier, keyPrefix });

  const router = Router();

  router.post(
    '/create',
    rateLimit(limiter, 'create', byNetwork),
    validateBody(BodySchema),
    requireChallengeWhenSuspicious({ limiter, guard, riskPolicy: 'createRisk', action: 'create', subjectsOf: byNetwork }),
    (req, res) => res.status(201).json({ network: req.clientNetwork, bodyKeys: Object.keys(req.body) }),
  );

  const { logger } = createCapturingLogger();
  const config = testConfig({ TRUST_PROXY_HOPS: String(trustProxyHops) });
  const app = createApp({ config, logger, routers: [router, createDevChallengeRouter({ controller: createDevChallengeController({ verifier }) })] });

  return startServer(app);
}

function post(server, path, body = {}, headers = {}) {
  return fetch(`${server.url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

async function issueToken(server, action = 'create') {
  const response = await post(server, '/api/v1/dev/challenge-token', { action });

  return (await response.json()).challengeToken;
}

describe('rate limits and challenges over HTTP', () => {
  let redisA;
  let redisB;
  const servers = [];

  before(async () => {
    redisA = await createTestRedis();
    redisB = await createTestRedis();
  });

  after(async () => {
    await Promise.all(servers.map((server) => server.close()));
    await redisA.cleanup();
    redisB.client.destroy();
  });

  // Each test uses its own forwarded client address so counters never overlap.
  async function instances(count, options = {}) {
    const started = [];

    for (let i = 0; i < count; i += 1) {
      const client = i === 0 ? redisA.client : redisB.client;
      const server = await startInstance({ redisClient: client, keyPrefix: redisA.keyPrefix, trustProxyHops: 1, ...options });

      servers.push(server);
      started.push(server);
    }

    return started;
  }

  test('two API instances share one limit, and 429 carries Retry-After', async () => {
    const [first, second] = await instances(2);
    const client = { 'X-Forwarded-For': '198.51.100.10' };
    const statuses = [];

    // Alternate between instances. The first request is normal; later ones need challenges,
    // which are issued and used so only the shared quota decides the outcome.
    for (let i = 0; i < 5; i += 1) {
      const server = i % 2 === 0 ? first : second;
      const challengeToken = i === 0 ? undefined : await issueToken(server);
      const response = await post(server, '/create', { challengeToken }, client);

      statuses.push(response.status);

      if (response.status === 429) {
        const body = await response.json();

        assert.equal(body.error.code, 'RATE_LIMITED');
        assert.ok(Number(response.headers.get('retry-after')) > 0);
      }
    }

    assert.deepEqual(statuses, [201, 201, 201, 201, 429]);
  });

  test('a suspicious caller must pass a challenge, and each token works once', async () => {
    const [server] = await instances(1);
    const client = { 'X-Forwarded-For': '198.51.100.11' };

    assert.equal((await post(server, '/create', {}, client)).status, 201, 'first request is not suspicious');

    const missing = await post(server, '/create', {}, client);

    assert.equal(missing.status, 403);
    assert.equal((await missing.json()).error.code, 'CHALLENGE_REQUIRED');

    const token = await issueToken(server);
    const passed = await post(server, '/create', { challengeToken: token }, client);

    assert.equal(passed.status, 201);
    assert.deepEqual((await passed.json()).bodyKeys, [], 'the token is removed before the handler runs');

    const replay = await post(server, '/create', { challengeToken: token }, client);

    assert.equal(replay.status, 403, 'a used token cannot be replayed');
  });

  test('a token for another action is refused', async () => {
    const [server] = await instances(1);
    const client = { 'X-Forwarded-For': '198.51.100.12' };

    await post(server, '/create', {}, client);

    const wrongAction = await post(server, '/create', { challengeToken: await issueToken(server, 'report') }, client);

    assert.equal(wrongAction.status, 403);
  });

  test('a valid challenge does not bypass the quota', async () => {
    const [server] = await instances(1);
    const client = { 'X-Forwarded-For': '198.51.100.13' };

    for (let i = 0; i < 4; i += 1) {
      await post(server, '/create', { challengeToken: await issueToken(server) }, client);
    }

    const overQuota = await post(server, '/create', { challengeToken: await issueToken(server) }, client);

    assert.equal(overQuota.status, 429);
  });

  test('X-Forwarded-For is ignored unless a proxy is trusted', async () => {
    const [untrusting] = await instances(1, { trustProxyHops: 0 });
    const [trusting] = await instances(1, { trustProxyHops: 1 });
    const spoofed = { 'X-Forwarded-For': '203.0.113.99' };

    const direct = await (await post(untrusting, '/create', {}, spoofed)).json();
    const proxied = await (await post(trusting, '/create', {}, spoofed)).json();

    assert.equal(direct.network, 'ipv4:127.0.0.1');
    assert.equal(proxied.network, 'ipv4:203.0.113.99');
  });

  test('Redis outage returns 503 with Retry-After, never 429 and never success', async () => {
    const down = createUnreachableRedis();

    try {
      const server = await startInstance({ redisClient: down, keyPrefix: redisA.keyPrefix });

      servers.push(server);

      const startedAt = Date.now();
      const response = await post(server, '/create');

      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'SERVICE_UNAVAILABLE');
      assert.equal(response.headers.get('retry-after'), '5');
      assert.ok(Date.now() - startedAt < 1000, 'must answer quickly while Redis is down');
    } finally {
      down.destroy();
    }
  });
});
