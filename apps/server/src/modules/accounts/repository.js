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

// The user plus their password hash (null for Google-only accounts), for sign-in.
export async function findUserWithPasswordByEmail(db, emailNormalized) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.email_verified_at, u.role, u.status, u.session_version, p.password_hash
     FROM users u
     LEFT JOIN password_credentials p ON p.user_id = u.id
     WHERE u.email_normalized = $1`,
    [emailNormalized],
  );

  return rows[0] ?? null;
}

// Creates the user and their password credential. Returns the user, or null when the
// normalised email is already taken (the existing account is left untouched).
export async function insertUserWithPassword(db, { email, emailNormalized, passwordHash }) {
  const { rows } = await db.query(
    `INSERT INTO users (email, email_normalized)
     VALUES ($1, $2)
     ON CONFLICT (email_normalized) DO NOTHING
     RETURNING id, email`,
    [email, emailNormalized],
  );

  const user = rows[0];

  if (!user) return null;

  await db.query('INSERT INTO password_credentials (user_id, password_hash) VALUES ($1, $2)', [user.id, passwordHash]);

  return user;
}

export async function markEmailVerified(db, userId) {
  await db.query(
    `UPDATE users
     SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
     WHERE id = $1`,
    [userId],
  );
}

export async function updatePasswordHash(db, userId, passwordHash) {
  await db.query('UPDATE password_credentials SET password_hash = $2 WHERE user_id = $1', [userId, passwordHash]);
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
