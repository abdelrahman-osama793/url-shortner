// Worker process entry point.
// The analytics consumer (T20), email outbox sender (T12) and maintenance jobs (T22)
// attach here. Until then the process only stays alive and stops cleanly.

import { onShutdown, runMain } from './lifecycle.js';

async function main() {
  const keepAlive = setInterval(() => {}, 60_000);

  console.log('worker started');

  onShutdown(() => {
    clearInterval(keepAlive);
    console.log('worker stopped');
  });
}

runMain(main);
