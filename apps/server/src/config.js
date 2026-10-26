// Reads environment variables once at startup.
// Every other module receives configuration as an argument instead of reading process.env.

function readPort(value, fallback) {
  const port = Number(value ?? fallback);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }

  return port;
}

export function loadConfig(env = process.env) {
  return Object.freeze({
    port: readPort(env.PORT, 3000),
  });
}
