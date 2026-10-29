// SQL for raw click events and their aggregates (database-schema.md, "Analytics").
// Every function takes the caller's transaction client.

// Inserts events, skipping any whose event_id already exists. Returns only the rows actually
// inserted: aggregates must count exactly these, so a replayed event changes nothing.
export async function insertNewEvents(db, events) {
  const { rows } = await db.query(
    `INSERT INTO click_events
       (event_id, link_id, occurred_at, link_version, country_code, device_type, referrer_host, suspected_bot)
     SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::timestamptz[], $4::int[], $5::text[], $6::text[], $7::text[], $8::boolean[])
     ON CONFLICT (event_id) DO NOTHING
     RETURNING link_id, (occurred_at AT TIME ZONE 'UTC')::date::text AS day, country_code, device_type, referrer_host`,
    [
      events.map((event) => event.eventId),
      events.map((event) => event.linkId),
      events.map((event) => event.occurredAt),
      events.map((event) => event.linkVersion),
      events.map((event) => event.country),
      events.map((event) => event.device),
      events.map((event) => event.referrer),
      events.map((event) => event.suspectedBot),
    ],
  );

  return rows;
}

// Serialises referrer-bucket admission for one link and UTC day across workers. Callers lock
// pairs in sorted order so two workers can never wait on each other in a cycle.
// Namespace 1004 keeps these locks apart from codes (1001), identities (1002), idempotency (1003).
export async function lockLinkDay(db, { linkId, day }) {
  await db.query('SELECT pg_advisory_xact_lock(1004, hashtext($1))', [`${linkId}:${day}`]);
}

// Referring hosts already holding their own bucket for this link and day.
export async function existingReferrerHosts(db, { linkId, day }) {
  const { rows } = await db.query(
    `SELECT bucket FROM daily_metrics
     WHERE link_id = $1 AND day = $2 AND dimension = 'referrer' AND bucket <> 'other'`,
    [linkId, day],
  );

  return rows.map((row) => row.bucket);
}

// Adds counts to daily buckets. Each (link, day, dimension, bucket) appears at most once per call.
export async function addDailyCounts(db, rows) {
  await db.query(
    `INSERT INTO daily_metrics (link_id, day, dimension, bucket, clicks)
     SELECT * FROM unnest($1::uuid[], $2::date[], $3::text[], $4::text[], $5::bigint[])
     ON CONFLICT (link_id, day, dimension, bucket)
     DO UPDATE SET clicks = daily_metrics.clicks + EXCLUDED.clicks, updated_at = now()`,
    [
      rows.map((row) => row.linkId),
      rows.map((row) => row.day),
      rows.map((row) => row.dimension),
      rows.map((row) => row.bucket),
      rows.map((row) => row.clicks),
    ],
  );
}

// Adds to lifetime totals. Each link appears at most once per call.
export async function addLifetimeTotals(db, rows) {
  await db.query(
    `INSERT INTO link_totals (link_id, clicks)
     SELECT * FROM unnest($1::uuid[], $2::bigint[])
     ON CONFLICT (link_id)
     DO UPDATE SET clicks = link_totals.clicks + EXCLUDED.clicks, updated_at = now()`,
    [rows.map((row) => row.linkId), rows.map((row) => row.clicks)],
  );
}
