// SQL for links and code reservations. Functions take a `db` that is either the pool or
// a transaction client, so callers decide the transaction boundaries.

// Advisory-lock namespace for short codes. Other features use different namespaces,
// so their locks never block code allocation.
const CODE_LOCK_NAMESPACE = 1001;

const LINK_COLUMNS = `
  l.id,
  l.created_at::text AS created_at_cursor,
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

// Everything a redirect needs, in one statement on the primary: the link, its owner's status and
// the database clock (expiry is judged by the same clock that set guest expiry). COLLATE "C" on
// links.code makes the match exact and case-sensitive.
export async function findRedirectTarget(db, code) {
  const { rows } = await db.query(
    `SELECT l.id,
            l.version,
            l.destination_url,
            l.admin_blocked_at,
            l.owner_disabled_at,
            l.expires_at,
            u.status AS owner_status,
            now() AS checked_at
     FROM links l
     LEFT JOIN users u ON u.id = l.owner_id
     WHERE l.code = $1`,
    [code],
  );

  return rows[0] ?? null;
}

// One page of an owner's links, newest first. The keyset condition uses the (created_at, id)
// index, so every page costs the same however deep the user scrolls. Fetches one extra row to
// know whether another page exists.
export async function listOwnedLinks(db, { ownerId, after, limit }) {
  const { rows } = await db.query(
    `SELECT ${LINK_COLUMNS}
     FROM links l
     JOIN users u ON u.id = l.owner_id
     WHERE l.owner_id = $1
       AND ($2::timestamptz IS NULL OR (l.created_at, l.id) < ($2::timestamptz, $3::uuid))
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT $4`,
    [ownerId, after?.createdAt ?? null, after?.id ?? null, limit + 1],
  );

  return rows;
}

// The link if it exists and belongs to this owner; otherwise null (never reveals other links).
export async function findOwnedLink(db, { ownerId, id }) {
  const { rows } = await db.query(
    `SELECT ${LINK_COLUMNS}
     FROM links l
     JOIN users u ON u.id = l.owner_id
     WHERE l.id = $1 AND l.owner_id = $2`,
    [id, ownerId],
  );

  return rows[0] ?? null;
}

// Applies the changes only if the link belongs to the owner AND is still at the version the
// owner last saw (optimistic concurrency). Returns the new version, or null if nothing matched.
// Owner-disabled time is kept when disabling an already disabled link.
export async function updateOwnedLink(db, { ownerId, id, expectedVersion, changes }) {
  const { rows } = await db.query(
    `UPDATE links
     SET destination_url = CASE WHEN $4::boolean THEN $5 ELSE destination_url END,
         expires_at = CASE WHEN $6::boolean THEN $7::timestamptz ELSE expires_at END,
         owner_disabled_at = CASE
           WHEN $8::boolean IS NULL THEN owner_disabled_at
           WHEN $8::boolean THEN NULL
           ELSE COALESCE(owner_disabled_at, now())
         END,
         version = version + 1,
         updated_at = now()
     WHERE id = $1 AND owner_id = $2 AND version = $3
     RETURNING version`,
    [
      id,
      ownerId,
      expectedVersion,
      'destinationUrl' in changes,
      changes.destinationUrl ?? null,
      'expiresAt' in changes,
      changes.expiresAt ?? null,
      changes.enabled ?? null,
    ],
  );

  return rows[0]?.version ?? null;
}
