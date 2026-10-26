import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createTestDatabase, migrate, MIGRATIONS_DIR } from '../support/database.js';

const EXPECTED_TABLES = [
  'abuse_reports',
  'admin_audit',
  'api_idempotency',
  'auth_tokens',
  'click_events',
  'code_reservations',
  'daily_metrics',
  'email_outbox',
  'external_identities',
  'link_totals',
  'links',
  'password_credentials',
  'pgmigrations',
  'users',
  'worker_state',
];

async function listTables(pool) {
  const { rows } = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);

  return rows.map((row) => row.table_name);
}

async function appliedMigrations(pool) {
  const { rows } = await pool.query('SELECT name FROM pgmigrations ORDER BY id');

  return rows.map((row) => row.name);
}

describe('migrations', () => {
  let database;

  before(async () => {
    database = await createTestDatabase();
  });

  after(async () => {
    await database.drop();
  });

  test('apply to an empty database and create every table', async () => {
    await migrate({ databaseUrl: database.url, direction: 'up' });

    assert.deepEqual(await listTables(database.pool), EXPECTED_TABLES);
  });

  test('roll all the way down and back up again', async () => {
    await migrate({ databaseUrl: database.url, direction: 'down' });

    assert.deepEqual(await listTables(database.pool), ['pgmigrations']);

    await migrate({ databaseUrl: database.url, direction: 'up' });

    assert.deepEqual(await listTables(database.pool), EXPECTED_TABLES);
  });

  test('a failing migration leaves no partial changes and is not recorded', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'shortlist-migrations-'));

    try {
      await cp(MIGRATIONS_DIR, dir, { recursive: true });

      await writeFile(path.join(dir, '9999_broken.sql'), [
        '-- Up Migration',
        'CREATE TABLE half_applied (id integer);',
        'SELECT 1 / 0;',
        '-- Down Migration',
        'DROP TABLE half_applied;',
      ].join('\n'));

      const appliedBefore = await appliedMigrations(database.pool);

      await assert.rejects(migrate({ databaseUrl: database.url, direction: 'up', dir }), /division by zero/);

      assert.equal((await listTables(database.pool)).includes('half_applied'), false);
      assert.deepEqual(await appliedMigrations(database.pool), appliedBefore);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
