// Shared process lifecycle for the API and the worker.

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'];

// Last line of defence: an error nobody handled means the process state is unknown.
// Log it and exit non-zero so the container supervisor restarts a clean process.
function installProcessErrorHandlers(logger) {
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    process.exit(1);
  });
}

// Runs the async startup function and exits cleanly if it fails.
export function runMain(main, logger) {
  installProcessErrorHandlers(logger);

  main().catch((error) => {
    logger.fatal({ err: error }, 'startup failed');
    process.exit(1);
  });
}

export function onShutdown(stop, logger) {
  let stopping = false;

  const handleSignal = async (signal) => {
    if (stopping) return;
    stopping = true;

    logger.info({ signal }, 'shutting down');

    try {
      await stop();
      process.exit(0);
    } catch (error) {
      logger.fatal({ err: error }, 'shutdown failed');
      process.exit(1);
    }
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, handleSignal);
  }
}
