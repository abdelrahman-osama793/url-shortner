// DEVELOPMENT TOOL — T35: server-side redirect latency from the API request logs (durationMs is
// measured inside the API from request arrival to response finish; no network, no generator).
//
//   node scripts/bench/server-latency.mjs <fromEpochMs> <toEpochMs> api-*.log

import { readFileSync } from 'node:fs';

const [from, to, ...files] = process.argv.slice(2);
const durations = [];
const statuses = {};

for (const file of files) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"request finished"')) continue;
    const entry = JSON.parse(line);

    if (!entry.path?.startsWith('/r/') || Date.parse(entry.time) < Number(from) || Date.parse(entry.time) > Number(to)) continue;
    durations.push(entry.durationMs);
    statuses[entry.status] = (statuses[entry.status] ?? 0) + 1;
  }
}

durations.sort((a, b) => a - b);
const at = (q) => durations[Math.min(durations.length - 1, Math.ceil(q * durations.length) - 1)];

console.log(JSON.stringify({ count: durations.length, statuses, ms: { p50: at(0.5), p90: at(0.9), p95: at(0.95), p99: at(0.99), p999: at(0.999), max: at(1) } }));
