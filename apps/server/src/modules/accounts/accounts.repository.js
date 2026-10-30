// SQL for user accounts. Takes a `db` that is either the pool or a transaction client.
// Only SQL lives here; rules are in accounts.service.js and API shapes in accounts.presenter.js.

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

// Sets a new password and increments session_version, which makes every existing session of
// this user fail its next PostgreSQL check (http/middleware/session.js). Following the emailed
// reset link proves control of the mailbox, so the email also counts as verified.
// Returns false when the user has no password credential (Google-only accounts are never
// given one through reset; enrolment is a separate flow outside v1).
export async function resetPasswordAndRevokeSessions(db, userId, passwordHash) {
  const { rowCount } = await db.query(
    `UPDATE password_credentials
     SET password_hash = $2, password_changed_at = now()
     WHERE user_id = $1`,
    [userId, passwordHash],
  );

  if (rowCount === 0) return false;

  await db.query(
    `UPDATE users
     SET session_version = session_version + 1,
         email_verified_at = COALESCE(email_verified_at, now()),
         updated_at = now()
     WHERE id = $1`,
    [userId],
  );

  return true;
}

// Which ways this user can sign in.
export async function findSignInMethods(db, userId) {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM password_credentials WHERE user_id = $1) AS password,
            EXISTS (SELECT 1 FROM external_identities WHERE user_id = $1 AND provider = 'google') AS google`,
    [userId],
  );

  return rows[0];
}

// The stored password hash of a user, or null for accounts without a password (Google-only).
export async function findPasswordHash(db, userId) {
  const { rows } = await db.query('SELECT password_hash FROM password_credentials WHERE user_id = $1', [userId]);

  return rows[0]?.password_hash ?? null;
}

// The subject of the user's identity at this provider, or null when none is linked.
export async function findIdentitySubject(db, { userId, provider }) {
  const { rows } = await db.query('SELECT subject FROM external_identities WHERE user_id = $1 AND provider = $2', [userId, provider]);

  return rows[0]?.subject ?? null;
}

// The user linked to an external identity (e.g. a Google subject), or null.
export async function findUserByIdentity(db, { provider, subject }) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.email_verified_at, u.role, u.status, u.session_version
     FROM external_identities i
     JOIN users u ON u.id = i.user_id
     WHERE i.provider = $1 AND i.subject = $2`,
    [provider, subject],
  );

  return rows[0] ?? null;
}

// Creates a user without a password (an external-identity account). Returns the new user, or
// null when the normalised email is already taken.
export async function insertUserWithoutPassword(db, { email, emailNormalized, emailVerified }) {
  const { rows } = await db.query(
    `INSERT INTO users (email, email_normalized, email_verified_at)
     VALUES ($1, $2, CASE WHEN $3::boolean THEN now() END)
     ON CONFLICT (email_normalized) DO NOTHING
     RETURNING id, email, email_verified_at, role, status, session_version`,
    [email, emailNormalized, emailVerified],
  );

  return rows[0] ?? null;
}

export async function insertIdentity(db, { userId, provider, subject }) {
  await db.query(
    'INSERT INTO external_identities (user_id, provider, subject) VALUES ($1, $2, $3)',
    [userId, provider, subject],
  );
}

// Serialises sign-ins of one external identity, so two simultaneous first sign-ins cannot both
// try to create the account. Namespace 1002 keeps these locks apart from code allocation (1001).
export async function lockIdentity(db, { provider, subject }) {
  await db.query('SELECT pg_advisory_xact_lock(1002, hashtext($1))', [`${provider}:${subject}`]);
}
