// SQL for links and code reservations. Functions take a `db` that is either the pool or
// a transaction client, so callers decide the transaction boundaries.

// Advisory-lock namespace for short codes. Other features use different namespaces,
// so their locks never block code allocation.
const CODE_LOCK_NAMESPACE = 1001;

const LINK_COLUMNS = `
  l.id,
  l.owner_id,
  l.code,
  l.is_custom_alias,
  l.destination_url,
  l.created_at,
  l.updated_at,
  l.expires_at,
  l.owner_disabled_at,
  l.admin_blocked_at,
  l.version,
  u.status AS owner_status
`;

// Serialises every allocation and reservation of one exact code for the rest of the
// transaction. hashtext collisions only make unrelated codes wait; the UNIQUE constraint
// on links.code still guarantees correctness.
export async function lockCode(db, code) {
  await db.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [CODE_LOCK_NAMESPACE, code]);
}

export async function isCodeReserved(db, code) {
  const { rowCount } = await db.query('SELECT 1 FROM code_reservations WHERE code = $1', [code]);

  return rowCount > 0;
}

export async function isCodeAllocated(db, code) {
  const { rowCount } = await db.query('SELECT 1 FROM links WHERE code = $1', [code]);

  return rowCount > 0;
}

// Expiry is computed by the database from its own clock, in hours rather than days:
// adding '7 days' to a timestamptz follows calendar days in the session time zone, which
// is not always 168 hours, and the links_guest_rules CHECK requires exactly 168 hours.
// Returns the new link's id, or null when the code is already taken.
export async function insertGuestLink(db, { code, destinationUrl, lifetimeHours }) {
  const { rows } = await db.query(
    `INSERT INTO links (code, destination_url, created_at, expires_at)
     VALUES ($1, $2, now(), now() + make_interval(hours => $3))
     ON CONFLICT (code) DO NOTHING
     RETURNING id`,
    [code, destinationUrl, lifetimeHours],
  );

  return rows[0]?.id ?? null;
}

// Returns the new link's id, or null when the code is already taken.
export async function insertOwnedLink(db, { ownerId, code, isCustomAlias, destinationUrl, expiresAt }) {
  const { rows } = await db.query(
    `INSERT INTO links (owner_id, code, is_custom_alias, destination_url, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (code) DO NOTHING
     RETURNING id`,
    [ownerId, code, isCustomAlias, destinationUrl, expiresAt],
  );

  return rows[0]?.id ?? null;
}

// Returns false when the code is already reserved.
export async function insertReservation(db, { code, reason }) {
  const { rowCount } = await db.query(
    `INSERT INTO code_reservations (code, reason)
     VALUES ($1, $2)
     ON CONFLICT (code) DO NOTHING`,
    [code, reason],
  );

  return rowCount === 1;
}

// The owner's account status is joined in, because suspension affects effective status.
export async function findLinkById(db, id) {
  const { rows } = await db.query(
    `SELECT ${LINK_COLUMNS}
     FROM links l
     LEFT JOIN users u ON u.id = l.owner_id
     WHERE l.id = $1`,
    [id],
  );

  return rows[0] ?? null;
}
