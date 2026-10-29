// Worker process entry point. Runs, side by side:
//   * the email outbox sender (T12);
//   * the click analytics consumer (T20).
// Maintenance jobs (T22) attach here later.

import { loadConfig } from './config.js';
import { createLogger } from './infra/logger.js';
import { createSmtpMailer } from './infra/mailer.js';
import { createPool } from './infra/postgres.js';
import { connectInBackground, createRedisClient } from './infra/redis.js';
import { onShutdown, runMain } from './lifecycle.js';
import { createClickAggregator } from './modules/analytics/click-aggregation.service.js';
import { createClickConsumer } from './modules/analytics/click-consumer.service.js';
import { createOutboxSender } from './modules/email/email-delivery.service.js';

// Created before configuration so that configuration errors are logged too.
const logger = createLogger();

const CLICK_READ_BLOCK_MS = 2000;

async function main() {
  const config = loadConfig();

  logger.level = config.logLevel;

  const pool = createPool({ databaseUrl: config.database.url, maxConnections: 4, logger });
  const mailer = createSmtpMailer({ url: config.mail.smtpUrl, from: config.mail.from });

  // Two Redis connections: a blocking stream read would hold up every other command on a shared
  // one. The blocking connection's timeout must exceed the read's own wait.
  const redis = createRedisClient({ url: config.redisUrl, logger });
  const blockingRedis = createRedisClient({ url: config.redisUrl, logger, commandTimeoutMs: CLICK_READ_BLOCK_MS + 3000 });

  connectInBackground(redis, logger);
  connectInBackground(blockingRedis, logger);

  const outboxSender = createOutboxSender({
    pool,
    mailer,
    key: config.mail.outboxKey,
    publicBaseUrl: config.publicBaseUrl,
    logger,
  });

  const clickConsumer = createClickConsumer({
    redis,
    blockingRedis,
    aggregator: createClickAggregator({ pool, logger }),
    blockMs: CLICK_READ_BLOCK_MS,
    logger,
  });

  const stop = new AbortController();
  const runs = [outboxSender.run(stop.signal), clickConsumer.run(stop.signal)];

  logger.info('worker started');

  // Finish the current batches before exiting, so nothing is left mid-send or mid-commit.
  onShutdown(async () => {
    stop.abort();
    await Promise.all(runs);
    mailer.close();
    redis.destroy();
    blockingRedis.destroy();
    await pool.end();
    logger.info('worker stopped');
  }, logger);
}

runMain(main, logger);
