#!/usr/bin/env bash
# DEVELOPMENT TOOL — T35 capacity benchmark: one run against the seeded benchmark database.
#
#   scripts/bench/run.sh <workload> <rate> <seconds> [warmup]
#
# Starts BENCH_APIS API processes (default 4, ports 3101…) and one analytics worker from the
# host, all on the benchmark database (shortlist_bench) and Redis database 1, so development
# data is untouched. The load generator runs as a separate process pinned to its own CPUs.
# Settings under test: BENCH_APIS, DATABASE_POOL_MAX (per API process), LOG_LEVEL.
# Results (report JSON, server-side latency, logs) go to bench-results/<timestamp>-<workload>/.
set -euo pipefail

workload=$1 rate=$2 seconds=$3 warmup=${4:-30}
root=$(cd "$(dirname "$0")/../../../.." && pwd)
server="$root/apps/server"
set -a; . "$root/.env"; set +a

apis=${BENCH_APIS:-4}
out="$root/bench-results/$(date +%Y%m%d-%H%M%S)-$workload-$rate"
mkdir -p "$out"

export NODE_ENV=development LOG_LEVEL=${LOG_LEVEL:-info} CHALLENGE_PROVIDER=dev
export DATABASE_URL="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:${POSTGRES_PORT:-5432}/shortlist_bench"
export REDIS_URL="redis://:$REDIS_PASSWORD@localhost:${REDIS_PORT:-6380}/1"
export SMTP_URL="smtp://localhost:${MAILPIT_SMTP_PORT:-1025}" PUBLIC_BASE_URL=http://localhost:4200
export DATABASE_POOL_MAX=${DATABASE_POOL_MAX:-10}

# CPUs: generator on the last two, servers on the rest (PostgreSQL and Redis run in Docker, unpinned).
last=$(($(nproc) - 1))
pids=() targets=()
cd "$server"
for i in $(seq 1 "$apis"); do
  PORT=$((3100 + i)) taskset -c "0-$((last - 2))" node src/api.js > "$out/api-$i.log" 2>&1 &
  pids+=($!) targets+=("http://localhost:$((3100 + i))")
done
taskset -c "0-$((last - 2))" node src/worker.js > "$out/worker.log" 2>&1 &
pids+=($!)
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT

for t in "${targets[@]}"; do
  until curl -sf "$t/health/ready" > /dev/null; do sleep 0.2; done
done

echo "apis=$apis pool=$DATABASE_POOL_MAX log=$LOG_LEVEL workload=$workload rate=$rate seconds=$seconds warmup=$warmup" | tee "$out/settings.txt"
BENCH_TARGETS=$(IFS=,; echo "${targets[*]}") BENCH_PIDS=$(IFS=,; echo "${pids[*]}") \
  BENCH_DATABASE_URL="$DATABASE_URL" BENCH_REDIS_URL="$REDIS_URL" \
  taskset -c "$((last - 1))-$last" node scripts/bench/load.mjs "$workload" "$rate" "$seconds" "$warmup" > "$out/report.json"

window=$(node -e 'const r=require(process.argv[1]); console.log(r.measuredWindowEpochMs.join(" "))' "$out/report.json")
# shellcheck disable=SC2086
node scripts/bench/server-latency.mjs $window "$out"/api-*.log > "$out/server-latency.json"
echo "$out"
node -e 'const r=require(process.argv[1]); const s=require(process.argv[2]); console.log(JSON.stringify({redirects: r.redirects, server: s, generator: r.generator, clicks: r.clicks, analytics: r.analytics, create: r.create}, null, 1))' "$out/report.json" "$out/server-latency.json"
