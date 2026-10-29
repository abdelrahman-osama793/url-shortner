import { setTimeout as sleep } from 'node:timers/promises';

// Periodic housekeeping in the worker: retention cleanup and trimming stream entries that were
// processed but not deleted. Runs once at start, then every `intervalMs` (default hourly).
// A failed run is logged and retried at the next interval; it never stops the worker.
export function createMaintenance({ retention, consumer, logger }) {
  async function runOnce() {
    await retention.runOnce();

    const trimmed = await consumer.trimProcessed();

    if (trimmed > 0) logger?.info({ trimmed }, 'trimmed processed click stream entries');
  }

  async function run(signal, intervalMs = 60 * 60_000) {
    while (!signal.aborted) {
      try {
        await runOnce();
      } catch (error) {
        logger?.error({ err: error }, 'maintenance run failed; will retry next interval');
      }

      await sleep(intervalMs, undefined, { signal }).catch(() => {});
    }
  }

  return { runOnce, run };
}
