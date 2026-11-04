// SQL for deactivating and deleting accounts (T45). Every function runs inside the caller's
// transaction, after lockAccountStatus.

// Same lock as admin suspensions (moderation), so the last-admin check cannot race.
const ACCOUNT_STATUS_LOCK = [1005, 0];

export async function lockAccountStatus(db) {
  await db.query('SELECT pg_advisory_xact_lock($1, $2)', ACCOUNT_STATUS_LOCK);
}

export async function findUserForUpdate(db, id) {
  const { rows } = await db.query('SELECT id, email_normalized, role, status FROM users WHERE id = $1 FOR UPDATE', [id]);

  return rows[0] ?? null;
}

export async function countOtherActiveAdmins(db, id) {
  const { rows } = await db.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1", [id]);

  return rows[0].n;
}

// Ends every session (session_version) and stops every link (effective status ownerDeactivated).
export async function deactivate(db, id) {
  await db.query(
    "UPDATE users SET status = 'deactivated', session_version = session_version + 1, updated_at = now() WHERE id = $1",
    [id],
  );
}

// Deletes everything the account owns, in dependency order, and returns what was removed.
// Codes are retired first (tombstones), which is what allows their links to be deleted at all
// (migration 0008): an old short link then answers 404 and its code is never handed out again.
// Reports and support messages the person filed go too; moderation records (admin_audit) stay.
export async function deleteOwnedData(db, userId) {
  const linkIds = (await db.query('SELECT id FROM links WHERE owner_id = $1', [userId])).rows.map((row) => row.id);
  const run = async (sql, params) => (await db.query(sql, params)).rowCount;

  await db.query(
    `INSERT INTO code_reservations (code, reason)
     SELECT code, 'tombstone' FROM links WHERE owner_id = $1
     ON CONFLICT (code) DO UPDATE SET reason = 'tombstone'`,
    [userId],
  );

  return {
    clickEvents: await run('DELETE FROM click_events WHERE link_id = ANY($1::uuid[])', [linkIds]),
    dailyMetrics: await run('DELETE FROM daily_metrics WHERE link_id = ANY($1::uuid[])', [linkIds]),
    linkTotals: await run('DELETE FROM link_totals WHERE link_id = ANY($1::uuid[])', [linkIds]),
    idempotencyRecords: await run('DELETE FROM api_idempotency WHERE user_id = $1 OR link_id = ANY($2::uuid[])', [userId, linkIds]),
    reports: await run('DELETE FROM abuse_reports WHERE link_id = ANY($1::uuid[]) OR reporter_id = $2', [linkIds, userId]),
    links: await run('DELETE FROM links WHERE owner_id = $1', [userId]),
    supportMessages: await run('DELETE FROM support_messages WHERE user_id = $1', [userId]),
    emails: await run('DELETE FROM email_outbox WHERE user_id = $1', [userId]),
    tokens: await run('DELETE FROM auth_tokens WHERE user_id = $1', [userId]),
    googleIdentities: await run('DELETE FROM external_identities WHERE user_id = $1', [userId]),
    passwords: await run('DELETE FROM password_credentials WHERE user_id = $1', [userId]),
  };
}

// Removes the users row. If moderation records still refer to it (a former administrator's
// actions or closed items), the row stays but loses every personal detail instead.
export async function deleteOrAnonymizeUser(db, userId) {
  await db.query('SAVEPOINT delete_user');

  try {
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    await db.query('RELEASE SAVEPOINT delete_user');

    return 'deleted';
  } catch (error) {
    if (error.code !== '23503') throw error; // foreign_key_violation

    await db.query('ROLLBACK TO SAVEPOINT delete_user');
    await db.query(
      `UPDATE users
       SET email = 'deleted account', email_normalized = 'deleted:' || id::text, email_verified_at = NULL,
           role = 'user', status = 'deleted', session_version = session_version + 1, updated_at = now()
       WHERE id = $1`,
      [userId],
    );

    return 'anonymized';
  }
}
