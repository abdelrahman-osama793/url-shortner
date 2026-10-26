// API process entry point.

import { once } from 'node:events';
import { promisify } from 'node:util';

import { loadConfig } from './config.js';
import { createApp } from './http/app.js';
import { onShutdown, runMain } from './lifecycle.js';

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
  const app = createApp();

  const server = await listen(app, config.port);

  console.log(`api listening on :${config.port}`);

  onShutdown(() => close(server));
}

runMain(main);
