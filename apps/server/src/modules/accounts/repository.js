// SQL for user accounts. Takes a `db` that is either the pool or a transaction client.

export async function findUserById(db, id) {
  const { rows } = await db.query(
    `SELECT id, email, email_verified_at, role, status, session_version
     FROM users
     WHERE id = $1`,
    [id],
  );

  return rows[0] ?? null;
}

// The public account shape (contracts UserSchema). Never includes the session version.
export function toUserResource(row) {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified_at !== null,
    role: row.role,
    status: row.status,
  };
}
