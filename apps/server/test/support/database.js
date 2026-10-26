import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { runner } from 'node-pg-migrate';
import pg from 'pg';

import { createPool } from '../../src/infra/postgres.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../database/migrations', import.meta.url));

// Tests talk to the Compose PostgreSQL through its host port. Missing settings fail loudly:
// a database test must never silently skip and report success.
function adminDatabaseUrl(env = process.env) {
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;

  const required = ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'];
  const missing = required.filter((name) => !env[name]);

  if (missing.length > 0) {
    throw new Error(`Database tests need ${missing.join(', ')} (from .env) or TEST_DATABASE_URL`);
  }

  const user = encodeURIComponent(env.POSTGRES_USER);
  const password = encodeURIComponent(env.POSTGRES_PASSWORD);
  const port = env.POSTGRES_PORT ?? '5432';

  return `postgres://${user}:${password}@localhost:${port}/${env.POSTGRES_DB}`;
}

function withDatabaseName(url, name) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;

  return parsed.toString();
}

async function runAdminQuery(sql) {
  const client = new pg.Client({ connectionString: adminDatabaseUrl() });

  await client.connect();

  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export async function migrate({ databaseUrl, direction, dir = MIGRATIONS_DIR }) {
  await runner({
    databaseUrl,
    dir,
    direction,
    count: Infinity,
    migrationsTable: 'pgmigrations',
    log: () => {},
  });
}

// Creates an isolated, empty database. Call drop() when finished.
export async function createTestDatabase() {
  const name = `shortlist_test_${randomBytes(6).toString('hex')}`;
  const url = withDatabaseName(adminDatabaseUrl(), name);

  await runAdminQuery(`CREATE DATABASE ${name}`);

  const pool = createPool({ databaseUrl: url, maxConnections: 5 });

  const drop = async () => {
    await pool.end();
    await runAdminQuery(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  };

  return { name, url, pool, drop };
}

// Creates an isolated database with every migration applied.
export async function createMigratedDatabase() {
  const database = await createTestDatabase();

  try {
    await migrate({ databaseUrl: database.url, direction: 'up' });
  } catch (error) {
    await database.drop();
    throw error;
  }

  return database;
}
