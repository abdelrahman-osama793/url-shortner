// DEVELOPMENT TOOL — T34 drills against the real local stack, not part of the application.
//
//   node scripts/t34-drills.mjs instances   two API processes sharing PostgreSQL and Redis
//   node scripts/t34-drills.mjs overload    a burst far above the database pool on one instance
//   node scripts/t34-drills.mjs clicks <code> <count> [concurrency]   send real redirects
//
// Instance A is the Docker API (:3000); instance B is a second process started from the host
// (:3001) with the same configuration. Mailpit (:8025) supplies verification links. Prints JSON.

import { randomUUID } from 'node:crypto';

const A = process.env.API_A ?? 'http://localhost:3000';
const B = process.env.API_B ?? 'http://localhost:3001';
const MAILPIT = process.env.MAILPIT ?? 'http://localhost:8025';
const ORIGIN = 'http://localhost:4200';

// A minimal browser: one session cookie and its CSRF token, usable against either instance.
async function newBrowser(base) {
  const browser = { cookie: null, csrf: null };

  browser.request = async (target, path, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(`${target}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        Origin: ORIGIN,
        ...(browser.cookie ? { Cookie: browser.cookie } : {}),
        ...(browser.csrf && method !== 'GET' ? { 'X-CSRF-Token': browser.csrf } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith('__Host-session='));

    if (setCookie) browser.cookie = setCookie.split(';')[0];

    return response;
  };

  browser.csrf = (await (await browser.request(base, '/api/v1/auth/csrf')).json()).csrfToken;

  return browser;
}

async function verificationToken(email) {
  for (let i = 0; i < 40; i += 1) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();

    if (list.messages?.length) {
      const text = (await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json()).Text;

      return text.match(/#token=(\S+)/)[1];
    }
    await new Promise((resolve) => { setTimeout(resolve, 250); });
  }

  throw new Error(`no verification email for ${email}`);
}

// A verified, signed-in owner: registers on one instance, verifies and signs in on the other.
async function newOwner(registerOn, signInOn) {
  const email = `t34-${randomUUID().slice(0, 8)}@example.test`;
  const password = `local-${randomUUID()}`;
  const browser = await newBrowser(registerOn);

  await browser.request(registerOn, '/api/v1/auth/register', { method: 'POST', body: { email, password } });
  await browser.request(signInOn, '/api/v1/auth/email/verify', { method: 'POST', body: { token: await verificationToken(email) } });

  const login = await browser.request(signInOn, '/api/v1/auth/login', { method: 'POST', body: { email, password } });

  browser.csrf = (await login.json()).csrfToken;
  browser.email = email;

  return browser;
}

const location = async (base, code) => {
  const response = await fetch(`${base}/r/${code}`, { redirect: 'manual' });

  return { status: response.status, location: response.headers.get('location') };
};

async function instances() {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });

  // Sessions live in Redis and are checked against PostgreSQL, so either instance accepts them.
  const owner = await newOwner(A, B);
  const meOnA = await owner.request(A, '/api/v1/auth/me');
  check('a session created on B is valid on A', meOnA.status === 200);

  // Edits and disables through one instance are seen by the very next redirect on the other.
  const created = await (await owner.request(B, '/api/v1/links', { method: 'POST', body: { destinationUrl: 'https://example.com/v0' } })).json();
  let link = created;
  let stale = 0;

  for (let i = 1; i <= 40; i += 1) {
    const [writer, reader] = i % 2 ? [A, B] : [B, A];
    const response = await owner.request(writer, `/api/v1/links/${link.id}`, {
      method: 'PATCH',
      body: { destinationUrl: `https://example.com/v${i}` },
      headers: { 'If-Match': `"v${link.version}"` },
    });

    link = await response.json();
    if ((await location(reader, link.code)).location !== `https://example.com/v${i}`) stale += 1;
  }
  check('40 edits alternating A/B: the next redirect on the other instance always used the new destination', stale === 0, { stale });

  await owner.request(A, `/api/v1/links/${link.id}`, { method: 'PATCH', body: { enabled: false }, headers: { 'If-Match': `"v${link.version}"` } });
  check('a disable on A is a 410 on B immediately', (await location(B, link.code)).status === 410);

  // Concurrent edits from the same version, split across instances: exactly one wins.
  const fresh = await (await owner.request(A, '/api/v1/links', { method: 'POST', body: { destinationUrl: 'https://example.com/race' } })).json();
  const edits = await Promise.all(Array.from({ length: 10 }, (_, i) => owner.request(i % 2 ? A : B, `/api/v1/links/${fresh.id}`, {
    method: 'PATCH',
    body: { destinationUrl: `https://example.com/race-${i}` },
    headers: { 'If-Match': `"v${fresh.version}"` },
  })));
  const editStatuses = edits.map((response) => response.status);
  check('10 concurrent edits of one version across instances: one 200, nine 412', editStatuses.filter((s) => s === 200).length === 1 && editStatuses.filter((s) => s === 412).length === 9, editStatuses.join(','));

  // One alias claimed by different owners at the same time on both instances: exactly one wins.
  const rivals = [owner, await newOwner(B, A), await newOwner(A, B), await newOwner(B, A)];
  const alias = `t34-${randomUUID().slice(0, 8)}`;
  const claims = await Promise.all(rivals.flatMap((browser, i) => [A, B].map((target) => browser.request(target, '/api/v1/links', {
    method: 'POST',
    body: { destinationUrl: `https://example.com/claim-${i}`, customAlias: alias },
  }))));
  const claimStatuses = claims.map((response) => response.status);
  check('8 simultaneous claims of one alias (4 owners × 2 instances): one 201, the rest 409', claimStatuses.filter((s) => s === 201).length === 1 && claimStatuses.filter((s) => s === 409).length === 7, claimStatuses.join(','));

  // One idempotency key retried concurrently on both instances: one link, the same answer.
  // (A fresh owner: every request, replays included, counts toward the 10-per-minute limit.)
  const retrier = await newOwner(B, A);
  const key = randomUUID();
  const retries = await Promise.all(Array.from({ length: 8 }, (_, i) => retrier.request(i % 2 ? A : B, '/api/v1/links', {
    method: 'POST',
    body: { destinationUrl: 'https://example.com/idempotent' },
    headers: { 'Idempotency-Key': key },
  })));
  const retryBodies = await Promise.all(retries.map((response) => response.json()));
  const ids = new Set(retryBodies.filter((body) => body.id).map((body) => body.id));
  check('8 concurrent retries of one Idempotency-Key across instances: all 201 with one link id', retries.every((r) => r.status === 201) && ids.size === 1, { statuses: retries.map((r) => r.status).join(','), ids: ids.size });

  // The per-user creation limit (10 per minute) is shared: 14 attempts split across instances.
  const quotaOwner = await newOwner(A, B);
  const burst = await Promise.all(Array.from({ length: 14 }, (_, i) => quotaOwner.request(i % 2 ? A : B, '/api/v1/links', {
    method: 'POST',
    body: { destinationUrl: `https://example.com/quota-${i}` },
  })));
  const burstStatuses = burst.map((response) => response.status);
  check('14 creations in a minute split across A and B: exactly 10 succeed, 4 are 429', burstStatuses.filter((s) => s === 201).length === 10 && burstStatuses.filter((s) => s === 429).length === 4, burstStatuses.join(','));

  // Authorisation is the same everywhere.
  const stranger = rivals[1];
  check("another owner gets 404 for someone else's link on both instances", (await stranger.request(A, `/api/v1/links/${fresh.id}`)).status === 404 && (await stranger.request(B, `/api/v1/links/${fresh.id}`)).status === 404);
  check("another owner cannot edit it either (404)", (await stranger.request(B, `/api/v1/links/${fresh.id}`, { method: 'PATCH', body: { enabled: false }, headers: { 'If-Match': '"v1"' } })).status === 404);
  check('owners get 403 from admin endpoints on both instances', (await owner.request(A, '/api/v1/admin/reports')).status === 403 && (await owner.request(B, '/api/v1/admin/reports')).status === 403);

  const noToken = await fetch(`${B}/api/v1/links`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: owner.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ destinationUrl: 'https://example.com/csrf' }) });
  check('a write without the CSRF token is refused (403)', noToken.status === 403);
  const foreignOrigin = await fetch(`${A}/api/v1/links`, { method: 'POST', headers: { Origin: 'https://evil.example', Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ destinationUrl: 'https://example.com/csrf' }) });
  check('a write from another origin is refused even with the token (403)', foreignOrigin.status === 403);

  // Logging out on one instance ends the session on the other.
  await owner.request(B, '/api/v1/auth/logout', { method: 'POST' });
  check('after logout on B the same cookie is rejected on A (401)', (await owner.request(A, '/api/v1/auth/me')).status === 401);

  return { checks, passed: checks.filter((c) => c.ok).length, total: checks.length };
}

