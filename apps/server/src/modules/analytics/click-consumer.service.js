import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

import { isDatabaseUnavailable } from '../../infra/postgres.js';

import { CLICK_STREAM } from './click-capture.service.js';
import { parseClickEvent } from './rules/click-event.js';

// Reads click events from the Redis Stream with a consumer group and hands them to the
// aggregator (technical-design §5, "Consumer-group processing").
//
// Order per batch: reclaim entries a crashed worker left unacknowledged, otherwise read new ones;
// store them in one PostgreSQL transaction; only after that commits, acknowledge and delete them
// in Redis. If the worker dies between commit and acknowledgement, the entries are reclaimed
// later and the aggregator recognises their event ids, so nothing is counted twice.
//
// Unusable entries never block the stream: malformed ones and events the database rejects (for
// example an unknown link) go to a bounded dead-letter stream; events older than the raw
// retention window are dropped and counted. While PostgreSQL is unavailable nothing is
// acknowledged, so the work stays recoverable.

export const CONSUMER_GROUP = 'analytics-v1';
export const DEAD_LETTER_STREAM = 'clicks:dead:v1';

const DAY_MS = 24 * 60 * 60 * 1000;

// Stream ids are "<milliseconds>-<sequence>"; compares them numerically.
function compareIds(a, b) {
  const [aMs, aSeq] = a.split('-').map(BigInt);
  const [bMs, bSeq] = b.split('-').map(BigInt);

  if (aMs !== bMs) return aMs < bMs ? -1 : 1;
  if (aSeq !== bSeq) return aSeq < bSeq ? -1 : 1;

  return 0;
}
const RAW_RETENTION_MS = 30 * DAY_MS;
const DEAD_LETTER_RETENTION_MS = 7 * DAY_MS;

