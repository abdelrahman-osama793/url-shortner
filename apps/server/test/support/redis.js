import { randomBytes } from 'node:crypto';

import { createRedisClient } from '../../src/infra/redis.js';

// Tests use the Compose Redis through its host port, or TEST_REDIS_URL (CI). Missing
// settings fail loudly: a Redis test must never silently skip and report success.
export function testRedisUrl(env = process.env) {
  if (env.TEST_REDIS_URL) return env.TEST_REDIS_URL;

  if (!env.REDIS_PASSWORD) {
    throw new Error('Redis tests need REDIS_PASSWORD (from .env) or TEST_REDIS_URL');
  }

  return `redis://:${encodeURIComponent(env.REDIS_PASSWORD)}@localhost:${env.REDIS_PORT ?? '6380'}`;
}

// A connected client plus a unique key prefix. cleanup() deletes this test's keys only.
export async function createTestRedis() {
  const client = createRedisClient({ url: testRedisUrl() });
  const keyPrefix = `test:${randomBytes(6).toString('hex')}:`;

  await client.connect();

  async function cleanup() {
    for await (const keys of client.scanIterator({ MATCH: `${keyPrefix}*`, COUNT: 100 })) {
      if (keys.length > 0) await client.del(keys);
    }

    client.destroy();
  }

  return { client, keyPrefix, cleanup };
}

// A client pointed at a closed port, for testing behaviour while Redis is down.
export function createUnreachableRedis() {
  const client = createRedisClient({ url: 'redis://127.0.0.1:1' });

  client.connect().catch(() => {});

  return client;
}
