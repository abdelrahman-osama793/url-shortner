// DEVELOPMENT TOOL — T35 capacity benchmark: open-model load generator. Run it as its own
// process (ideally on its own cores, see run.sh), never inside the API.
//
//   node scripts/bench/load.mjs <broad|hot|mixed> <rate/s> <seconds> [warmupSeconds]
//
// Open model: requests are sent on a fixed schedule whatever the server does, and latency is
// measured from the *scheduled* send time, so a slow server cannot hide its queueing delay
// (no coordinated omission). Workloads, over the seeded codes b0000000 … (seed.mjs):
//   broad  every code equally likely (cold rows, the database's worst case)
//   hot    90 % of redirects go to 1,000 popular codes, 10 % spread over all
//   mixed  broad redirects plus a signed-in owner reading analytics (~1.6/s) and creating
//          links (~9/min), the most their rate limits allow
//
// Environment: BENCH_TARGETS (comma-separated API origins, round-robin like a load balancer),
// BENCH_LINKS (default 1,000,000), BENCH_DATABASE_URL and BENCH_REDIS_URL (lag and loss),
// BENCH_PIDS (host API/worker processes to sample), BENCH_OWNER_PASSWORD (mixed only).
// Prints one JSON report.

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

import pg from 'pg';
import { createClient } from 'redis';

import { CLICK_STREAM } from '../../src/modules/analytics/click-capture.service.js';
import { CONSUMER_GROUP } from '../../src/modules/analytics/click-consumer.service.js';

const [workload, rateArg, secondsArg, warmupArg] = process.argv.slice(2);
const RATE = Number(rateArg);
const SECONDS = Number(secondsArg);
const WARMUP = Number(warmupArg ?? 30);
const LINKS = Number(process.env.BENCH_LINKS ?? 1_000_000);
const TARGETS = (process.env.BENCH_TARGETS ?? 'http://localhost:3101').split(',').map((target) => new URL(target));
const PIDS = (process.env.BENCH_PIDS ?? '').split(',').filter(Boolean).map(Number);
const ORIGIN = 'http://localhost:4200';
const MAX_IN_FLIGHT = 20_000;
const HOT = Array.from({ length: 1000 }, (_, k) => (k * 7919) % LINKS);

if (!['broad', 'hot', 'mixed'].includes(workload) || !(RATE > 0) || !(SECONDS > 0)) {
  console.error('Usage: node scripts/bench/load.mjs <broad|hot|mixed> <rate/s> <seconds> [warmupSeconds]');
  process.exit(2);
}

const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });
const code = (i) => `b${String(i).padStart(7, '0')}`;
const pick = () => (workload === 'hot' && Math.random() < 0.9
  ? HOT[Math.floor(Math.random() * HOT.length)]
  : Math.floor(Math.random() * LINKS));

// One HTTP request; resolves to { status, ms } where ms counts from `scheduledAt`.
function send(target, { method = 'GET', path, headers = {}, body }, scheduledAt) {
  return new Promise((resolve) => {
    const request = http.request({ host: target.hostname, port: target.port, method, path, agent, headers }, (response) => {
      const chunks = [];

      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        ms: performance.now() - scheduledAt,
        headers: response.headers,
        body: Buffer.concat(chunks).toString(),
      }));
    });

    request.on('error', (error) => resolve({ status: error.code ?? 'error', ms: performance.now() - scheduledAt }));
    request.end(body);
  });
}

function summarize(samples) {
  const sorted = Float64Array.from(samples).sort();
  const at = (q) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] * 10) / 10 : null);

  return { count: sorted.length, p50: at(0.5), p90: at(0.9), p95: at(0.95), p99: at(0.99), p999: at(0.999), max: at(1) };
}

// ---- Analytics pipeline and resources, sampled every 5 s -------------------------------------

