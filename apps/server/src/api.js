// API process entry point: builds every dependency and wires them together.

import { once } from 'node:events';
import { promisify } from 'node:util';

import { loadConfig } from './config.js';
import { createApp } from './http/app.js';
import { createHealthRouter } from './http/routes/health.js';
import { createLogger } from './infra/logger.js';
import { createPool, isDatabaseReachable } from './infra/postgres.js';
import { onShutdown, runMain } from './lifecycle.js';

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

  const routers = [
    createHealthRouter({ checkDatabase: () => isDatabaseReachable(pool) }),
  ];

  const app = createApp({ config, logger, routers });
  const server = await listen(app, config.port);

  logger.info({ port: config.port }, 'api listening');

  onShutdown(async () => {
    await close(server);
    await pool.end();
  }, logger);
}

runMain(main, logger);
