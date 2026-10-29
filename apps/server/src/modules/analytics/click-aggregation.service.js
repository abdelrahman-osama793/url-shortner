import { withTransaction } from '../../infra/postgres.js';

import * as repository from './click-events.repository.js';
import { DIRECT_OR_UNKNOWN } from './rules/referrer.js';

// Stores a batch of click events and updates their aggregates in ONE transaction
// (database-schema.md, "Atomic processing shape"):
//   1. insert raw events, skipping known event ids;
//   2. count only the rows actually inserted, so retries and replays never double-count;
//   3. per link and UTC day, admit at most `referrerCap` distinct referring hosts, the rest
//      going to "other", under a lock so concurrent workers cannot exceed the cap;
//   4. add daily counts (total, country, device, referrer) and lifetime totals.
// Every dimension is incremented once per inserted event, so for any link and day:
//   total = sum(country) = sum(device) = sum(referrer).

const OTHER = 'other';

const keyOf = (...parts) => parts.join('\u0000');

// Sums counts per key, keeping the parts for later.
function tally(entries) {
  const counts = new Map();

  for (const parts of entries) {
    const key = keyOf(...parts);
    const existing = counts.get(key);

    if (existing) existing.clicks += 1;
    else counts.set(key, { parts, clicks: 1 });
  }

  return [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, value]) => value);
}

export function createClickAggregator({ pool, referrerCap = 100, logger }) {
  // Maps each inserted row's referring host to its bucket: its own host if it already has one
  // or the day still has room, otherwise "other". Must run while holding the link-day lock.
  async function referrerBuckets(client, insertedRows) {
    const byLinkDay = Map.groupBy(insertedRows, (row) => keyOf(row.link_id, row.day));
    const bucketFor = new Map();

    for (const key of [...byLinkDay.keys()].sort()) {
      const rows = byLinkDay.get(key);
      const { link_id: linkId, day } = rows[0];

      await repository.lockLinkDay(client, { linkId, day });

      const admitted = new Set(await repository.existingReferrerHosts(client, { linkId, day }));

      for (const row of rows) {
        const host = row.referrer_host;
        const exempt = host === DIRECT_OR_UNKNOWN || host === OTHER;

        if (!exempt && !admitted.has(host) && admitted.size < referrerCap) admitted.add(host);

        bucketFor.set(keyOf(linkId, day, host), exempt || admitted.has(host) ? host : OTHER);
      }
    }

    return bucketFor;
  }

  // Returns { inserted, duplicates }. Throws if the transaction fails (nothing is stored then).
  async function persist(events) {
    if (events.length === 0) return { inserted: 0, duplicates: 0 };

    const inserted = await withTransaction(pool, async (client) => {
      const rows = await repository.insertNewEvents(client, events);

      if (rows.length === 0) return 0;

      const buckets = await referrerBuckets(client, rows);

      const daily = tally(rows.flatMap((row) => [
        [row.link_id, row.day, 'total', 'all'],
        [row.link_id, row.day, 'country', row.country_code],
        [row.link_id, row.day, 'device', row.device_type],
        [row.link_id, row.day, 'referrer', buckets.get(keyOf(row.link_id, row.day, row.referrer_host))],
      ]));

      await repository.addDailyCounts(client, daily.map(({ parts: [linkId, day, dimension, bucket], clicks }) => ({ linkId, day, dimension, bucket, clicks })));

      const totals = tally(rows.map((row) => [row.link_id]));

      await repository.addLifetimeTotals(client, totals.map(({ parts: [linkId], clicks }) => ({ linkId, clicks })));

      return rows.length;
    }, { logger });

    return { inserted, duplicates: events.length - inserted };
  }

  return { persist };
}