const db = new pg.Pool({ connectionString: process.env.BENCH_DATABASE_URL, max: 2 });
const redis = createClient({ url: process.env.BENCH_REDIS_URL });
const run = promisify(execFile);

const countedClicks = async () => Number((await db.query('SELECT coalesce(sum(clicks), 0)::bigint AS n FROM link_totals')).rows[0].n);

async function pipeline() {
  const groups = await redis.xInfoGroups(CLICK_STREAM).catch(() => []);
  const group = groups.find((g) => g.name === CONSUMER_GROUP);

  return { streamLength: await redis.xLen(CLICK_STREAM), lag: group?.lag ?? null, pending: group?.pending ?? null };
}

const cpuTicks = (pid) => {
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');

    return Number(fields[11]) + Number(fields[12]); // utime + stime, in 1/100 s
  } catch {
    return null;
  }
};

const samples = [];
let previous = { at: performance.now(), ticks: PIDS.map(cpuTicks), self: process.cpuUsage() };

async function sample(phase) {
  const now = performance.now();
  const ticks = PIDS.map(cpuTicks);
  const self = process.cpuUsage();
  const seconds = (now - previous.at) / 1000;
  const { stdout } = await run('docker', ['stats', '--no-stream', '--format', '{{.Name}} {{.CPUPerc}} {{.MemUsage}}', 'shortlist-postgres-1', 'shortlist-redis-1'])
    .catch(() => ({ stdout: '' }));

  samples.push({
    t: Math.round((now - startedAt) / 1000),
    phase,
    ...(await pipeline()),
    hostCpuPercent: Object.fromEntries(PIDS.map((pid, i) => [pid, ticks[i] === null ? null : Math.round((ticks[i] - previous.ticks[i]) / seconds)])),
    generatorCpuPercent: Math.round(((self.user - previous.self.user) + (self.system - previous.self.system)) / 1e4 / seconds),
    containers: stdout.trim().split('\n').filter(Boolean),
  });
  previous = { at: now, ticks, self };
}

// ---- Mixed workload: one signed-in owner at the edge of their rate limits ----------------------

