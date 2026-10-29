// Measures end-to-end analytics freshness on a running stack (technical-design §5: target is
// normal-operation visibility within 10 seconds). For each of N real redirects it records the
// time until the owner's analytics API first includes that click.
//
//   EMAIL=... PASSWORD=... node scripts/measure-analytics-freshness.mjs [clicks] [spacingMs]
//
// Measures server-side visibility: redirect → capture → stream → worker → database → API.
// A dashboard adds its own polling interval on top (5 s planned for the UI).

import { setTimeout as sleep } from 'node:timers/promises';

const API = process.env.API_URL ?? 'http://localhost:3000';
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:4200';
const CLICKS = Number(process.argv[2] ?? 40);
const SPACING_MS = Number(process.argv[3] ?? 250);
// Owners may read analytics 120 times a minute (memberRead policy); polling faster would be
// throttled with 429 and wrongly look like slow analytics. Results are only as fine as this.
const POLL_MS = Number(process.env.POLL_MS ?? 600);

let cookie = '';
let csrfToken = '';

async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    redirect: 'manual',
    headers: { Origin: ORIGIN, Cookie: cookie, 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const setCookie = response.headers.getSetCookie().find((value) => value.startsWith('__Host-session='));

  if (setCookie) cookie = setCookie.split(';')[0];

  return response;
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main() {
  if (!process.env.EMAIL || !process.env.PASSWORD) throw new Error('Set EMAIL and PASSWORD of a verified account');

  csrfToken = (await (await call('/api/v1/auth/csrf')).json()).csrfToken;

  const login = await call('/api/v1/auth/login', { method: 'POST', body: { email: process.env.EMAIL, password: process.env.PASSWORD } });

  if (login.status !== 200) throw new Error(`sign-in failed: HTTP ${login.status}`);

  csrfToken = (await login.json()).csrfToken;

  const link = await (await call('/api/v1/links', { method: 'POST', body: { destinationUrl: 'https://example.com/freshness' } })).json();
  const clickTimes = [];
  const visibleAfter = [];
  let polling = true;
  let throttled = 0;

  // Poll the analytics API; when the count reaches k, clicks 1..k are visible.
  const poller = (async () => {
    let seen = 0;

    while (polling || seen < clickTimes.length) {
      const response = await call(`/api/v1/links/${link.id}/analytics`);
      const now = performance.now();

      if (response.status === 200) {
        const count = Number((await response.json()).rangeClicks);

        for (; seen < Math.min(count, clickTimes.length); seen += 1) visibleAfter.push(now - clickTimes[seen]);
      } else {
        throttled += 1;
        await response.body?.cancel();
      }

      await sleep(POLL_MS);
    }
  })();

  for (let i = 0; i < CLICKS; i += 1) {
    clickTimes.push(performance.now());
    await fetch(`${API}/r/${link.code}`, { redirect: 'manual' });
    await sleep(SPACING_MS);
  }

  polling = false;

  await Promise.race([poller, sleep(30_000)]);

  const sorted = [...visibleAfter].sort((a, b) => a - b);
  const final = await (await call(`/api/v1/links/${link.id}/analytics`)).json();

  console.log(JSON.stringify({
    clicks: CLICKS,
    counted: visibleAfter.length,
    pollIntervalMs: POLL_MS,
    rejectedPolls: throttled,
    secondsUntilVisible: {
      p50: +(percentile(sorted, 50) / 1000).toFixed(2),
      p95: +(percentile(sorted, 95) / 1000).toFixed(2),
      max: +(sorted.at(-1) / 1000).toFixed(2),
    },
    withinTenSeconds: sorted.filter((ms) => ms <= 10_000).length,
    pipelineStatus: final.pipeline.status,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
