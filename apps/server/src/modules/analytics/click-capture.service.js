import { randomUUID } from 'node:crypto';

import { TimeoutError } from 'redis';

import { countryCode } from './rules/country.js';
import { classifyDevice } from './rules/device.js';
import { referrerHost } from './rules/referrer.js';

// Publishes one compact event per successful GET redirect to a Redis Stream (technical-design §4
// and §5). The redirect never waits for this: the caller sends the 302 first and starts the
// capture in the background. What is stored: event id, link id and version, time, country, device
// category, referring host and a bot flag. Never the IP address, User-Agent, full referrer or
// query string.
//
// Every way an event can be lost is counted, so analytics can be reported as approximate rather
// than exact:
//   queue_full    the stream already holds `queueCap` entries; new events are refused, queued
//                 ones are never evicted
//   timeout       Redis did not answer within `publishTimeoutMs` (the event may or may not have
//                 been stored; it is not retried)
//   redis_error   Redis refused or is offline
//   overloaded    too many publishes already in flight; bounds memory when Redis is slow
//   circuit_open  recent failures opened the circuit breaker; events are dropped without
//                 trying, so a broken Redis costs nothing per redirect

export const CLICK_STREAM = 'clicks:v1';

// Atomic bounded admission: add only while the stream is below the cap.
const ADMIT_SCRIPT = `
if redis.call('XLEN', KEYS[1]) >= tonumber(ARGV[1]) then
  return 0
end
redis.call('XADD', KEYS[1], '*', unpack(ARGV, 2))
return 1
`;

// Browsers mark speculative loads; they are not visits.
function isPrefetch(headers) {
  const purpose = `${headers.secPurpose ?? ''} ${headers.purpose ?? ''} ${headers.xMoz ?? ''}`.toLowerCase();

  return purpose.includes('prefetch') || purpose.includes('prerender');
}

export function createClickCaptureService({
  redis,
  keyPrefix = '',
  queueCap = 50_000,
  publishTimeoutMs = 20,
  maxInFlight = 1000,
  failureThreshold = 5,
  openMs = 5000,
  clock = () => Date.now(),
  logger,
}) {
  const client = redis.withCommandOptions({ timeout: publishTimeoutMs });
  const streamKey = `${keyPrefix}${CLICK_STREAM}`;

  const stats = {
    captured: 0,
    skipped: { prefetch: 0 },
    dropped: { queue_full: 0, timeout: 0, redis_error: 0, overloaded: 0, circuit_open: 0 },
    lastLossAt: null,
  };

  let inFlight = 0;
  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;

  function drop(reason) {
    stats.dropped[reason] += 1;
    stats.lastLossAt = clock();

    return reason;
  }

  function recordFailure() {
    consecutiveFailures += 1;

    if (consecutiveFailures >= failureThreshold) {
      circuitOpenUntil = clock() + openMs;
      consecutiveFailures = 0;
      logger?.warn({ openMs }, 'click capture circuit opened after repeated Redis failures');
    }
  }

  // `click` = { linkId, linkVersion, headers: { userAgent, referer, country, secPurpose, purpose, xMoz } }
  function toFields({ linkId, linkVersion, headers }) {
    const device = classifyDevice(headers.userAgent);

    return [
      'v', '1',
      'e', randomUUID(),
      'l', linkId,
      'lv', String(linkVersion),
      't', String(clock()),
      'c', countryCode(headers.country),
      'd', device,
      'r', referrerHost(headers.referer),
      'b', device === 'bot' ? '1' : '0',
    ];
  }

  // Resolves to the outcome ('captured', 'prefetch', or a drop reason). Never rejects.
  async function capture(click) {
    if (isPrefetch(click.headers)) {
      stats.skipped.prefetch += 1;
      return 'prefetch';
    }

    if (clock() < circuitOpenUntil) return drop('circuit_open');
    if (inFlight >= maxInFlight) return drop('overloaded');

    inFlight += 1;

    try {
      const admitted = await client.eval(ADMIT_SCRIPT, {
        keys: [streamKey],
        arguments: [String(queueCap), ...toFields(click)],
      });

      consecutiveFailures = 0;

      if (Number(admitted) !== 1) return drop('queue_full');

      stats.captured += 1;
      return 'captured';
    } catch (error) {
      recordFailure();

      // node-redis timeouts are TimeoutError instances (their .name is the generic 'Error').
      return drop(error instanceof TimeoutError ? 'timeout' : 'redis_error');
    } finally {
      inFlight -= 1;
    }
  }

  // For the redirect path: start capturing and return immediately.
  function captureInBackground(click) {
    capture(click).catch((error) => logger?.error({ err: error }, 'click capture failed unexpectedly'));
  }

  function snapshot() {
    return structuredClone({ ...stats, inFlight, circuitOpen: clock() < circuitOpenUntil });
  }

  // Logs capture counts every `intervalMs` while there is activity. Returns a stop function.
  function startStatsLog(intervalMs = 60_000) {
    let previous = JSON.stringify(snapshot());

    const timer = setInterval(() => {
      const current = snapshot();
      const serialized = JSON.stringify(current);

      if (serialized !== previous) logger?.info({ clickCapture: current }, 'click capture stats');

      previous = serialized;
    }, intervalMs);

    timer.unref();

    return () => clearInterval(timer);
  }

  return { capture, captureInBackground, snapshot, startStatsLog };
}
