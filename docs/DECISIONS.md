# Implementation decision record

Started 24 October 2026 (T01). Source of truth for requirements remains `url-shortener-handoff/`; this file records what implementation chose and why. Update it when a choice changes.

## 1. Repository state at T01

- Workspace contained only `url-shortener-handoff/` (v1.2 planning package). No application code, no repository instructions (no README/CLAUDE.md/AGENTS.md at root), not a git repository.
- Handoff kept in place. Edited only for task status and the owner's D17 decision. It is git-ignored at the owner's request (26 Oct 2026), so its changes are not versioned.

## 2. Confirmed requirements vs proposals

**Confirmed (owner decisions D01–D16, PROJECT_CONTEXT.md)** — not changed by implementation without owner approval:
guest + registered creation, public redirects (D01); creation/redirect/management/disable/expiry/analytics/aliases in v1 (D02); editable destinations (D03); guest 7-day generated links, no edit/alias/analytics (D04); Google + email/password with verification, reset, secure linking (D05); own backend auth + direct Google Identity Services, one session mechanism (D06); free tiers only (D07); analytics dimensions total/daily/country/device/referrer (D08); ~10 s freshness target, not an SLA (D09); registered links don't auto-expire (D10); 30-day raw event retention (D11); edits affect new redirects after success response (D12); guest rate limits + challenge (D13); admin moderation + public reporting (D14); 1M links / 1,000 rps benchmark (D15); polished UI with visible Log in/Sign up (D16); JavaScript backend, SOLID, readable code (D17, 26 Oct 2026).

**Engineering proposals (configurable, may change with evidence)**: Redis Streams queue, opaque Redis sessions, Argon2id, 8-char Base62 codes, alias rules (4–32 chars, case-sensitive), 302 + no-store, ETag/If-Match, idempotency keys, 12-month aggregate retention, every rate-limit number, queue cap 50,000, session lifetimes 24 h idle / 7 d absolute, 12-char password minimum (from preview), load-test latency/error thresholds.

## 3. Runtime and tooling

| Area | Choice | Reason |
|---|---|---|
| Node.js | **22.23.x LTS** (`.nvmrc`), same major in Docker images | Angular 22 requires `^22.22.3 \|\| ^24.15 \|\| >=26`. Installed via nvm locally; system default Node 20 is too old (and EOL). Move to Node 24 LTS before launch; one-line change. |
| Package tooling | **npm workspaces** (npm 10) | Already installed; no extra tool (pnpm not present). |
| Languages | **JavaScript (ES modules)** for API, worker and contracts; **TypeScript 6.0.x** for Angular only | D17 (owner). Angular 22 requires TS `>=6.0 <6.1`. Contracts also use tsc as a dev tool to emit `.d.ts` from JSDoc so Angular keeps typed schemas. |
| Frontend | **Angular 22** standalone components, Angular CLI build | Owner is familiar with Angular; required by stack. |
| API | **Express 5**, plain JavaScript | D17; v5 handles async errors natively. No build step. |
| Contracts / validation | **zod 4** in `packages/contracts`; OpenAPI emitted from the same schemas (zod JSON-schema output) | Single runtime-validated source for API, worker and Angular types (T05 contract-drift requirement). |
| PostgreSQL | **17** (Docker image), driver **`pg` 8** | Parameterized SQL, explicit transactions, per design. |
| Migrations | Plain versioned `.sql` files in `database/migrations/` run by **node-pg-migrate** | Keeps SQL explicit (learning goal) while getting a tested runner/lock table. |
| Redis | **7.4** (Docker), client **`redis` (node-redis) 5** | Official client; separate blocking client for stream reads. Local `redis-cli` 6.0 is only a debugging aid. |
| Passwords | **`argon2`** (Argon2id) | Per design / OWASP. |
| Google sign-in | Google Identity Services in browser + **`google-auth-library`** server verification | D06; no Auth0/Firebase. |
| Tests | **`node:test`** (built into Node) for the server, against real Compose PostgreSQL/Redis; Angular's built-in test runner for UI; Playwright for E2E journeys (T33) | Changed from Vitest in T04: once the backend became plain JS, Node's own runner covers it with no extra dependency. Checks fail, not skip, when dependencies are missing. |
| Dev mail | **Mailpit** container | Local SMTP catcher; not a real provider. |
| Containers | Docker Engine 29 / Compose v5 present | See blocker below. |

