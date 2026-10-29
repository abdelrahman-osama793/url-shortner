// Read-only SQL for a link's analytics. Callers pass a client inside one REPEATABLE READ
// transaction, so every query sees the same snapshot. Counts come back as text: they are bigints.

export async function findLifetimeTotal(db, linkId) {
  const { rows } = await db.query('SELECT clicks::text, updated_at FROM link_totals WHERE link_id = $1', [linkId]);

  return rows[0] ?? null;
}

// Clicks per UTC day in [from, to). Days without clicks are simply absent.
export async function findDailyTotals(db, { linkId, from, to }) {
  const { rows } = await db.query(
    `SELECT day::text, clicks::text
     FROM daily_metrics
     WHERE link_id = $1 AND dimension = 'total' AND day >= $2 AND day < $3
     ORDER BY day`,
    [linkId, from, to],
  );

  return rows;
}

// Clicks per country, device and referrer bucket over [from, to).
export async function findBreakdowns(db, { linkId, from, to }) {
  const { rows } = await db.query(
    `SELECT dimension, bucket, sum(clicks)::text AS clicks
     FROM daily_metrics
     WHERE link_id = $1 AND dimension <> 'total' AND day >= $2 AND day < $3
     GROUP BY dimension, bucket`,
    [linkId, from, to],
  );

  return rows;
}
