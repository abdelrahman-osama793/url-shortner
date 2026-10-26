// Shared process lifecycle for the API and the worker.

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'];

// Last line of defence: an error nobody handled means the process state is unknown.
// Log it and exit non-zero so the container supervisor restarts a clean process.
export function installProcessErrorHandlers() {
  process.on('unhandledRejection', (reason) => {
    console.error('unhandled promise rejection', reason);
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    console.error('uncaught exception', error);
    process.exit(1);
  });
}

// Runs the async startup function and exits cleanly if it fails.
export function runMain(main) {
  installProcessErrorHandlers();

  main().catch((error) => {
    console.error('startup failed', error);
    process.exit(1);
  });
}

export function onShutdown(stop) {
  let stopping = false;

  const handleSignal = async (signal) => {
    if (stopping) return;
    stopping = true;

    console.log(`received ${signal}, shutting down`);

    try {
      await stop();
      process.exit(0);
    } catch (error) {
      console.error('shutdown failed', error);
      process.exit(1);
    }
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, handleSignal);
  }
}
