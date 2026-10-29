// SQL for the analytics pipeline's health record (database-schema.md, worker_state).

export async function upsertWorkerState(db, { name, lastBatchCommittedAt, oldestPendingAt, status }) {
  await db.query(
    `INSERT INTO worker_state (name, heartbeat_at, last_batch_committed_at, oldest_pending_at, status)
     VALUES ($1, now(), $2, $3, $4)
     ON CONFLICT (name) DO UPDATE
     SET heartbeat_at = now(),
         last_batch_committed_at = EXCLUDED.last_batch_committed_at,
         oldest_pending_at = EXCLUDED.oldest_pending_at,
         status = EXCLUDED.status`,
    [name, lastBatchCommittedAt, oldestPendingAt, status],
  );
}

export async function findWorkerState(db, name) {
  const { rows } = await db.query(
    'SELECT heartbeat_at, last_batch_committed_at, oldest_pending_at, status FROM worker_state WHERE name = $1',
    [name],
  );

  return rows[0] ?? null;
}
