import { setTimeout as sleep } from 'node:timers/promises';

import * as repository from './pipeline.repository.js';

// Analytics pipeline health (technical-design §5; api-contracts.md, "Analytics contract").
//
// The worker reports a heartbeat every few seconds: when it last committed a batch, the age of
// the oldest event still waiting in the stream, and whether its last pass failed.
// The API turns that, plus recent capture losses, into one status for analytics responses:
//   unknown   no heartbeat recently: the worker is down or has never run
//   degraded  click capture lost events recently, or the worker's last pass failed
//   delayed   the oldest waiting event is older than the freshness target
//   healthy   none of the above
// A heartbeat proves the worker is alive, not that every click was counted, so capture losses
// are checked separately. An empty queue never counts as proof of "no losses".

export const ANALYTICS_WORKER_NAME = 'analytics-consumer';
export const CAPTURE_LOSS_KEY = 'analytics:capture-loss-at';

// Worker side: writes the heartbeat. A failed write simply leaves the heartbeat to go stale,
// which readers then report as "unknown".
export function createPipelineReporter({ pool, consumer, name = ANALYTICS_WORKER_NAME, logger }) {
  async function reportOnce() {
    let oldestPendingAt = null;
    let redisFailed = false;

    try {
      const oldest = await consumer.oldestUnprocessedAt();

      oldestPendingAt = oldest === null ? null : new Date(oldest);
    } catch {
      redisFailed = true;
    }

    const { lastCommittedAt, lastPassFailed } = consumer.snapshot();

    await repository.upsertWorkerState(pool, {
      name,
      lastBatchCommittedAt: lastCommittedAt === null ? null : new Date(lastCommittedAt),
      oldestPendingAt,
      status: redisFailed || lastPassFailed ? 'degraded' : 'healthy',
    });
  }

  async function run(signal, intervalMs = 5000) {
    while (!signal.aborted) {
      try {
        await reportOnce();
      } catch (error) {
        logger?.warn({ err: error }, 'analytics heartbeat could not be written');
      }

      await sleep(intervalMs, undefined, { signal }).catch(() => {});
    }
  }

  return { reportOnce, run };
}

// API side: computes the status shown with analytics. `clickCapture` gives this instance's own
// recent losses; the shared Redis key carries losses seen by other instances.
export function createPipelineStatusReader({
  pool,
  redis,
  keyPrefix = '',
  clickCapture,
  name = ANALYTICS_WORKER_NAME,
  staleAfterMs = 30_000,
  delayedAfterMs = 10_000,
  lossWindowMs = 5 * 60_000,
  clock = () => Date.now(),
}) {
  async function sharedLossAt() {
    try {
      const value = await redis?.get(`${keyPrefix}${CAPTURE_LOSS_KEY}`);

      return value ? Number(value) : null;
    } catch {
      return null;
    }
  }

  async function getPipelineStatus() {
    const now = clock();
    const state = await repository.findWorkerState(pool, name);
    const localLossAt = clickCapture?.snapshot().lastLossAt ?? null;
    const lossAt = Math.max(localLossAt ?? 0, (await sharedLossAt()) ?? 0) || null;

    const heartbeatAt = state?.heartbeat_at ?? null;
    const oldestPendingAt = state?.oldest_pending_at ?? null;

    let status;

    if (!heartbeatAt || now - heartbeatAt.getTime() > staleAfterMs) status = 'unknown';
    else if ((lossAt && now - lossAt < lossWindowMs) || state.status === 'degraded') status = 'degraded';
    else if (oldestPendingAt && now - oldestPendingAt.getTime() > delayedAfterMs) status = 'delayed';
    else status = 'healthy';

    return {
      status,
      heartbeatAt: heartbeatAt?.toISOString() ?? null,
      oldestPendingAt: oldestPendingAt?.toISOString() ?? null,
    };
  }

  return { getPipelineStatus };
}
