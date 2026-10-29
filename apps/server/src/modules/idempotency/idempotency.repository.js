// SQL for idempotency records (database-schema.md, api_idempotency). Callers pass their
// transaction client: the record must commit together with the work it describes.

// Serialises requests with the same user and key until the caller's transaction ends, so
// concurrent retries wait for the first one and then see its record. Namespace 1003 keeps these
// locks apart from code allocation (1001) and identity sign-in (1002).
export async function lockKey(db, { userId, key }) {
  await db.query('SELECT pg_advisory_xact_lock(1003, hashtext($1))', [`${userId}:${key}`]);
}

export async function findRecord(db, { userId, key }) {
  const { rows } = await db.query(
    `SELECT request_hash, response_status, response_body, response_etag, expires_at <= now() AS expired
     FROM api_idempotency
     WHERE user_id = $1 AND key = $2`,
    [userId, key],
  );

  return rows[0] ?? null;
}

export async function deleteRecord(db, { userId, key }) {
  await db.query('DELETE FROM api_idempotency WHERE user_id = $1 AND key = $2', [userId, key]);
}

export async function insertRecord(db, { userId, key, requestHash, linkId, response, retentionMs }) {
  await db.query(
    `INSERT INTO api_idempotency
       (user_id, key, request_hash, link_id, response_status, response_body, response_etag, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8))`,
    [userId, key, requestHash, linkId, response.status, response.body, response.etag, retentionMs / 1000],
  );
}