// Many more simultaneous redirects than the database pool (10) and its wait queue (50) can hold.
async function overload(total = 3000, concurrency = 400) {
  const owner = await newOwner(A, A);
  const link = await (await owner.request(A, '/api/v1/links', { method: 'POST', body: { destinationUrl: 'https://example.com/overload' } })).json();
  const statuses = {};
  const durations = [];
  let next = 0;

  const worker = async () => {
    while (next < total) {
      next += 1;
      const started = performance.now();
      const response = await fetch(`${A}/r/${link.code}`, { redirect: 'manual' }).catch(() => ({ status: 'network error' }));

      durations.push(performance.now() - started);
      statuses[response.status] = (statuses[response.status] ?? 0) + 1;
    }
  };

  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const seconds = (performance.now() - started) / 1000;
  durations.sort((a, b) => a - b);
  const at = (q) => Math.round(durations[Math.floor(q * (durations.length - 1))]);

  return { total, concurrency, seconds: Math.round(seconds * 10) / 10, perSecond: Math.round(total / seconds), statuses, ms: { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) } };
}

async function clicks(code, count, concurrency = 50) {
  const statuses = {};
  let next = 0;

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < count) {
      next += 1;
      const response = await fetch(`${A}/r/${code}`, { redirect: 'manual' });

      statuses[response.status] = (statuses[response.status] ?? 0) + 1;
    }
  }));

  return { code, count, statuses };
}

const [phase, ...args] = process.argv.slice(2);
const phases = {
  instances,
  overload: () => overload(Number(args[0] ?? 3000), Number(args[1] ?? 400)),
  clicks: () => clicks(args[0], Number(args[1]), Number(args[2] ?? 50)),
};

if (!phases[phase]) {
  console.error('Usage: node scripts/t34-drills.mjs instances | overload [total] [concurrency] | clicks <code> <count> [concurrency]');
  process.exit(2);
}

try {
  console.log(JSON.stringify(await phases[phase](), null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
