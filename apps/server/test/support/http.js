import { once } from 'node:events';
import { promisify } from 'node:util';

import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/infra/logger.js';

export const ALLOWED_ORIGIN = 'http://localhost:4200';

export function testConfig(env = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:secret@localhost:5432/unused',
    PUBLIC_BASE_URL: ALLOWED_ORIGIN,
    ...env,
  });
}

// A logger whose output is kept in memory as parsed JSON lines.
export function createCapturingLogger() {
  const lines = [];

  const destination = {
    write(chunk) {
      lines.push(JSON.parse(chunk));
    },
  };

  return { logger: createLogger({ level: 'debug', destination }), lines };
}

// Listens on a random free port and returns its base URL.
export async function startServer(app) {
  const server = app.listen(0, '127.0.0.1');

  await once(server, 'listening');

  const { port } = server.address();
  const closeServer = promisify(server.close.bind(server));

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => closeServer(),
  };
}
