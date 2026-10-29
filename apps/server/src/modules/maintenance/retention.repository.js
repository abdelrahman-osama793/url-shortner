// Bounded deletes for retention. Each call removes at most `limit` rows, so a large backlog is
// cleared in many short statements instead of one long one that would hold locks and bloat WAL.
// Each returns the number of rows deleted.

export async function deleteRawEventsBefore(db, { before, limit }) {
  const { rowCount } = await db.query(
    `DELETE FROM click_events
     WHERE ctid = ANY (ARRAY(SELECT ctid FROM click_events WHERE occurred_at < $1 LIMIT $2))`,
    [before, limit],
  );

  return rowCount;
}

export async function deleteDailyMetricsBefore(db, { beforeDay, limit }) {
  const { rowCount } = await db.query(
    `DELETE FROM daily_metrics
     WHERE ctid = ANY (ARRAY(SELECT ctid FROM daily_metrics WHERE day < $1 LIMIT $2))`,
    [beforeDay, limit],
  );

  return rowCount;
}

export async function deleteExpiredIdempotencyRecords(db, { limit }) {
  const { rowCount } = await db.query(
    `DELETE FROM api_idempotency
     WHERE ctid = ANY (ARRAY(SELECT ctid FROM api_idempotency WHERE expires_at <= now() LIMIT $1))`,
    [limit],
  );

  return rowCount;
}