export function createClickConsumer({
  redis,
  blockingRedis,
  aggregator,
  keyPrefix = '',
  consumerName = `${hostname()}-${process.pid}`,
  batchSize = 500,
  blockMs = 2000,
  minIdleMs = 30_000,
  clock = () => Date.now(),
  afterCommit,
  logger,
}) {
  const streamKey = `${keyPrefix}${CLICK_STREAM}`;
  const deadLetterKey = `${keyPrefix}${DEAD_LETTER_STREAM}`;

  const stats = { inserted: 0, duplicates: 0, deadLettered: 0, expired: 0, failedBatches: 0, lastCommittedAt: null, lastPassFailed: false };

  async function ensureGroup() {
    try {
      await redis.xGroupCreate(streamKey, CONSUMER_GROUP, '0', { MKSTREAM: true });
    } catch (error) {
      if (!String(error?.message).startsWith('BUSYGROUP')) throw error;
    }
  }

  // Entries another (or a previous) consumer read but never acknowledged for at least minIdleMs.
  async function reclaim() {
    const { messages } = await redis.xAutoClaim(streamKey, CONSUMER_GROUP, consumerName, minIdleMs, '0-0', { COUNT: batchSize });

    return messages.filter(Boolean);
  }

  async function readNew() {
    const result = await blockingRedis.xReadGroup(CONSUMER_GROUP, consumerName, { key: streamKey, id: '>' }, { COUNT: batchSize, BLOCK: blockMs });

    return result?.[0]?.messages ?? [];
  }

  async function finish(entries) {
    if (entries.length === 0) return;

    const ids = entries.map((entry) => entry.id);

    await redis.xAck(streamKey, CONSUMER_GROUP, ids);
    await redis.xDel(streamKey, ids);
  }

  async function deadLetter(entry, reason) {
    const now = clock();

    await redis.xAdd(deadLetterKey, '*', {
      reason,
      sourceId: entry.id,
      fields: JSON.stringify(entry.message).slice(0, 2048),
    }, {
      TRIM: { strategy: 'MINID', strategyModifier: '~', threshold: `${now - DEAD_LETTER_RETENTION_MS}-0` },
    });

    stats.deadLettered += 1;
    logger?.warn({ sourceId: entry.id, reason }, 'click event dead-lettered');
  }

  // A data error in the batch (not an outage): store events one by one so a single bad event
  // cannot hold back the others.
  async function persistIndividually(valid) {
    for (const { entry, event } of valid) {
      try {
        const { inserted, duplicates } = await aggregator.persist([event]);

        stats.inserted += inserted;
        stats.duplicates += duplicates;
      } catch (error) {
        if (isDatabaseUnavailable(error)) throw error;

        await deadLetter(entry, 'rejected_by_database');
      }
    }
  }

  async function handle(entries) {
    const now = clock();
    const valid = [];
    const done = [];

    for (const entry of entries) {
      const parsed = parseClickEvent(entry.message, { now });

      if (!parsed.ok) {
        await deadLetter(entry, parsed.reason);
        done.push(entry);
      } else if (parsed.event.occurredAt.getTime() < now - RAW_RETENTION_MS) {
        stats.expired += 1;
        done.push(entry);
      } else {
        valid.push({ entry, event: parsed.event });
      }
    }

    try {
      const { inserted, duplicates } = await aggregator.persist(valid.map(({ event }) => event));

      stats.inserted += inserted;
      stats.duplicates += duplicates;
    } catch (error) {
      if (isDatabaseUnavailable(error)) throw error;

      logger?.warn({ err: error, size: valid.length }, 'click batch rejected; storing events individually');
      await persistIndividually(valid);
    }

    // Test hook: simulates a crash after the commit and before the acknowledgement.
    await afterCommit?.();

    await finish([...done, ...valid.map(({ entry }) => entry)]);

    stats.lastCommittedAt = clock();
  }

  // One pass: reclaim abandoned entries, or read new ones (waiting up to blockMs).
  // Returns the number of entries handled. Throws on Redis or database outages, leaving
  // everything unacknowledged and therefore recoverable.
  async function processOnce() {
    let entries = await reclaim();

    if (entries.length === 0) entries = await readNew();
    if (entries.length === 0) return 0;

    await handle(entries);

    return entries.length;
  }

  // Runs until `signal` aborts. Failures are logged and retried after a pause that grows to 30 s.
  async function run(signal) {
    let failures = 0;

    while (!signal.aborted) {
      try {
        await ensureGroup();
        await processOnce();
        failures = 0;
        stats.lastPassFailed = false;
      } catch (error) {
        failures += 1;
        stats.failedBatches += 1;
        stats.lastPassFailed = true;
        logger?.error({ err: error, failures }, 'click consumer pass failed; will retry');

        await sleep(Math.min(1000 * 2 ** (failures - 1), 30_000), undefined, { signal }).catch(() => {});
      }
    }
  }

  // Deletes entries that were acknowledged but not deleted (a crash between XACK and XDEL).
  // Everything older than both the oldest pending entry and the group's last delivered id is
  // acknowledged, so it is safe to trim; pending and never-read entries are kept.
  // Returns the number of entries removed.
  async function trimProcessed() {
    const groups = await redis.xInfoGroups(streamKey);
    const group = groups.find((candidate) => candidate.name === CONSUMER_GROUP);

    if (!group) return 0;

    const { firstId } = await redis.xPending(streamKey, CONSUMER_GROUP);
    const boundary = firstId && compareIds(firstId, group['last-delivered-id']) < 0 ? firstId : group['last-delivered-id'];

    return redis.xTrim(streamKey, 'MINID', boundary);
  }

  // Time of the oldest entry still in the stream (unread or pending), or null when empty.
  async function oldestUnprocessedAt() {
    const [oldest] = await redis.xRange(streamKey, '-', '+', { COUNT: 1 });

    return oldest ? Number(oldest.id.split('-')[0]) : null;
  }

  return { ensureGroup, processOnce, run, trimProcessed, oldestUnprocessedAt, snapshot: () => ({ ...stats }) };
}
