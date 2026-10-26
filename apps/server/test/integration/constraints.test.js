import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { createMigratedDatabase } from '../support/database.js';

// PostgreSQL SQLSTATE codes asserted below.
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';

let database;

before(async () => {
  database = await createMigratedDatabase();
});

after(async () => {
  await database.drop();
});

function query(sql, params) {
  return database.pool.query(sql, params);
}

async function assertSqlError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected SQLSTATE ${code}, got ${error.code}: ${error.message}`);
    return true;
  });
}

async function insertUser(email = `${randomUUID()}@example.com`) {
  const { rows } = await query(
    'INSERT INTO users (email, email_normalized) VALUES ($1, lower($1)) RETURNING id',
    [email],
  );

  return rows[0].id;
}

async function insertOwnedLink(code = randomUUID().slice(0, 8)) {
  const ownerId = await insertUser();

  const { rows } = await query(
    `INSERT INTO links (owner_id, code, is_custom_alias, destination_url)
     VALUES ($1, $2, true, 'https://example.com') RETURNING id`,
    [ownerId, code],
  );

  return rows[0].id;
}

describe('accounts', () => {
  test('normalized email is unique', async () => {
    await insertUser('Person@Example.com');

    await assertSqlError(insertUser('person@example.com'), UNIQUE_VIOLATION);
  });

  test('a Google subject cannot belong to two users', async () => {
    const first = await insertUser();
    const second = await insertUser();
    const sql = "INSERT INTO external_identities (user_id, provider, subject) VALUES ($1, 'google', 'sub-1')";

    await query(sql, [first]);

    await assertSqlError(query(sql, [second]), UNIQUE_VIOLATION);
  });

  test('role and status only accept documented values', async () => {
    await assertSqlError(
      query("INSERT INTO users (email, email_normalized, role) VALUES ('a@b.co', 'a@b.co', 'owner')"),
      CHECK_VIOLATION,
    );
  });

  test('token hashes must be 32-byte SHA-256 digests', async () => {
    const userId = await insertUser();

    await assertSqlError(
      query(
        "INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, 'reset', 'short'::bytea, now())",
        [userId],
      ),
      CHECK_VIOLATION,
    );
  });
});

describe('links', () => {
  test('codes are unique and compared case-sensitively', async () => {
    await insertOwnedLink('Portfolio');
    await insertOwnedLink('portfolio');

    await assertSqlError(insertOwnedLink('Portfolio'), UNIQUE_VIOLATION);
  });

  test('codes must be 4-32 letters, digits, hyphens or underscores', async () => {
    for (const code of ['abc', 'has space', 'a'.repeat(33), 'émoji']) {
      await assert.rejects(insertOwnedLink(code), `code ${JSON.stringify(code)} should be rejected`);
    }
  });

  test('owner must exist', async () => {
    await assertSqlError(
      query("INSERT INTO links (owner_id, code, destination_url) VALUES ($1, 'orphan1', 'https://example.com')", [randomUUID()]),
      FOREIGN_KEY_VIOLATION,
    );
  });

  test('guest links expire exactly 168 hours after creation', async () => {
    await query(`
      INSERT INTO links (code, destination_url, created_at, expires_at)
      VALUES ('guest001', 'https://example.com', '2026-10-26T12:00:00Z', '2026-11-02T12:00:00Z')
    `);

    await assertSqlError(
      query(`
        INSERT INTO links (code, destination_url, created_at, expires_at)
        VALUES ('guest002', 'https://example.com', '2026-10-26T12:00:00Z', '2026-12-01T12:00:00Z')
      `),
      CHECK_VIOLATION,
    );

    await assertSqlError(
      query("INSERT INTO links (code, destination_url) VALUES ('guest003', 'https://example.com')"),
      CHECK_VIOLATION,
    );
  });

  test('guest links cannot be custom aliases', async () => {
    await assertSqlError(
      query(`
        INSERT INTO links (code, is_custom_alias, destination_url, created_at, expires_at)
        VALUES ('my-alias', true, 'https://example.com', '2026-10-26T12:00:00Z', '2026-11-02T12:00:00Z')
      `),
      CHECK_VIOLATION,
    );
  });

  test('destination is limited to 4,096 characters', async () => {
    const ownerId = await insertUser();
    const tooLong = `https://example.com/${'a'.repeat(4096)}`;

    await assertSqlError(
      query("INSERT INTO links (owner_id, code, destination_url) VALUES ($1, 'longurl1', $2)", [ownerId, tooLong]),
      CHECK_VIOLATION,
    );
  });

  test('a block reason requires the link to be blocked', async () => {
    const linkId = await insertOwnedLink();

    await assertSqlError(
      query("UPDATE links SET admin_block_reason = 'phishing' WHERE id = $1", [linkId]),
      CHECK_VIOLATION,
    );
  });

  test('forbidden aliases are reserved', async () => {
    const { rows } = await query("SELECT reason FROM code_reservations WHERE code = 'admin'");

    assert.deepEqual(rows, [{ reason: 'forbidden' }]);
  });
});

describe('analytics', () => {
  test('duplicate click events are ignored, which makes worker replays safe', async () => {
    const linkId = await insertOwnedLink();
    const eventId = randomUUID();

    const insert = () => query(
      `INSERT INTO click_events (event_id, link_id, occurred_at, link_version, country_code, device_type, referrer_host)
       VALUES ($1, $2, now(), 1, 'EG', 'mobile', 'direct_or_unknown')
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, linkId],
    );

    assert.equal((await insert()).rowCount, 1);
    assert.equal((await insert()).rowCount, 0);
  });

  test('the total dimension only uses the "all" bucket and counts cannot go negative', async () => {
    const linkId = await insertOwnedLink();
    const sql = "INSERT INTO daily_metrics (link_id, day, dimension, bucket, clicks) VALUES ($1, '2026-10-26', $2, $3, $4)";

    await assertSqlError(query(sql, [linkId, 'total', 'EG', 1]), CHECK_VIOLATION);
    await assertSqlError(query(sql, [linkId, 'country', 'EG', -1]), CHECK_VIOLATION);
  });
});

describe('moderation', () => {
  test('closed reports must record when and by whom', async () => {
    const linkId = await insertOwnedLink();

    await assertSqlError(
      query("INSERT INTO abuse_reports (link_id, category, status) VALUES ($1, 'spam', 'resolved')", [linkId]),
      CHECK_VIOLATION,
    );
  });

  test('admin audit is append-only', async () => {
    const actorId = await insertUser();

    const { rows } = await query(
      `INSERT INTO admin_audit (actor_user_id, action, target_type, target_id, reason, request_id)
       VALUES ($1, 'link.block', 'link', $2, 'phishing', 'req_test') RETURNING id`,
      [actorId, randomUUID()],
    );

    const auditId = rows[0].id;

    await assertSqlError(query("UPDATE admin_audit SET reason = 'edited' WHERE id = $1", [auditId]), INSUFFICIENT_PRIVILEGE);
    await assertSqlError(query('DELETE FROM admin_audit WHERE id = $1', [auditId]), INSUFFICIENT_PRIVILEGE);
    await assertSqlError(query('TRUNCATE admin_audit'), INSUFFICIENT_PRIVILEGE);
  });
});