## 4. Module boundaries

Owner request (26 Oct 2026): the backend reads as **routes → controller → service → repository**, with the layer visible in every file name.

```text
apps/server/src/api.js                          composition root (wires everything)
apps/server/src/worker.js                       worker process entry
apps/server/src/http/app.js                     global middleware
apps/server/src/http/routes/<x>.routes.js       path + middleware chain + controller method only
apps/server/src/http/controllers/<x>.controller.js   request → one service call → response; no SQL, no business rules
apps/server/src/http/middleware/                reusable request checks (session, CSRF, rate limit, validation, errors)
apps/server/src/modules/<feature>/<x>.service.js     business rules, transaction boundaries
apps/server/src/modules/<feature>/<x>.repository.js  SQL only (PostgreSQL)
apps/server/src/modules/<feature>/<x>.presenter.js   row → API shape
apps/server/src/modules/<feature>/rules/        pure helpers (no I/O)
apps/server/src/infra/                          pg pool, Redis client, logger, mailer
packages/contracts/                             zod schemas + generated .d.ts and openapi.json
database/migrations/                            versioned SQL
apps/server/test/                               integration tests (mirror the source layout)
```

- Controllers and routers are factories that receive their dependencies (`createLinksController({ linkService })`, `createLinksRouter({ controller, guards, limiter, challengeGuard })`), so tests can wire the real stack with different stores or limits.
- Redis-backed services (`sessions.service.js`, `rate-limit.service.js`, `challenge.service.js`) access Redis directly. Repositories are reserved for SQL.
- The refactor (commit after T14) moved files and split layers only; no behaviour changed. Proof: all 235 tests passed before and after, and the Docker stack served ready/redirect/csrf requests.

One server package with two entry points (modular monolith), not separate services.

### Code principles (D17)

- **Single responsibility**: one module per concern (config, lifecycle, app composition, each router). Entry points only wire modules together.
- **Dependency inversion**: modules receive configuration and clients as arguments (`loadConfig()` result, later the pg pool and Redis clients) instead of importing globals or reading `process.env`. This is also what lets tests pass real test databases in.
- **Open/closed**: new features add a router or module and register it in `http/app.js`; existing routers are not edited to make room.
- Abstractions are introduced when a second implementation actually exists (e.g. mail provider adapter: Mailpit vs real provider). No interfaces or factories for a single implementation.
- Error handling (owner request, 26 Oct 2026): no error may go unhandled. Errors are caught at boundaries where they would otherwise escape — process (`unhandledRejection`/`uncaughtException` → log, exit 1, supervisor restarts), HTTP (Express 5 forwards sync throws and async rejections to one error middleware that returns the error envelope without stack traces; catch-all 404), startup/shutdown (`runMain`, server `error` events). Every promise is awaited inside a try/catch or has `.catch`. A function adds its own try/catch only when it can do something useful there: recover, retry, clean up a resource, roll back a transaction, or translate the error into a domain error.
- Async style (owner request, 26 Oct 2026): use `async`/`await`, not `new Promise(...)`. Callback and event APIs are adapted with Node's `util.promisify` and `events.once` (or the library's promise API) instead of hand-written Promise constructors.
- Readability: small functions, descriptive names, blank lines between logical blocks, comments that explain *why* rather than restating code.

### Build/dev mechanics (T02)

- Backend is plain JavaScript run directly by Node (`node --watch` in dev). No transpile step for the server.
- `@shortlist/contracts` exports `src/index.js` at runtime and `dist/*.d.ts` (generated by `tsc` from JSDoc, `checkJs` on) for Angular. Build order: contracts → web (root `npm run build`).
- Tradeoff: the backend loses compile-time type checking. Mitigation: zod validates all input at runtime, ESLint arrives in T06, and integration tests carry more weight.
- Bundle cost: importing full zod into Angular adds ~76 kB gzipped (measured: 51.65 → 128.12 kB initial transfer). Acceptable for now; if it matters, the web app can import types only and validate with `zod/mini`.
- Audit: `@angular/build` 22.2 pulls a Vite version with a high-severity advisory affecting the dev server only. Not force-downgraded; recheck on the next Angular patch.

