// Worker process entry point. Runs the email outbox sender (T12). The analytics consumer
// (T20) and maintenance jobs (T22) attach here later.

import { loadConfig } from './config.js';
import { createLogger } from './infra/logger.js';
import { createSmtpMailer } from './infra/mailer.js';
import { createPool } from './infra/postgres.js';
import { onShutdown, runMain } from './lifecycle.js';
import { createOutboxSender } from './modules/email/email-delivery.service.js';

// Created before configuration so that configuration errors are logged too.
const logger = createLogger();

async function main() {
  const config = loadConfig();

  logger.level = config.logLevel;

  const pool = createPool({ databaseUrl: config.database.url, maxConnections: 2, logger });
  const mailer = createSmtpMailer({ url: config.mail.smtpUrl, from: config.mail.from });

  const outboxSender = createOutboxSender({
    pool,
    mailer,
    key: config.mail.outboxKey,
    publicBaseUrl: config.publicBaseUrl,
    logger,
  });

  const stop = new AbortController();
  const outboxRun = outboxSender.run(stop.signal);

  logger.info('worker started');

  // Finish the current batch before exiting, so no claimed message is left mid-send.
  onShutdown(async () => {
    stop.abort();
    await outboxRun;
    mailer.close();
    await pool.end();
    logger.info('worker stopped');
  }, logger);
}

runMain(main, logger);
