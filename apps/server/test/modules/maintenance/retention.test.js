import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { createRetentionService } from '../../../src/modules/maintenance/retention.service.js';
import { createMigratedDatabase } from '../../support/database.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 29, 12);

let database;

before(async () => {
  database = await createMigratedDatabase();
});

after(async () => {
  await database.drop();
});

async function newLink() {
  const { rows } = await database.pool.query(
    `INSERT INTO links (code, destination_url, created_at, expires_at)
     VALUES ($1, 'https://example.com', now(), now() + interval '168 hours') RETURNING id`,
    [`r${randomUUID().slice(0, 10)}`],
  );

  return rows[0].id;
}

async function rawEvent(linkId, occurredAtMs) {
  await database.pool.query(
    `INSERT INTO click_events (event_id, link_id, occurred_at, link_version, country_code, device_type, referrer_host)
     VALUES ($1, $2, $3, 1, 'unknown', 'desktop', 'direct_or_unknown')`,
    [randomUUID(), linkId, new Date(occurredAtMs)],
  );
}

async function count(sql, params) {
  const { rows } = await database.pool.query(sql, params);

  return rows[0].n;
}

describe('retention cleanup', () => {
  test('removes raw events older than 30 days and keeps everything else', async () => {
    const linkId = await newLink();

    await rawEvent(linkId, NOW - 31 * DAY_MS);
    await rawEvent(linkId, NOW - 30 * DAY_MS - 1000);
    await rawEvent(linkId, NOW - 29 * DAY_MS);
    await rawEvent(linkId, NOW - 1000);
    await database.pool.query("INSERT INTO link_totals (link_id, clicks) VALUES ($1, 4)", [linkId]);
    await database.pool.query("INSERT INTO daily_metrics (link_id, day, dimension, bucket, clicks) VALUES ($1, '2026-09-27', 'total', 'all', 4)", [linkId]);

    const result = await createRetentionService({ pool: database.pool, aggregateRetentionDays: 365, clock: () => NOW }).runOnce();

    assert.equal(result.rawEvents, 2);
    assert.equal(await count('SELECT count(*)::int AS n FROM click_events WHERE link_id = $1', [linkId]), 2);
    assert.equal(await count('SELECT clicks::int AS n FROM link_totals WHERE link_id = $1', [linkId]), 4, 'lifetime totals survive');
    assert.equal(await count('SELECT count(*)::int AS n FROM daily_metrics WHERE link_id = $1', [linkId]), 1, 'aggregates survive raw cleanup');
  });

  test('removes daily aggregates older than the aggregate retention, never lifetime totals', async () => {
    const linkId = await newLink();

    for (const day of ['2025-10-28', '2025-10-29', '2025-10-30', '2026-10-28']) {
      await database.pool.query("INSERT INTO daily_metrics (link_id, day, dimension, bucket, clicks) VALUES ($1, $2, 'total', 'all', 1)", [linkId, day]);
    }

    await database.pool.query('INSERT INTO link_totals (link_id, clicks) VALUES ($1, 100)', [linkId]);

    await createRetentionService({ pool: database.pool, aggregateRetentionDays: 365, clock: () => NOW }).runOnce();

    const { rows } = await database.pool.query('SELECT day::text FROM daily_metrics WHERE link_id = $1 ORDER BY day', [linkId]);

    assert.deepEqual(rows.map((row) => row.day), ['2025-10-29', '2025-10-30', '2026-10-28'], 'cutoff day 2025-10-29 is kept');
    assert.equal(await count('SELECT clicks::int AS n FROM link_totals WHERE link_id = $1', [linkId]), 100);
  });

  test('removes expired idempotency records and keeps live ones', async () => {
    const linkId = await newLink();
    const { rows } = await database.pool.query('INSERT INTO users (email, email_normalized) VALUES ($1, $1) RETURNING id', [`${randomUUID()}@example.com`]);
    const insert = (key, expiresSql) => database.pool.query(
      `INSERT INTO api_idempotency (user_id, key, request_hash, link_id, response_status, response_body, response_etag, expires_at)
       VALUES ($1, $2, '\\x00', $3, 201, '{}', '"v1"', ${expiresSql})`,
      [rows[0].id, key, linkId],
    );

    await insert('expired', "now() - interval '1 minute'");
    await insert('live', "now() + interval '1 hour'");

    await createRetentionService({ pool: database.pool, aggregateRetentionDays: 365 }).runOnce();

    const { rows: left } = await database.pool.query('SELECT key FROM api_idempotency WHERE user_id = $1', [rows[0].id]);

    assert.deepEqual(left.map((row) => row.key), ['live']);
  });

  test('works through a backlog in bounded batches', async () => {
    const linkId = await newLink();

    for (let i = 0; i < 7; i += 1) await rawEvent(linkId, NOW - 40 * DAY_MS);

    const limited = createRetentionService({ pool: database.pool, aggregateRetentionDays: 365, batchSize: 2, maxBatches: 2, clock: () => NOW });

    assert.equal((await limited.runOnce()).rawEvents, 4, 'two batches of two per run');
    assert.equal((await limited.runOnce()).rawEvents, 3, 'the next run continues');
    assert.equal(await count('SELECT count(*)::int AS n FROM click_events WHERE link_id = $1', [linkId]), 0);
  });
});