### Local Docker stack (T03)

- `compose.yaml` sits at the repository root instead of `deploy/`, so a plain `docker compose up` works. The Dockerfile stays in `deploy/`.
- One server image; compose runs it as `api` or `worker`. The image has production dependencies only and runs as the non-root `node` user. In development, compose bind-mounts the source read-only and runs `node --watch`.
- Secrets exist only in the git-ignored `.env`. Compose fails fast (`${VAR:?}`) when they are missing, so it never starts with blank passwords.
- Redis: append-only persistence, `noeviction`, `requirepass`. Host port defaults to 6380 because this machine already runs a host Redis on 6379. Every host port is configurable and bound to 127.0.0.1.
- The worker has no health check until its heartbeat exists (T22).
- Snap-packaged Docker cannot read `/tmp` or hidden home folders; documented in the README.

### Database schema (T04)

- Four migrations by domain area: `0001_accounts`, `0002_links`, `0003_analytics`, `0004_moderation`. They implement database-schema.md, including every documented CHECK, UNIQUE, FK and index.
- Choices beyond the schema doc:
  - `short_code` domain (`varchar(32) COLLATE "C"`, pattern `^[A-Za-z0-9_-]{4,32}$`) shared by `links.code` and `code_reservations.code`, giving exact case-sensitive comparison.
  - `token_hash` is `bytea` with a 32-byte check (SHA-256) instead of `text`.
  - `admin_audit` append-only rule is enforced by triggers (UPDATE/DELETE/TRUNCATE raise `42501`), so it holds for every database role, not only a restricted application role.
  - Consistency checks: a block reason requires a block; resolved/dismissed reports require `resolved_at` and `resolved_by`; the `total` dimension uses bucket `all`.
  - Seeded forbidden aliases (admin, login, logout, signup, account, health, report, static, assets, support, shortlist) are a provisional list.
  - Foreign keys use the default NO ACTION (no cascades), matching "no physical deletion in v1".
- Bug caught by the tests: the first guest CHECK used `expires_at = created_at + 168h`, which lets a NULL `expires_at` through, because a CHECK accepts NULL. Fixed with `IS NOT DISTINCT FROM`.
- `withTransaction(pool, work, { isolationLevel, readOnly })` in `infra/postgres.js` commits on success and rolls back on failure. If ROLLBACK fails, it destroys the connection rather than returning it to the pool. Isolation levels come from an allow-list because they cannot be parameterised.
- Migrations run in a one-shot `migrate` Compose service before the API and worker, matching the "migrations as a separate release step" design. The same image and command serve as the production release step.

### API conventions (T05)

- **Composition root**: `api.js` builds the config, logger, pool and routers; `createApp({ config, logger, routers })` wraps them in the shared conventions. Tests mount their own routers through the same function.
- **Middleware order**: request ID → request log → `no-store` → Origin check (unsafe methods) → `express.json` (16 KiB, strict) → routers → 404 → error handler.
- **Errors**: `AppError(status, code, message, { fields, headers })` is the only error whose details reach clients. Body-parser failures map to `INVALID_JSON` (400), `PAYLOAD_TOO_LARGE` (413) and `UNSUPPORTED_MEDIA_TYPE` (415). Everything else is logged and becomes a generic 500.
- **Contract extension**: `fields: [{ path, message }]` on `VALIDATION_FAILED`, documented in api-contracts.md. Values are never echoed; unknown keys are reported as "Unknown field."
- **Origin check now, CSRF later**: unsafe methods need an `Origin` from `ALLOWED_ORIGINS` (default: the origin of `PUBLIC_BASE_URL`). A missing Origin is rejected because v1 has no non-browser API clients. Synchronizer CSRF tokens are added in T11.
- **Request IDs** are always server-generated (`req_<uuid>`). Incoming `X-Request-Id` is ignored, to prevent log injection and spoofing.
- **Logging**: pino JSON to stdout. Redaction covers password, token, credential, cookie, authorization and CSRF keys (top level and two levels deep). Credentials embedded in URLs are scrubbed from error messages and stacks. The error serializer keeps only type/message/code/stack/cause, dropping library-attached objects. Request logs record method, path (no query string), status, duration and request ID; no IP, headers or bodies.
- **Config**: validated with zod at startup. Invalid or missing values stop the process with a message listing every problem, without echoing values.
- **Readiness** = PostgreSQL only (`SELECT 1`, 2 s connect/query timeouts). Redis is excluded on purpose (api-contracts.md). The compose API health check uses readiness.
- **OpenAPI**: `packages/contracts/scripts/openapi.js` builds OpenAPI 3.1 from the zod schemas (`z.toJSONSchema`); `openapi.json` is committed. `npm run check` fails when it is stale. Only implemented paths are listed; planned shapes are components.
- **Angular dev proxy (for T23)**: in development the browser origin is `http://localhost:4200`, and Angular's dev server must proxy `/api` and `/r` to `:3000`, so cookies and Origin stay same-origin.

