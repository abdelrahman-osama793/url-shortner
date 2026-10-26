import pg from 'pg';

const ISOLATION_LEVELS = new Set(['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']);

// One pool per process. Size it so that (API instances + worker) × max stays below the
// database connection limit (technical-design §7).
export function createPool({ databaseUrl, maxConnections = 10 }) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: maxConnections,
  });

  // Idle clients can fail (e.g. the database restarts). Without this listener the
  // 'error' event would crash the process; the next query reconnects instead.
  pool.on('error', (error) => {
    console.error('idle postgres client error', error);
  });

  return pool;
}

// Runs `work(client)` inside one transaction on one connection.
// Commits when `work` resolves; rolls back and re-throws the original error when it fails.
export async function withTransaction(pool, work, { isolationLevel = 'READ COMMITTED', readOnly = false } = {}) {
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
    await rollbackAndRelease(client);

    throw error;
  }
}

// If ROLLBACK itself fails the connection is in an unknown state, so it is destroyed
// rather than returned to the pool. The caller still receives the original error.
async function rollbackAndRelease(client) {
  try {
    await client.query('ROLLBACK');
    client.release();
  } catch (rollbackError) {
    console.error('rollback failed; discarding connection', rollbackError);
    client.release(rollbackError);
  }
}
