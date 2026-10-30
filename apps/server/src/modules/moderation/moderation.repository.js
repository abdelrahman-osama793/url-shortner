// SQL for administration: the report queue, link blocks, account status and the audit trail
// (database-schema.md, "Moderation and audits"). Functions take a `db` that is either the pool
// or a transaction client; the service decides the transaction boundaries.

// Account status changes are rare; one lock for all of them makes "never remove the last
// active admin" hold even when two admins act on each other at the same moment.
// Namespace 1005 keeps it apart from the other advisory locks (1001-1004).
const ACCOUNT_STATUS_LOCK = [1005, 0];

const REPORT_COLUMNS = `
  r.id, r.link_id, l.code, r.category, r.details, r.status, r.reporter_id,
  r.created_at, r.created_at::text AS created_at_cursor, r.resolved_at, r.resolved_by
`;

const ADMIN_LINK_COLUMNS = `
  l.id, l.code, l.destination_url, l.owner_id, u.status AS owner_status, l.owner_disabled_at,
  l.expires_at, l.admin_blocked_at, l.admin_block_reason, l.version, l.created_at,
  (SELECT count(*)::int FROM abuse_reports r WHERE r.link_id = l.id AND r.status IN ('open', 'reviewing')) AS open_reports
`;

// Oldest first within a status, so the queue is worked in arrival order.
export async function listReports(db, { status, after, limit }) {
  const { rows } = await db.query(
    `SELECT ${REPORT_COLUMNS}
     FROM abuse_reports r
     JOIN links l ON l.id = r.link_id
     WHERE r.status = $1
       AND ($2::timestamptz IS NULL OR (r.created_at, r.id) > ($2::timestamptz, $3::uuid))
     ORDER BY r.created_at, r.id
     LIMIT $4`,
    [status, after?.createdAt ?? null, after?.id ?? null, limit],
  );

  return rows;
}

// Closed reports record when and by whom; reopening clears both (a database check keeps them
// consistent). Returns the updated report, or null when it does not exist.
export async function updateReportStatus(db, { id, status, actorId }) {
  const { rows } = await db.query(
    `WITH updated AS (
       UPDATE abuse_reports
       SET status = $2::text,
           resolved_at = CASE WHEN $2::text IN ('resolved', 'dismissed') THEN now() END,
           resolved_by = CASE WHEN $2::text IN ('resolved', 'dismissed') THEN $3::uuid END
       WHERE id = $1
       RETURNING *
     )
     SELECT ${REPORT_COLUMNS}
     FROM updated r
     JOIN links l ON l.id = r.link_id`,
    [id, status, actorId],
  );

  return rows[0] ?? null;
}

// Exact, case-sensitive code match (links.code is COLLATE "C").
export async function findLinkByCode(db, code) {
  const { rows } = await db.query(
    `SELECT ${ADMIN_LINK_COLUMNS} FROM links l LEFT JOIN users u ON u.id = l.owner_id WHERE l.code = $1`,
    [code],
  );

  return rows[0] ?? null;
}

export async function findLinkById(db, id) {
  const { rows } = await db.query(
    `SELECT ${ADMIN_LINK_COLUMNS} FROM links l LEFT JOIN users u ON u.id = l.owner_id WHERE l.id = $1`,
    [id],
  );

  return rows[0] ?? null;
}

export async function linkExists(db, id) {
  const { rowCount } = await db.query('SELECT 1 FROM links WHERE id = $1', [id]);

  return rowCount === 1;
}

// Blocks or unblocks if the link is still at `expectedVersion`, bumping the same version owners
// use, so an owner's stale edit cannot overwrite it either. Returns false when the version moved
// on (or the link does not exist). Re-blocking keeps the original block time.
export async function setLinkBlock(db, { id, expectedVersion, blocked, reason }) {
  const { rowCount } = await db.query(
    `UPDATE links
     SET admin_blocked_at = CASE WHEN $3 THEN coalesce(admin_blocked_at, now()) END,
         admin_block_reason = CASE WHEN $3 THEN $4 END,
         version = version + 1,
         updated_at = now()
     WHERE id = $1 AND version = $2`,
    [id, expectedVersion, blocked, reason],
  );

  return rowCount === 1;
}

export async function lockAccountStatusChanges(db) {
  await db.query('SELECT pg_advisory_xact_lock($1, $2)', ACCOUNT_STATUS_LOCK);
}

export async function findUserForUpdate(db, id) {
  const { rows } = await db.query('SELECT id, email, role, status FROM users WHERE id = $1 FOR UPDATE', [id]);

  return rows[0] ?? null;
}

export async function countActiveAdminsExcept(db, userId) {
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1",
    [userId],
  );

  return rows[0].n;
}

// Suspension also increments session_version, so the account's existing sessions stay invalid
// even after a later reactivation: it must sign in again.
export async function setUserStatus(db, { id, status }) {
  const { rows } = await db.query(
    `UPDATE users
     SET status = $2::text,
         session_version = session_version + CASE WHEN $2::text = 'suspended' THEN 1 ELSE 0 END,
         updated_at = now()
     WHERE id = $1
     RETURNING id, email, role, status`,
    [id, status],
  );

  return rows[0];
}

export async function insertAudit(db, { actorId, action, targetType, targetId, reason, requestId }) {
  await db.query(
    `INSERT INTO admin_audit (actor_user_id, action, target_type, target_id, reason, request_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId, action, targetType, targetId, reason, requestId],
  );
}

// Newest first, optionally for one target.
export async function listAudit(db, { targetType, targetId, after, limit }) {
  const { rows } = await db.query(
    `SELECT id, actor_user_id, action, target_type, target_id, reason, request_id, created_at,
            created_at::text AS created_at_cursor
     FROM admin_audit
     WHERE ($1::text IS NULL OR (target_type = $1 AND target_id = $2::uuid))
       AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
     ORDER BY created_at DESC, id DESC
     LIMIT $5`,
    [targetType ?? null, targetId ?? null, after?.createdAt ?? null, after?.id ?? null, limit],
  );

  return rows;
}