### Checks and CI (T06)

- **ESLint 10**, flat config. Backend/contracts: `@eslint/js` recommended + `eslint-plugin-promise` (`catch-or-return`, `avoid-new`), plus `no-console`, `eqeqeq` and `prefer-const`. Angular: `angular-eslint` 22 (generated by its schematic) plus type-aware `@typescript-eslint/no-floating-promises` and `no-misused-promises`.
- Rejected rules: `promise/prefer-await-to-then` contradicts the owner's ".catch on every promise" convention; `require-await` flagged intentional async test handlers.
- `npm run verify` = build → lint → check → test, exactly what CI runs.
- **GitHub Actions** (`.github/workflows/ci.yml`): a static job (build, lint, check, Angular tests) and a server job (integration tests against a `postgres:17-alpine` service with job-local throwaway credentials). Independent steps use `if: !cancelled()` so one run reports every failure. Redis joins CI with T08, when the first Redis-backed code lands.
- Prettier formatting is not enforced yet; it can be added once the UI work starts.

### Link domain (T07)

- `modules/links/` is split by responsibility: `destination.js` (URL rules), `codes.js` (generator), `status.js` (effective status), `repository.js` (SQL), `presenter.js` (API shapes) and `service.js` (orchestration, transactions). The service receives `pool`, `publicBaseUrl`, `logger`, `generateCode` and `clock`, so tests can force collisions and fix "now".
- **Destination rules**: trimmed, then must parse as absolute `http`/`https`, no credentials, no C0/DEL/C1 control characters (the URL parser silently strips tabs and newlines), no `localhost`/`*.localhost`, no non-public IPv4/IPv6 (private, loopback, link-local incl. cloud metadata, CGNAT, multicast, documentation, IPv4-mapped, NAT64), no single-label hosts, not our own host, at most 4,096 characters **after** normalisation. The stored value is the parser's normalised `href`. Nothing is fetched or resolved.
  - Single-label host rejection is an engineering addition beyond the design (such names only resolve on private networks).
  - Bug caught by tests: Node's `BlockList` tests IPv4 addresses against IPv6 rules in mapped form, so one `::ffff:0:0/96` rule blocked all IPv4. Fixed with separate IPv4 and IPv6 lists.
- **Codes**: 8 characters via `crypto.randomInt(62)` (unbiased).
- **Allocator**: `pg_advisory_xact_lock(1001, hashtext(code))` → reservation check → `INSERT … ON CONFLICT (code) DO NOTHING`. Generated codes retry up to 5 times inside the same transaction, then return 503 `SERVICE_UNAVAILABLE` with `Retry-After: 1`. A taken custom alias returns 409 `ALIAS_UNAVAILABLE`; reserved aliases get the identical response, so the reserved list cannot be probed. `reserveCode` takes the same lock and refuses allocated codes.
- **Guest expiry** is computed by PostgreSQL as `now() + make_interval(hours => 168)`. Adding `'7 days'` to a timestamptz follows calendar days in the session time zone and could differ from the 168-hour CHECK.
- **Registered expiry** must be after the server clock (`clock()`); custom aliases are re-validated in the service, not just by the HTTP schema.
- **Immutability** (`0005_link_immutability`): triggers reject changes to `code`, `owner_id`, `is_custom_alias` and `created_at`, and reject DELETE/TRUNCATE on `links`, so allocated codes can never be freed or reused.
- **Effective status** is a pure function: blocked → ownerSuspended → disabled → expired (`expiresAt <= now`) → active.
- Owner verification and active-status checks for creation belong to T17 (authenticated routes). The service trusts `ownerId` from its caller; only tests create synthetic owners.

