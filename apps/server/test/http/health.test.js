import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { LivenessResponseSchema, ReadinessResponseSchema } from '@shortlist/contracts';

import { createApp } from '../../src/http/app.js';
import { createHealthController } from '../../src/http/controllers/health.controller.js';
import { createHealthRouter } from '../../src/http/routes/health.routes.js';
import { createPool, isDatabaseReachable } from '../../src/infra/postgres.js';
import { createTestDatabase } from '../support/database.js';
import { createCapturingLogger, startServer, testConfig } from '../support/http.js';

async function startHealthServer(checkDatabase) {
  const { logger } = createCapturingLogger();
  const app = createApp({ config: testConfig(), logger, routers: [createHealthRouter({ controller: createHealthController({ checkDatabase }) })] });

  return startServer(app);
}

describe('health endpoints', () => {
  let databaseUp = true;
  let server;

  before(async () => {
    server = await startHealthServer(async () => databaseUp);
  });

  after(async () => {
    await server.close();
  });

  test('liveness answers without checking dependencies', async () => {
    databaseUp = false;

    const response = await fetch(`${server.url}/health/live`);

    assert.equal(response.status, 200);
    assert.deepEqual(LivenessResponseSchema.parse(await response.json()), { status: 'ok' });
  });

  test('readiness is 200 when PostgreSQL is reachable', async () => {
    databaseUp = true;

    const response = await fetch(`${server.url}/health/ready`);

    assert.equal(response.status, 200);
    assert.deepEqual(ReadinessResponseSchema.parse(await response.json()), {
      status: 'ready',
      checks: { postgres: 'up' },
    });
  });

  test('readiness is 503 when PostgreSQL is not reachable', async () => {
    databaseUp = false;

    const response = await fetch(`${server.url}/health/ready`);

    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).checks.postgres, 'down');
  });
});

describe('isDatabaseReachable', () => {
  let database;

  before(async () => {
    database = await createTestDatabase();
  });

  after(async () => {
    await database.drop();
  });

  test('is true for a running database', async () => {
    assert.equal(await isDatabaseReachable(database.pool), true);
  });

  test('is false, within the timeout, when nothing listens on the port', async () => {
    const unreachable = createPool({ databaseUrl: 'postgres://user:secret@127.0.0.1:1/none', timeoutMs: 500 });
    const startedAt = Date.now();

    try {
      assert.equal(await isDatabaseReachable(unreachable), false);
      assert.ok(Date.now() - startedAt < 2000, 'check must not hang');
    } finally {
      await unreachable.end();
    }
  });
});
