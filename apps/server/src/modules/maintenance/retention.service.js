import * as repository from './retention.repository.js';

// Retention (decision D11; technical-design §5):
//   * raw click events: 30 days (confirmed requirement);
//   * daily aggregates: `aggregateRetentionDays` (provisional 12 months);
//   * lifetime totals (link_totals): kept, never deleted here;
//   * idempotency records: removed once expired (24 h).
// Deletes run in batches of `batchSize`, at most `maxBatches` per table per run, so one run has
// a bounded cost; anything left is picked up by the next run.

const DAY_MS = 24 * 60 * 60 * 1000;

export const RAW_EVENT_RETENTION_DAYS = 30;

export function createRetentionService({ pool, aggregateRetentionDays, batchSize = 5000, maxBatches = 100, clock = () => Date.now(), logger }) {
  async function drain(deleteBatch) {
    let removed = 0;

    for (let batch = 0; batch < maxBatches; batch += 1) {
      const count = await deleteBatch();

      removed += count;

      if (count < batchSize) break;
    }

    return removed;
  }

  // Returns how many rows each step removed.
  async function runOnce() {
    const now = clock();
    const rawCutoff = new Date(now - RAW_EVENT_RETENTION_DAYS * DAY_MS);
    const aggregateCutoffDay = new Date(now - aggregateRetentionDays * DAY_MS).toISOString().slice(0, 10);

    const result = {
      rawEvents: await drain(() => repository.deleteRawEventsBefore(pool, { before: rawCutoff, limit: batchSize })),
      dailyMetrics: await drain(() => repository.deleteDailyMetricsBefore(pool, { beforeDay: aggregateCutoffDay, limit: batchSize })),
      idempotencyRecords: await drain(() => repository.deleteExpiredIdempotencyRecords(pool, { limit: batchSize })),
    };

    logger?.info({ removed: result }, 'retention cleanup finished');

    return result;
  }

  return { runOnce };
}