### Rate limits and challenges (T08)

- **Redis client** (`infra/redis.js`, node-redis 5): `disableOfflineQueue` (commands fail instantly while disconnected, measured 0 ms), 500 ms command timeout, reconnect forever with backoff capped at 2 s. `connect()` stays pending while Redis is down, so the API connects **in the background**: it starts and serves health checks and, later, redirects without Redis.
- **Fixed-window counters** (`modules/abuse/rate-limiter.js`): one MULTI per request with `INCR`, `PEXPIRE … NX` and `PTTL` for every bucket. The window starts at a subject's first request; up to 2× the limit is possible around a boundary (documented trade-off). Over the limit → 429 `RATE_LIMITED` with `Retry-After` set to the longest remaining window. Rejected requests still count.
- **Subjects** are HMAC-SHA256(`RATE_LIMIT_SECRET`) hashes, so raw IPs and emails never reach Redis; rotating the secret resets all counters. IPv4 is keyed per address; IPv6 per /64; IPv4-mapped IPv6 as IPv4; unparseable addresses share one `unknown` key (limited together, not exempt). Client IP comes from `req.ip` with `TRUST_PROXY_HOPS`, so a spoofed `X-Forwarded-For` is ignored unless a trusted proxy is configured.
- **Policies** (`modules/abuse/policies.js`): the defaults from technical-design §6 (guestCreate, guestCreateRisk, registeredCreate, login, accountEmail, memberRead, report). All are provisional. `RATE_LIMIT_POLICIES` (JSON, validated) replaces any policy's buckets.
- **Failure semantics**: if Redis cannot count, the request gets 503 `SERVICE_UNAVAILABLE` with `Retry-After: 5` (fail closed). It is never a 429, and never allowed through unlimited.
- **Challenges**: `requireChallengeWhenSuspicious` runs **after** the quota check. When the risk policy is exceeded (provisionally a third guest creation within 10 minutes per network), the request needs `challengeToken` → otherwise 403 `CHALLENGE_REQUIRED`. The guard enforces, for every provider, an exact action match and single use (`SET NX` of the token hash, 15-minute replay window); the token is removed from the body before handlers run.
- **Development provider only**: HMAC-signed `{action, expiresAt, nonce}` tokens from `POST /api/v1/dev/challenge-token`, mounted only when `CHALLENGE_PROVIDER=dev`. This is mock behaviour, not human verification. `config.js` refuses to start with `NODE_ENV=production` because no real provider exists yet (T36 selects one, T37 integrates and checks hostname binding).

### Redirects (T10)

- `modules/links/redirects.js` decides; `http/routes/redirects.js` maps the decision to HTTP. The resolver depends only on the PostgreSQL pool, never on Redis.
- **One statement per redirect** on the primary: link + owner status + `now()`. Expiry uses the database clock, the same clock that set guest expiry. No cache, no read replica, no long transaction (decision D12).
- **Responses**: 302 + Location (stored destination; incoming query not appended); 404 unknown or malformed code (pattern checked before any query); 410 `LINK_INACTIVE`, one generic answer for expired/disabled/blocked/owner-suspended; 400 `BAD_REQUEST` for malformed percent-encoding (Express raises `URIError`); 405 with `Allow: GET, HEAD`; 503 with `Retry-After: 2` when PostgreSQL fails or the redirect is shed. All are `no-store`.
- **Case-sensitive routing**: Express routes are case-insensitive by default (`/R/x` matched `/r/:code` in a probe), so the redirect router uses `caseSensitive: true`.
- **Bounded concurrency**: the pool size caps concurrent lookups; `connectionTimeoutMillis` (2 s) caps waiting; requests are shed immediately when `pool.waitingCount >= 50`. Redirects share the API pool for now. A separate redirect pool is an option if the load test (T35) shows contention with management traffic.
- **429 for redirects is the edge's job** (technical-design §6). An application limit would put Redis on the redirect path, contradicting the failure design. Recorded for T37 deployment configuration.
- Known 5xx `AppError`s (dependency outages) are now logged at warn level with their cause; previously only unexpected errors were logged.
- HEAD is served by the GET handler without a body. Analytics capture (T19) must only count `GET`.

