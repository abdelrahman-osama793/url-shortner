// Worker process entry point.
// The analytics consumer (T20), email outbox sender (T12) and maintenance jobs (T22)
// attach here. Until then the process only validates configuration and stays alive.

import { loadConfig } from './config.js';
import { createLogger } from './infra/logger.js';
import { onShutdown, runMain } from './lifecycle.js';

// Created before configuration so that configuration errors are logged too.
const logger = createLogger();

async function main() {
  const config = loadConfig();

  logger.level = config.logLevel;

  const keepAlive = setInterval(() => {}, 60_000);

  logger.info('worker started');

  onShutdown(() => {
    clearInterval(keepAlive);
    logger.info('worker stopped');
  }, logger);
}

runMain(main, logger);