async function owner() {
  const target = TARGETS[0];
  let cookie = '';
  let csrf = '';
  const call = async (options, scheduledAt = performance.now()) => {
    const result = await send(target, {
      ...options,
      headers: {
        Origin: ORIGIN,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    }, scheduledAt);
    const setCookie = [].concat(result.headers?.['set-cookie'] ?? []).find((value) => value.startsWith('__Host-session='));

    if (setCookie) cookie = setCookie.split(';')[0];

    return result;
  };

  csrf = JSON.parse((await call({ path: '/api/v1/auth/csrf' })).body).csrfToken;
  const login = await call({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: JSON.stringify({ email: 'bench-owner-0000@example.test', password: process.env.BENCH_OWNER_PASSWORD }),
  });

  if (login.status !== 200) throw new Error(`owner sign-in failed: HTTP ${login.status}`);
  csrf = JSON.parse(login.body).csrfToken;

  const ids = JSON.parse((await call({ path: '/api/v1/links?limit=50' })).body).items.map((link) => link.id);

  return { call, ids };
}

// ---- Run ------------------------------------------------------------------------------------

await redis.connect();

const session = workload === 'mixed' ? await owner() : null;
const clicksBefore = await countedClicks();
const startedAt = performance.now();
const startedEpoch = Date.now();
const endAt = startedAt + (WARMUP + SECONDS) * 1000;
const measureFrom = startedAt + WARMUP * 1000;
const redirectMs = [];
const statuses = {};
const other = { analytics: { ms: [], statuses: {} }, create: { ms: [], statuses: {} } };
let scheduled = 0;
let inFlight = 0;
let skipped = 0;
let redirects302 = 0;
let maxLateMs = 0;

const sampler = setInterval(() => {
  sample(performance.now() < measureFrom ? 'warmup' : 'measured').catch(() => {});
}, 5000);

function fire(scheduledAt) {
  if (inFlight >= MAX_IN_FLIGHT) {
    skipped += 1;

    return;
  }

  const target = TARGETS[scheduled % TARGETS.length];
  const measured = scheduledAt >= measureFrom;

  inFlight += 1;
  send(target, { path: `/r/${code(pick())}` }, scheduledAt).then(({ status, ms }) => {
    inFlight -= 1;
    if (status === 302) redirects302 += 1;
    if (!measured) return;
    redirectMs.push(ms);
    statuses[status] = (statuses[status] ?? 0) + 1;
  });
}

function every(intervalMs, kind, request) {
  const loop = async () => {
    for (let next = performance.now(); next < endAt; next += intervalMs) {
      await sleep(Math.max(0, next - performance.now()));
      const result = await session.call(request(), next);

      if (next >= measureFrom) {
        other[kind].ms.push(result.ms);
        other[kind].statuses[result.status] = (other[kind].statuses[result.status] ?? 0) + 1;
      }
    }
  };

  return loop();
}

const sideLoad = session
  ? Promise.all([
    every(625, 'analytics', () => ({ path: `/api/v1/links/${session.ids[Math.floor(Math.random() * session.ids.length)]}/analytics` })),
    every(6500, 'create', () => ({ method: 'POST', path: '/api/v1/links', body: JSON.stringify({ destinationUrl: `https://example.com/bench/new/${Date.now()}` }) })),
  ])
  : Promise.resolve();

// Scheduler: every millisecond, send every request whose scheduled time has passed.
while (performance.now() < endAt) {
  const now = performance.now();
  const due = Math.floor(((now - startedAt) / 1000) * RATE);

  while (scheduled < due) {
    const scheduledAt = startedAt + (scheduled / RATE) * 1000;

    maxLateMs = Math.max(maxLateMs, now - scheduledAt);
    fire(scheduledAt);
    scheduled += 1;
  }
  await sleep(1);
}

await sideLoad;
while (inFlight > 0) await sleep(50);
clearInterval(sampler);
await sample('end');

// Wait for the worker to drain the stream, then compare counted clicks with 302s sent.
const drainStarted = performance.now();
let drain = await pipeline();

while ((drain.lag > 0 || drain.pending > 0) && performance.now() - drainStarted < 180_000) {
  await sleep(1000);
  drain = await pipeline();
}

const counted = (await countedClicks()) - clicksBefore;
const measured = redirectMs.length;

console.log(JSON.stringify({
  workload,
  targetRate: RATE,
  seconds: SECONDS,
  warmupSeconds: WARMUP,
  targets: TARGETS.map(String),
  measuredWindowEpochMs: [startedEpoch + WARMUP * 1000, startedEpoch + (WARMUP + SECONDS) * 1000],
  redirects: {
    measured,
    achievedRate: Math.round(measured / SECONDS),
    statuses,
    unexpectedErrors: Object.entries(statuses).filter(([s]) => !['302', '404', '410'].includes(s)).reduce((n, [, c]) => n + c, 0),
    msFromSchedule: summarize(redirectMs),
  },
  ...(session ? {
    analytics: { statuses: other.analytics.statuses, ms: summarize(other.analytics.ms) },
    create: { statuses: other.create.statuses, ms: summarize(other.create.ms) },
  } : {}),
  generator: { skippedAtInFlightCap: skipped, maxSchedulerLateMs: Math.round(maxLateMs) },
  clicks: {
    redirects302AllPhases: redirects302,
    countedByWorker: counted,
    lost: redirects302 - counted,
    lossPercent: redirects302 ? Math.round(((redirects302 - counted) / redirects302) * 10000) / 100 : 0,
    drainSeconds: Math.round((performance.now() - drainStarted) / 1000),
    drainedFully: drain.lag === 0 && drain.pending === 0,
  },
  samples,
}, null, 2));

await redis.quit();
await db.end();
agent.destroy();