### Sessions, CSRF and authorization (T11)

- **Store** (`modules/sessions/store.js`): 256-bit random token in the cookie; Redis key `session:<sha256(token)>` holding JSON `{ userId, role, sessionVersion, csrfToken, createdAt, lastSeenAt, recentAuthAt, absoluteExpiresAt }`. TTL = min(idle end, absolute end), so expiry needs no cleanup job. Idle refresh is written at most once a minute, with `SET … XX` so a logged-out session is never resurrected. `rotate()` deletes the old session and issues a new token and CSRF token on every sign-in (prevents session fixation).
- **Lifetimes** (provisional, env-configurable): member 24 h idle / 7 d absolute, admin 1 h / 12 h, anonymous pre-login 2 h.
- **Cookie**: `__Host-session`; `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`; `Max-Age` = absolute lifetime (the server enforces idle). Works on `http://localhost` because browsers treat localhost as secure.
- **CSRF**: synchronizer token stored in the session, sent in `X-CSRF-Token`, compared with `timingSafeEqual`, on every unsafe method, including pre-login actions (anonymous session from `GET /api/v1/auth/csrf`). It applies on top of the global Origin check.
- **Guards** (`http/middleware/session.js`, `createAuthGuards({ store, pool })`): `session` (loads; never rejects by itself), `csrf`, `user` (re-reads `status` and `session_version` from PostgreSQL on every protected request; version mismatch → 401 and session deleted; suspended → 403 `ACCOUNT_SUSPENDED` and session deleted), `verified` (403 `EMAIL_NOT_VERIFIED`), `admin` (role from the users row, so demotion is immediate; 403 `FORBIDDEN`), `recentAuth(windowMs)` (403 `REAUTHENTICATION_REQUIRED`). `isOwnedBy()` supports the "someone else's private resource is a 404" rule.
- **Fail closed**: any Redis failure while loading a session sets state `unavailable`; `csrf`, `user`, session creation and logout then answer 503. A request carrying a session cookie is never downgraded to an anonymous guest.
- **Logout** returns 204 only after the Redis delete succeeds; otherwise 503. Best-effort deletion is used only for sessions the users row has already invalidated.
- **Scope**: the guards are attached per route, never globally, so redirects and health checks stay independent of Redis (verified with Redis stopped: csrf 503, redirect 302, ready 200).
- **Refactor**: one `serviceUnavailableError()` in `errors.js` replaces three local copies (rate limits, redirects, sessions).
- **Known gap**: anonymous sessions are not rate-limited. Their memory is bounded by the 2-hour TTL; a per-network policy can be added if abuse appears.

### Guest link creation (T09)

- `POST /api/v1/links` chain: `session` → `csrf` → signed-in check → `rateLimit(guestCreate, network)` → `validateBody(GuestCreateLinkRequestSchema)` → `requireChallengeWhenSuspicious(guestCreateRisk, 'guest-create')` → `linkService.createGuestLink`.
  - The quota is counted before validation, so malformed attempts are limited too. The risk counter is only consumed by valid requests.
  - An unknown or expired session cookie fails CSRF (403); it is never downgraded to a guest.
  - Signed-in callers get 501 `NOT_IMPLEMENTED` until registered creation lands in T17, rather than silently receiving an unmanageable guest link.
- The response is exactly `{ code, shortUrl, expiresAt }` with 201: no id, `Location` or `ETag`.
- **Automatic ETags disabled** (`app.set('etag', false)`). Express added weak content-hash ETags to every JSON response, which contradicts "no ETag for guests" and would collide with the `"vN"` version ETags of T17. Caught by the T09 tests.
- **PostgreSQL outages → 503 everywhere**: `isDatabaseUnavailable()` (network error codes, SQLSTATE 08xxx/57P01-3/53300, pg connect/query timeouts, AggregateError) is applied in the shared error handler, so any route hitting a dead database answers 503 with `Retry-After` instead of 500.
- In local Docker, every host request reaches the API from the Docker gateway address, so all manual testing shares one guest quota. Behind a real proxy, `TRUST_PROXY_HOPS` must be set so that client addresses are used.

