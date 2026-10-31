// DEVELOPMENT TOOL — T35 capacity benchmark: builds a separate benchmark database with one
// million synthetic links. Never point it at real data.
//
//   BENCH_OWNER_PASSWORD=... node scripts/bench/seed.mjs [links]
//
// Reads POSTGRES_* from the environment (the repository .env). Creates the database
// `shortlist_bench` beside the development database, migrates it, and inserts:
//   - 1,000 verified owners (bench-owner-0000@example.test …); owner 0 gets BENCH_OWNER_PASSWORD
//     so the mixed workload can sign in and read analytics;
//   - N links with codes b0000000 … (8 characters, like generated codes): 90 % owned,
//     10 % guest links (expiring in 7 days), 1 % of owned links disabled (410).
// Idempotent: an existing benchmark database with N links is left as it is.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { hashPassword } from '../../src/modules/accounts/rules/passwords.js';

const LINKS = Number(process.argv[2] ?? 1_000_000);
const OWNERS = 1000;
const DATABASE = 'shortlist_bench';
const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST = 'localhost', POSTGRES_PORT = '5432' } = process.env;
const server = `postgres://${POSTGRES_USER}:${encodeURIComponent(POSTGRES_PASSWORD)}@${POSTGRES_HOST}:${POSTGRES_PORT}`;
const BENCH_DATABASE_URL = `${server}/${DATABASE}`;

async function withClient(url, work) {
  const client = new pg.Client({ connectionString: url });

  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function main() {
  if (!POSTGRES_USER || !POSTGRES_PASSWORD) throw new Error('Set POSTGRES_USER and POSTGRES_PASSWORD (source the repository .env)');
  if (!process.env.BENCH_OWNER_PASSWORD) throw new Error('Set BENCH_OWNER_PASSWORD (a local test password for the benchmark owner)');

  await withClient(`${server}/postgres`, async (client) => {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE]);

    if (!rowCount) await client.query(`CREATE DATABASE ${DATABASE}`);
  });

  execFileSync('npm', ['run', 'migrate', '--', 'up'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: BENCH_DATABASE_URL },
    stdio: 'inherit',
  });

  await withClient(BENCH_DATABASE_URL, async (client) => {
    const { rows: [{ count }] } = await client.query('SELECT count(*)::int AS count FROM links');

    if (count === LINKS) {
      console.log(`${DATABASE} already has ${LINKS} links`);

      return;
    }
    if (count !== 0) throw new Error(`${DATABASE} has ${count} links; drop the database to reseed`);

    const started = Date.now();

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (email, email_normalized, email_verified_at)
       SELECT e, e, now() FROM (SELECT format('bench-owner-%s@example.test', lpad(i::text, 4, '0')) AS e
                                FROM generate_series(0, $1 - 1) AS i) s`,
      [OWNERS],
    );
    await client.query(
      `INSERT INTO password_credentials (user_id, password_hash)
       SELECT id, $1 FROM users WHERE email_normalized = 'bench-owner-0000@example.test'`,
      [await hashPassword(process.env.BENCH_OWNER_PASSWORD)],
    );
    // Owned links are spread over the owners round-robin; every tenth link is a guest link.
    await client.query(
      `WITH owners AS (SELECT id, row_number() OVER (ORDER BY email_normalized) - 1 AS n FROM users)
       INSERT INTO links (owner_id, code, destination_url, created_at, expires_at, owner_disabled_at)
       SELECT CASE WHEN i % 10 = 9 THEN NULL ELSE o.id END,
              'b' || lpad(i::text, 7, '0'),
              'https://example.com/bench/' || i,
              now(),
              CASE WHEN i % 10 = 9 THEN now() + interval '168 hours' END,
              CASE WHEN i % 100 = 42 THEN now() END
       FROM generate_series(0, $1 - 1) AS i
       JOIN owners o ON o.n = i % $2`,
      [LINKS, OWNERS],
    );
    await client.query('COMMIT');
    await client.query('VACUUM ANALYZE links');
    await client.query('VACUUM ANALYZE users');

    const { rows: [size] } = await client.query(
      `SELECT pg_size_pretty(pg_total_relation_size('links')) AS links, pg_size_pretty(pg_database_size($1)) AS database`,
      [DATABASE],
    );

    console.log(`seeded ${LINKS} links and ${OWNERS} owners in ${Math.round((Date.now() - started) / 1000)} s; links ${size.links}, database ${size.database}`);
  });
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
