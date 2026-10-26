import pg from 'pg';

const ISOLATION_LEVELS = new Set(['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']);

// One pool per process. Size it so that (API instances + worker) × max stays below the
// database connection limit (technical-design §7).
// Timeouts stop requests from hanging forever when the database is unreachable.
export function createPool({ databaseUrl, maxConnections = 10, timeoutMs = 2000, logger }) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: maxConnections,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
  });

  // Idle clients can fail (e.g. the database restarts). Without this listener the
  // 'error' event would crash the process; the next query reconnects instead.
  pool.on('error', (error) => {
    logger?.error({ err: error }, 'idle postgres client error');
  });

  return pool;
}

// Readiness probe: true when a trivial query succeeds within the pool timeouts.
export async function isDatabaseReachable(pool) {
  try {
    await pool.query('SELECT 1');

    return true;
  } catch {
    return false;
  }
}

// Runs `work(client)` inside one transaction on one connection.
// Commits when `work` resolves; rolls back and re-throws the original error when it fails.
export async function withTransaction(pool, work, { isolationLevel = 'READ COMMITTED', readOnly = false, logger } = {}) {
  if (!ISOLATION_LEVELS.has(isolationLevel)) {
    throw new Error(`Unsupported isolation level: ${isolationLevel}`);
  }

  const client = await pool.connect();
  const accessMode = readOnly ? 'READ ONLY' : 'READ WRITE';

  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel} ${accessMode}`);

    const result = await work(client);

    await client.query('COMMIT');
    client.release();

    return result;
  } catch (error) {
    await rollbackAndRelease(client, logger);

    throw error;
  }
}

// If ROLLBACK itself fails the connection is in an unknown state, so it is destroyed
// rather than returned to the pool. The caller still receives the original error.
async function rollbackAndRelease(client, logger) {
  try {
    await client.query('ROLLBACK');
    client.release();
  } catch (rollbackError) {
    logger?.error({ err: rollbackError }, 'rollback failed; discarding connection');
    client.release(rollbackError);
  }
}

// Errors meaning "PostgreSQL cannot be used right now", as opposed to bugs or bad data.
// They become 503 responses (see http/middleware/errors.js), never 500s.
const UNAVAILABLE_NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN']);

// SQLSTATE: 08xxx connection exceptions; 57P01-57P03 server shutting down or starting;
// 53300 too many connections.
const UNAVAILABLE_SQLSTATES = /^(08...|57P0[123]|53300)$/;

const UNAVAILABLE_MESSAGES = /timeout exceeded when trying to connect|Connection terminated|Query read timeout/i;

export function isDatabaseUnavailable(error) {
  if (!error || typeof error !== 'object') return false;

  if (UNAVAILABLE_NETWORK_CODES.has(error.code)) return true;
  if (typeof error.code === 'string' && UNAVAILABLE_SQLSTATES.test(error.code)) return true;
  if (UNAVAILABLE_MESSAGES.test(error.message ?? '')) return true;

  // Node reports a refused connection to several addresses as an AggregateError.
  return Array.isArray(error.errors) && error.errors.some(isDatabaseUnavailable);
}