### One-time tokens and email outbox (T12)

- **Tokens** (`modules/accounts/tokens.js`): 32 random bytes (base64url) given to the user; only `sha256` stored (`bytea`, 32 bytes). Issuing revokes the user's older unused tokens of the same purpose (only the newest email link works). `consumeToken` locks the row `FOR UPDATE`, distinguishes `invalid`/`expired`/`used`, and marks it used inside the caller's transaction, so a rollback restores the token. Lifetimes: verification 24 h, reset 30 min (provisional, env-configurable).
- **Atomic issue + email**: `issueTokenWithEmail()` writes the token and its outbox row in the caller's transaction; the message expires with its token.
- **Payload encryption** (`modules/email/payload-crypto.js`): AES-256-GCM with `EMAIL_OUTBOX_KEY` (32 bytes, base64), the row id as authenticated data (a payload copied to another row fails), and a version byte for future key rotation. The payload `{ to, token, expiresAt }` is erased (empty bytea) after delivery, after giving up, or after expiry.
- **Delivery** (`modules/email/sender.js`, worker): purge undeliverable → claim up to 20 due messages with `FOR UPDATE SKIP LOCKED` and a 60 s lease (short transaction) → decrypt and send each outside any transaction → `markSent` or `markFailed`. Backoff 30 s × 2^(attempt-1), capped at 1 h; give up after 8 attempts or on a permanent (5xx) SMTP rejection. A lease that expires after a crash makes the message claimable again, so delivery is **at least once**: a duplicate email (same token) is possible; losing a committed one is not. The outbox message id is passed as an idempotency key for providers that support one.
- Decryption is per message: a payload that cannot be read is given up (`PAYLOAD_UNREADABLE`) without blocking the rest of the batch.
- **Email text** states the token's real expiry time in UTC rather than a hard-coded duration, so it stays correct if lifetimes change. Links use `#token=` fragments (`/verify-email`, `/reset-password`) for the UI to POST (T25).
- **Mailer** (`infra/mailer.js`): nodemailer 10 over SMTP with 10 s timeouts. Errors become `MailDeliveryError` with a short code (`SMTP_550`, `ESOCKET`, …) and a permanent/transient flag; provider messages (which can include addresses) are never stored or logged.
- **Logs** record message id, kind, attempt and error code only; tests assert that the token and address never appear.
- **Worker** now runs the sender loop (1 s polling, immediate re-poll after a full batch) and on SIGTERM finishes the current batch before closing the mailer and pool.
- Development mail goes to Mailpit only. A real provider and sender domain are launch dependencies (T36/T37); nothing here claims real delivery.

### Registration, verification and password sign-in (T13)

- **Argon2id** via `argon2` 0.45 with OWASP's minimum: m=19456 KiB, t=2, p=1 (encoded as `m=19456,p=1,t=2`). Measured about 32 ms per hash on the development laptop. Runs on libuv's thread pool (default 4 concurrent per process); rate limits bound the queue. `needsRehash` upgrades outdated hashes after a successful sign-in.
- **Password policy**: 12-256 characters, no composition rules. Login accepts any 1-256 character password, so older passwords still work and the policy is not revealed. Shared constants live in `@shortlist/contracts` for the sign-up form.
- **Email normalisation**: trim, lower-case, IDN domain to ASCII via `url.domainToASCII`; dots and `+tags` are kept; the typed address is stored and shown.
- **No account discovery**:
  - Register and resend always return `202 {"status":"accepted"}`.
  - Register hashes the password before touching the database in every case, and an existing address is left untouched: no credential overwrite, no new email.
  - Sign-in returns one `401 INVALID_CREDENTIALS` for unknown email, wrong password and password-less (Google-only) accounts, and verifies a dummy Argon2id hash when no hash exists, so timing matches (tested: an unknown email takes comparable time to a wrong password).
  - A correct password on a suspended account gets `403 ACCOUNT_SUSPENDED`, since the caller already proved control of it.
