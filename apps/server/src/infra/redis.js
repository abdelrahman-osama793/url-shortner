import { createClient } from 'redis';

// Redis holds sessions, rate-limit counters and the click stream (technical-design §2).
// Failure behaviour matters more than throughput here:
//   * disableOfflineQueue: while disconnected, commands fail immediately instead of piling
//     up in memory and running late (technical-design §4, "no unlimited offline backlog");
//   * commandOptions.timeout: a slow Redis fails the command instead of stalling requests;
//   * reconnect forever with capped backoff, so the client recovers on its own.
export function createRedisClient({ url, logger, commandTimeoutMs = 500 }) {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    commandOptions: { timeout: commandTimeoutMs },
    socket: {
      connectTimeout: 2000,
      reconnectStrategy: (retries) => Math.min(retries * 100, 2000),
    },
  });

  // Without an 'error' listener a connection error would crash the process.
  // Log state changes only, not every reconnect attempt, to keep outages readable.
  let connected = false;

  client.on('error', (error) => {
    if (connected) logger?.error({ err: error }, 'redis connection lost');
    connected = false;
  });

  client.on('ready', () => {
    connected = true;
    logger?.info('redis connected');
  });

  return client;
}

// Starts connecting in the background. It never blocks startup: the API must keep serving
// redirects while Redis is down, and Redis-backed operations answer 503 until it returns.
export function connectInBackground(client, logger) {
  client.connect().catch((error) => {
    logger?.error({ err: error }, 'redis connect failed');
  });
}
