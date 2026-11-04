// SQL for support messages (Contact page, T44).

const COLUMNS = `
  id, user_id, reply_email, topic, message, status,
  created_at, created_at::text AS created_at_cursor, closed_at, closed_by
`;

// A signed-in sender's reply address is their account email, read in the same statement.
export async function insertMessage(db, { userId, replyEmail, topic, message }) {
  await db.query(
    `INSERT INTO support_messages (user_id, reply_email, topic, message)
     VALUES ($1, COALESCE((SELECT email FROM users WHERE id = $1), $2), $3, $4)`,
    [userId, replyEmail, topic, message],
  );
}

// Oldest first within a status, so the inbox is worked in arrival order.
export async function listMessages(db, { status, after, limit }) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}
     FROM support_messages
     WHERE status = $1
       AND ($2::timestamptz IS NULL OR (created_at, id) > ($2::timestamptz, $3::uuid))
     ORDER BY created_at, id
     LIMIT $4`,
    [status, after?.createdAt ?? null, after?.id ?? null, limit],
  );

  return rows;
}

// Closing records when and by whom; reopening clears both. Returns the row, or null.
export async function updateStatus(db, { id, status, actorId }) {
  const { rows } = await db.query(
    `UPDATE support_messages
     SET status = $2::text,
         closed_at = CASE WHEN $2::text = 'closed' THEN now() END,
         closed_by = CASE WHEN $2::text = 'closed' THEN $3::uuid END
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, status, actorId],
  );

  return rows[0] ?? null;
}