- **Atomic sign-up**: user, password credential, verification token and outbox email are one transaction; concurrent sign-ups for one address create exactly one account and one email (`ON CONFLICT DO NOTHING`).
- **Verification**: `400 TOKEN_INVALID / TOKEN_EXPIRED / TOKEN_USED`; verifying never signs anyone in. A link revoked by a resend reports `TOKEN_USED`.
- **Restricted sessions**: unverified users can sign in; `POST /api/v1/links` for any signed-in user now runs `user` + `verified` guards, so unverified accounts get `403 EMAIL_NOT_VERIFIED` (verified ones get 501 until T17).
- **Session rotation** on sign-in: the anonymous session is deleted and a new cookie and CSRF token are issued; the old CSRF token stops working (verified with curl).
- **Rate limits**: register and resend use `accountEmail` (account + network + global); sign-in uses `login` (network + account). Tested: the 6th wrong attempt on one account from different networks gets 429.
- **Test helpers**: `test/support/api.js` wires every router like `api.js`; `test/support/browser.js` keeps cookies and CSRF tokens like a browser.

### Password recovery (T14)

- `POST /auth/password/forgot`: always `202 {"status":"accepted"}`; rate-limited with `accountEmail`. Mail goes only to an existing, **active** account **with a password**. Google-only accounts get nothing (password enrolment is outside v1), and neither do suspended accounts. A new link revokes earlier reset links.
- `POST /auth/password/reset { token, newPassword }`: the new password is hashed first; then one transaction consumes the token, updates the hash and `password_changed_at`, and increments `session_version`. Every existing session fails its next request with 401 (the PostgreSQL check from T11). It answers 204 and does not sign in. Distinct `TOKEN_INVALID / TOKEN_EXPIRED / TOKEN_USED`; a verification token is `TOKEN_INVALID` for reset (purpose-bound). Invalid input fails validation before the token is touched, so a rejected password does not burn the link.
- **Engineering decision**: a successful reset also sets `email_verified_at` (if unset), because following the emailed link proves control of the mailbox exactly as the verification link does. This lets a user who never verified recover through reset alone.
- If the account has no password credential at reset time, the transaction rolls back with `TOKEN_INVALID`. This is defensive, as such accounts are never sent reset links.

## 5. Provider-dependent work (external accounts needed — not configured)

| Dependency | Needed for | Local substitute | Status |
|---|---|---|---|
| Google Cloud OAuth client ID (free) | T15, T16, T25, T28 real sign-in | none — mocked verification does not count as done | Owner must create; blocks T15 completion |
| Transactional email provider + sender domain | T37 / public signup | Mailpit (dev only) | Open (T36) |
| Human-verification challenge provider | T08 real provider, T37 | dev-only adapter, disabled outside dev/test | Open (T36) |
| GeoIP / trusted edge country header | country analytics | `unknown` fallback | Open (T36) |
| Free hosting for web, API, worker, PostgreSQL, Redis | T36–T38 | Docker Compose | Open; nothing deployed or purchased |

## 6. Configurable defaults (env-driven, documented, provisional)

Rate limits (technical-design §6), queue cap and event size, publish deadline (20 ms), worker batch size/flush (500 / 2 s), session idle/absolute lifetimes, admin session lifetimes, recent-auth window, token lifetimes (reset 30 min, verify 24 h), idempotency retention (24 h), aggregate retention (12 months), referrer cap (100/link/day), password minimum length, DB pool size per process, public base URL for `shortUrl`.

## 7. Contradictions / clarifications noted

- T09 (guest creation) depends on T11 (CSRF/sessions) even though it sits in Milestone B — guest creation needs the pre-login CSRF binding. Order follows dependencies, not milestone letters.
- Preview uses `short.example`; implementation derives `shortUrl` from a configured `PUBLIC_BASE_URL` + `/r/{code}`.
- Preview's 12-character signup minimum is treated as a provisional default shared by backend and UI.

## 8. Local environment blockers

- ~~Docker daemon not accessible~~ **Resolved 24 Oct 2026**: Docker is the snap package, which ships without a `docker` group. Fixed with `addgroup --system docker`, `usermod -aG docker $USER`, snap disable/enable; socket is now `root:docker` and `hello-world` runs. Shells opened before the change need `newgrp docker` or a re-login.
- Workspace is not a git repository; recommended before T02 so increments are reviewable.
