// SQL for one-time tokens (auth_tokens). Callers pass their transaction client.

export async function revokeUnusedTokens(db, { userId, purpose }) {
  await db.query(
    `UPDATE auth_tokens
     SET used_at = now()
     WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
    [userId, purpose],
  );
}

// Returns the expiry the database computed from its own clock.
export async function insertToken(db, { userId, purpose, tokenHash, lifetimeMs }) {
  const { rows } = await db.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))
     RETURNING expires_at`,
    [userId, purpose, tokenHash, lifetimeMs / 1000],
  );

  return rows[0].expires_at;
}

// Locks the row until the caller's transaction ends, so concurrent consumers wait their turn.
export async function findTokenForUpdate(db, { tokenHash, purpose }) {
  const { rows } = await db.query(
    `SELECT id, user_id, used_at, expires_at <= now() AS expired
     FROM auth_tokens
     WHERE token_hash = $1 AND purpose = $2
     FOR UPDATE`,
    [tokenHash, purpose],
  );

  return rows[0] ?? null;
}

export async function markTokenUsed(db, id) {
  await db.query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [id]);
}
