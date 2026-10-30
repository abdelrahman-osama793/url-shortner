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

### Google sign-in (T15, in progress)

- `google-identity.service.js`: google-auth-library 11 `verifySignedJwtWithCertsAsync` with Google's published keys (fetched and cached by the library), issuers `accounts.google.com` / `https://accounts.google.com`, audience = configured `GOOGLE_CLIENT_ID` only; then `payload.nonce` must equal the attempt's nonce. Key-fetch failure → 503; any token problem → one generic 401 `GOOGLE_SIGN_IN_FAILED`. The library's error messages contain token fragments, so only a short reason is logged.
- `google-attempts.service.js`: Redis `login-attempt:<id>`, 5-minute TTL, `{ purpose, nonce, binding: sha256(session token), userId }`, consumed with `GETDEL` (atomic single use); a different purpose or browser session → null.
- `google-sign-in.service.js`: per-subject advisory lock (namespace 1002); find by `(google, sub)` only. A Google email that matches an existing account → 409 `ACCOUNT_LINK_REQUIRED`, returned only after a valid proof, with no identity or session created. A new identity → password-less user; `email_verified_at` is set only when Google is authoritative (`gmail.com`, `googlemail.com`, or an `hd` Workspace claim); otherwise the account is restricted and our verification email is queued. The contact email is not replaced when the Google email later changes.
- Routes are mounted only when `GOOGLE_CLIENT_ID` is set (an empty value from Compose means unset). `googleAttempt` policy: 20 attempts per 15 minutes per network.
- Tests sign tokens with a local RSA key and run the real verification code; a probe confirmed the library rejects each bad case for the intended reason. `scripts/google-signin-check.mjs` is a development-only page on :4200 (proxying /api to :3000) for the required real-account check, which is still pending.

### Registered link management (T17)

- `POST /api/v1/links` has two routes on one path: the guest route ends with `anonymousOnly`, which passes signed-in callers on with `next('route')` to the registered route (`user` → `verified` → `registeredCreate` limit → `RegisteredCreateLinkRequestSchema`). `router.use('/api/v1/links', session, csrf)` runs once for every links request. The temporary 501 branch and its middleware were removed.
- Owned creation returns 201 with the full `Link`, `Location: /api/v1/links/{id}` and `ETag: "v1"`. Version ETags are strong (`"vN"`); `If-Match` must match `^"v[1-9][0-9]*"$` exactly, otherwise 428 `PRECONDITION_REQUIRED` (weak `W/"v1"` and `*` are refused).
- **Updates**: one `UPDATE … WHERE id = $1 AND owner_id = $2 AND version = $3 RETURNING version` inside a transaction. No row → re-read: missing or not owned → 404, otherwise 412 `PRECONDITION_FAILED`. The response is built from a read inside the same transaction and sent after commit. `enabled: true` only clears `owner_disabled_at`; effective status is recomputed, so blocks, expiry and suspension still apply. `expiresAt: null` removes the expiry; non-null must be in the future (server clock). Destinations are re-validated. Code, alias and owner are not accepted fields and are also protected by the 0005 trigger.
- **Listing**: keyset pagination on `(created_at DESC, id DESC)` using the existing owner index, `limit + 1` rows to detect a next page. The cursor is HMAC-signed `{ owner, created_at as PostgreSQL text, id }`. Text keeps microseconds; a JavaScript Date would lose them and skip or repeat same-millisecond rows (tested with three links at an identical timestamp). A tampered cursor or another account's cursor → 400 on `cursor`. The cursor key is derived from `RATE_LIMIT_SECRET` (`HMAC(secret, 'links-cursor-v1')`). That variable now protects more than rate limits; renaming it to a general application secret is a candidate cleanup.
- Reads of someone else's link, guest links, unknown ids and malformed ids all return the same 404.
- New policies: `linkUpdate` (60/min per user); reads use `memberRead`; creation uses `registeredCreate` (user + network).
- `validateQuery()` stores the parsed query in `req.validatedQuery` because `req.query` is read-only in Express 5.

### Retry-safe creation (T18)

- Generic module `modules/idempotency/`: `runOnce(client, { userId, key, requestHash, execute })` takes `pg_advisory_xact_lock(1003, hashtext(user:key))`, then replays an unexpired record (same hash) or answers 409 `IDEMPOTENCY_KEY_REUSED` (different hash). Otherwise it deletes an expired record, runs `execute(client)` and inserts the record **in the same transaction** as the link. Concurrent retries queue on the lock and replay the winner's response.
- The request hash is SHA-256 of canonical JSON of the **validated** request (`destinationUrl`, alias or null, expiry as ISO or null). Property order and explicit nulls do not change it.
- The stored snapshot (status 201, body, ETag) is replayed even after later edits, with `Idempotent-Replayed: true`; a GET shows current state. Only successes are stored, so a failed attempt is re-executed on retry. Retention is 24 h (`expires_at`); expired rows are replaced on reuse and will be purged by maintenance (T22).
- Key format: 1-255 visible ASCII characters, otherwise 400 on field `Idempotency-Key`. The primary key `(user_id, key)` keeps accounts apart. Guests' keys are ignored (v1 contract: guest retries may create distinct links).
- Retries still consume the `registeredCreate` quota, since the rate limit runs before the replay lookup. This is acceptable for normal retry counts and avoids a database read for every throttled request.
- `links.service.js` split creation into `checkOwnedRequest` (validation, before the transaction) and `insertOwnedLink(client)` (allocation inside the caller's transaction); `createOwnedLinkOnce` wraps it.

### Click capture (T19)

- `modules/analytics/click-capture.service.js`. The redirect controller sends the 302 **first**, then calls `captureInBackground()` for `GET` only (HEAD, 404, 410, 503 and browser prefetches are never counted). Capture never throws and is never awaited by the request.
- **Event** in Redis Stream `clicks:v1`: `v`, `e` (random UUID event id), `l` (link id), `lv` (link version), `t` (epoch ms), `c` (country), `d` (device), `r` (referring host), `b` (bot flag). No IP, User-Agent, full referrer, path or query string. Under 300 bytes, well below the 2 KiB budget.
- **Dimensions** (`rules/`): a regex device classifier (bot → tablet → mobile → desktop → unknown; approximate by design, no library); referrer = lower-cased hostname of an http(s) Referer, else `direct_or_unknown`; country = ISO alpha-2 from the header named by `TRUSTED_COUNTRY_HEADER` (only behind a proxy that overwrites it), with provider placeholders (XX, T1, A1, …) mapped to `unknown`. No header configured → `unknown`.
- **Bounded admission**: a Lua script does `XLEN` then `XADD` atomically and refuses when `XLEN >= ANALYTICS_QUEUE_CAP` (default 50,000). Queued events are never trimmed or evicted. Tested with 50 concurrent publishes against a cap of 10: exactly 10 admitted.
- **Never blocks**: per-command timeout `ANALYTICS_PUBLISH_TIMEOUT_MS` (default 20 ms, via `withCommandOptions`); at most 1,000 publishes in flight (more are dropped as `overloaded`); a circuit breaker opens for 5 s after 5 consecutive failures (`circuit_open`, no Redis call). The client's disabled offline queue makes an unreachable Redis fail instantly. Measured locally: redirects stayed at about 2-3 ms with Redis stopped.
- **Loss accounting**: in-process counters `captured`, `skipped.prefetch`, `dropped.{queue_full, timeout, redis_error, overloaded, circuit_open}` and `lastLossAt`, logged every 60 s when they change, with no user, link or code labels. A timeout is not retried (the event may have been stored with its acknowledgement lost). T22 turns these into the pipeline's "degraded" signal and a private metrics endpoint.
- Library detail: node-redis `TimeoutError` does not set `.name`, so timeouts are detected with `instanceof TimeoutError` (imported from `redis`).

### Analytics worker (T20)

- `click-consumer.service.js` (Redis side) → `click-aggregation.service.js` (one transaction) → `click-events.repository.js` (SQL); `rules/click-event.js` validates every stream entry.
- **Consumer group** `analytics-v1` on `clicks:v1` (created with `MKSTREAM`; `BUSYGROUP` ignored). Each pass first `XAUTOCLAIM`s entries idle ≥ 30 s (from a crashed or restarted consumer, including this one), otherwise `XREADGROUP … >` with `COUNT 500 BLOCK 2000` on a **separate blocking connection** (its command timeout is 5 s so the 2 s block cannot time out). Consumer name `hostname-pid`.
- **Transaction**: `INSERT … SELECT FROM unnest(…) ON CONFLICT (event_id) DO NOTHING RETURNING …`, so only the rows actually inserted are counted. They are tallied in memory per `(link, UTC day, dimension, bucket)` and per link (unique keys, sorted), then upserted with `clicks = clicks + EXCLUDED.clicks`. Referrer admission takes `pg_advisory_xact_lock(1004, link:day)` in sorted order, reads existing host buckets and admits up to 100 per link/day; `direct_or_unknown` and `other` do not count towards the cap.
- **Acknowledge after commit**: `XACK` then `XDEL` only after the transaction commits. A crash in between leaves the entries pending; they are reclaimed and their event ids are already stored, so nothing is double-counted (tested with a crash hook between commit and acknowledgement).
- **Failure isolation**: a database **outage** (`isDatabaseUnavailable`) aborts the pass with nothing acknowledged, and the run loop retries with backoff (1 s doubling to 30 s). A **data** error retries the batch one event per transaction; events still rejected (e.g. an unknown link id) go to the dead-letter stream. Malformed entries are dead-lettered before the database is touched. This replaces the design's "after five attempts" counting: delivery counts are not needed because poison events are isolated on the first failure.
- **Dead letters**: `clicks:dead:v1` with `{ reason, sourceId, fields (≤ 2 KiB) }`, trimmed by `MINID ~` to the last 7 days.
- **Retention guard**: events older than 30 days are acknowledged and counted as `expired`, never stored, so raw-event deduplication is never relied on after cleanup could have removed the original.
- Known gap (T22): an entry acknowledged but not yet deleted (crash between `XACK` and `XDEL`) stays in the stream unprocessed and unpending; a janitor will trim it.
- **Local testing lesson**: `docker compose start <service>` also starts a stopped dependency (the worker depends on PostgreSQL), which silently ended a simulated outage. Use `docker compose up -d --no-deps <service>` for outage checks. Also, dev containers run `node --watch` on the mounted source, so editing `worker.js` restarts the running worker immediately.

### Owner analytics API (T21)

- `GET /api/v1/links/:id/analytics?from=&to=` in `links.routes.js` (`user` guard, `memberRead` limit, `AnalyticsQuerySchema`) → `links.controller.getLinkAnalytics` → `analytics-query.service.js` → `analytics.repository.js`.
- **Range**: UTC dates, `from` inclusive, `to` exclusive. The default is `[today − 29, today + 1)`, i.e. 30 dates including today. Invalid when `from >= to`, the span exceeds 90 days, or `from` is earlier than `today − (AGGREGATE_RETENTION_DAYS − 1)` (provisional 365). "Today" comes from the server clock (injectable for tests).
- **Snapshot**: ownership check, lifetime total, daily totals and breakdowns are read in one `REPEATABLE READ READ ONLY` transaction, so totals and breakdowns cannot come from different moments. This is the one place this isolation level is used; redirects stay at READ COMMITTED.
- **Shape**: `rangeClicks` is the sum of the zero-filled `daily` list (dimension `total`). Breakdowns are SQL `sum()` per bucket, sorted by clicks then name; each adds up to `rangeClicks` because the worker increments every dimension once per event. Referrers: top 20 named hosts, then one `other` entry summing the rest **plus** the worker's stored `other` bucket; `direct_or_unknown` is a regular entry. All counters stay strings end to end (PostgreSQL `::text`, `BigInt` sums); tested with 9,007,199,254,740,993.
- `lastUpdatedAt` = `link_totals.updated_at` (null for a link never clicked). `pipeline` is `{ status: 'unknown', heartbeatAt: null, oldestPendingAt: null }` until T22 supplies real worker health through the injected `getPipelineStatus`. `approximate` is always `true`.
- Not the owner, a guest link, an unknown id or a malformed id → 404.

### Retention and pipeline health (T22)

- **Retention** (`modules/maintenance/retention.service.js`, worker, at start then hourly): raw `click_events` older than 30 days (D11), `daily_metrics` with `day < today − AGGREGATE_RETENTION_DAYS` (provisional 365), and expired `api_idempotency` rows. `link_totals` are never deleted. Each statement deletes at most 5,000 rows via a `ctid = ANY(ARRAY(SELECT … LIMIT n))` subquery using the existing time indexes, with at most 100 batches per table per run; leftovers continue next run (tested with batch 2 × 2).
- **Stream janitor** (`clickConsumer.trimProcessed`): `XTRIM MINID` to the smaller of the oldest pending id and the group's `last-delivered-id`. Everything below that boundary is acknowledged, so pending and unread entries are never trimmed (tested with 2 acknowledged leftovers, 2 pending and 1 unread entry).
- **Heartbeat** (`createPipelineReporter`, every 5 s): upserts `worker_state('analytics-consumer')` with `heartbeat_at`, `last_batch_committed_at`, `oldest_pending_at` (timestamp of the first entry still in the stream) and `status` (`degraded` if the last consumer pass failed or Redis could not be read). If PostgreSQL is down the heartbeat simply goes stale.
- **Status** (`createPipelineStatusReader`, used by the analytics API), first match wins: `unknown` (no heartbeat, or older than 30 s) → `degraded` (capture loss within 5 min, from this instance's counters or the shared Redis key `analytics:capture-loss-at`, or worker status `degraded`) → `delayed` (oldest waiting event > 10 s) → `healthy`. Capture writes the shared key only for losses where Redis still answers (`queue_full`, `timeout`, `overloaded`), best effort, through an async helper so it can never break capture.
- **Measured freshness** (`scripts/measure-analytics-freshness.mjs`, Docker on the development laptop, 29 Oct 2026, polling the real analytics API every 600 ms with 0 rejected polls): 40 clicks at 250 ms → p50 0.33 s, p95 0.59 s, max 0.62 s; 200 clicks at 10 ms → p50 0.32 s, p95 0.59 s, max 0.62 s. All 240 within 10 s; status healthy. The figures are bounded by the 600 ms poll interval. Light load only: not evidence for the 1,000 rps target (T35). A UI polling every 5 s would add up to 5 s.
- **Measurement pitfall recorded**: a first burst run polled every 100 ms, exceeded the 120/min `memberRead` limit, got 429s and reported a false p95 of 7.34 s. The script now counts rejected polls and defaults to 600 ms.

### UI foundation (T23)

- **Reference**: `ui/product-preview.fragment.html` was read in full; its tokens, spacing, breakpoints (800 px, 600 px), components and copy are reproduced. Exploration controls (the demo banner, demo workspace entry, "Admin demo", simulated flows) are not carried over.
- **Tokens** live in `apps/web/src/styles.css` as `light-dark()` pairs; the appearance is chosen with `color-scheme` on `<html>` (system by default; `data-theme="light|dark"` when picked). One stylesheet serves both themes. Brand panels (petrol `#183b3e`, citron `#e8efab`) are fixed in both. A missing `--error-soft` pair was added for blocked/owner-suspended badges.
- **Contrast measured** (WCAG ratio, computed from the tokens): every text/background pair in both themes is ≥ 4.5:1. The lowest is muted on soft in light mode at 4.57; brand pairs range 4.98-12.11.
- **Fonts and icons are self-hosted**: `@fontsource-variable/manrope` instead of Google Fonts at runtime (no third-party request or visitor IP sent to Google), and `lucide` icon data rendered by a small `Icon` component with `Renderer2` (no `innerHTML`, no sanitizer bypass). `lucide-angular` was rejected because its peer range stops at Angular 21. Only the 29 icons in use are imported.
- **Layouts**: `PublicLayout` (logo, "Shorten a link" (hidden on phones), Log in, Sign up; footer with Report abuse and the theme switcher) → `AuthLayout` nested inside it (story panel + form; story hidden ≤ 600 px; fills the page height) → `WorkspaceLayout` (sidebar → wrapping link row ≤ 600 px; `isAdmin` input hides Administration; roles are enforced by the server). Each layout has a skip link and a `<main id="main">`.
- **Accessibility**: global `:focus-visible` ring (citron on dark panels), 44 px minimum targets (measured at 320 px: smallest 44), 16 px inputs on phones and touch screens, reduced-motion respected, the theme switcher is a native radio group with a legend, status is always shown as text, `aria-current` on active navigation.
- **Previews are labelled**: routes for screens built later render `ComingSoon` (title from route data plus "Preview: built in T2x"); the workspace list uses `SAMPLE_LINKS` under a "Sample data" banner. No control pretends to work.
- **Dev proxy** (`apps/web/proxy.conf.json`, used by `ng serve`): `/api`, `/health` and `^/r/` → `localhost:3000`. The `/r/` rule is a regular expression so Angular routes such as `/report` are not forwarded (verified).
- **Angular naming** follows the current Angular style guide used by the CLI (`public-layout.ts`, class `PublicLayout`), unlike the backend's suffix convention.
- **Theme preference** is a per-browser convenience in `localStorage`, read and written inside try/catch (tested with storage throwing).

### Guest journey (T24)

- **Real integration, no mock result**: the home form posts to `POST /api/v1/links` through `HttpClient` (`withFetch`) and shows the API's `shortUrl` and `expiresAt`. The old preview's simulated result is gone.
- **CSRF in one place**: `csrfInterceptor` adds `X-CSRF-Token` to unsafe `/api/` requests. The token is fetched once (concurrent callers share the request), and a `403 CSRF_INVALID` refreshes it and retries once.
- **Errors map to their own messages** via `ApiError`: invalid URL → field error with `aria-invalid`; `RATE_LIMITED` → wait time from `Retry-After` ("about 30 minutes"); `CHALLENGE_REQUIRED` → verification step; `SERVICE_UNAVAILABLE` and network failures → "briefly unavailable". The server checks limits and the challenge before validating the URL, so an invalid URL can be answered with a challenge first.
- **Challenge**: development builds (`isDevMode()`) show "Complete verification", which calls the dev-only token endpoint and retries with the token, labelled "Development mock". Production builds show no shortcut and say verification isn't available yet (real provider: T37).
- **Copy**: `navigator.clipboard`; if that fails, the read-only link is selected and instructions for copying by hand are shown.
- **Focus management**: focus moves to the new link, back to the field on "Shorten another link", to the first challenge action when one is required, and back to the field when the challenge is cancelled or ends in another error. It runs in `afterNextRender`. A microtask ran before rendering and focus fell to `<body>`, which the unit test and a visible Chromium both showed.
- **Zod-free constants entry**: `@shortlist/contracts/constants` exports plain values (limits, patterns, error codes), so the web bundle does not pull in zod. A value import from the main entry grew the initial bundle from 73 to 159 kB gzipped; with the constants entry it is 82 kB.
- **Dev-server pitfall**: after adding a package `exports` entry, a running `ng serve` keeps failing with TS7016 until it is restarted.

### Authentication screens (T25)

- **Screens**: `/login`, `/signup`, `/signup/check-email`, `/verify-email`, `/forgot-password`, `/reset-password`, all inside `AuthLayout`. No demo verification, reset or Google shortcuts exist.
- **Session state** (`core/auth/session.ts`): mirrors `GET /auth/me` (undefined = not checked, null = signed out). Sign-in stores the new CSRF token returned with the rotated session; sign-out forgets it. The cookie stays HttpOnly; the UI never sees it.
- **Workspace guard** `requireUser` sends signed-out visitors to `/login?next=…`. After sign-in only `/app…` paths are followed (`safeNext`), so `next` cannot redirect off-site. If the session check fails (API down), the guard fails closed to Log in.
- **Restricted state**: an unverified account signs in (api-contracts), and the workspace shows "Verify your email to create links" with a Resend button. Admin navigation comes from the session role (display only; the server enforces roles).
- **One-time tokens**: `#token=` is read and removed from the address bar on arrival (`Location.replaceState`). Verification is used only when the person presses Confirm, so link scanners cannot use it up. Expired, used and invalid tokens each have their own screen and a way to get a new link.
- **No account discovery**: sign-up, resend and forgot-password confirmations read the same for every address; wrong email and wrong password share one message.
- **Email in navigation state, not the URL**: sign-up passes the address to the check-email screen through `history.state`.
- **Google** (`core/auth/google.ts`, `GoogleButton`): Google's own rendered button (a custom-styled button cannot obtain an ID token). The page prepares the server attempt before the click because the nonce must be set when Google is initialised. An attempt is reused for 4 minutes across Log in / Sign up (attempts are rate-limited, 20 per 15 min per network) and renewed before its 5-minute expiry. Button language follows `<html lang>`. Hidden when the server has no Google client (404). A `409 ACCOUNT_LINK_REQUIRED` tells the person to log in with their password; linking is T16.
- **Contract change**: `POST /auth/google/start` now also returns `clientId` (public), so one web build works with whichever Google client the API is configured for, instead of baking it into the bundle.
- **Test note**: Angular's TestBed uses a mock platform location by default; the auth specs provide `BrowserPlatformLocation` so they check the real address bar.

### Link management (T26)

- **Real data only**: `/app/links` lists `GET /api/v1/links` (newest first, "Show more links" with the signed cursor, duplicates skipped if pages shift). The sample-data page from T23 is deleted.
- **Create** sends an `Idempotency-Key` (a fresh UUID per distinct request body; a retry of the same body reuses it, so a lost answer never creates two links). Alias and date are optional; an unverified account cannot open the editor (the server enforces it too).
- **Edit** sends only changed fields with `If-Match: "v<version>"` taken from the list. On `412` the editor loads the newer version, shows it next to the person's unsaved input, and saves over it only if they press Save again: never a silent overwrite.
- **Disable / Enable** appear only for `active` and `disabled` links. Blocked (moderation), owner-suspended and expired links get an explanation instead; editing a blocked link says the block stays (verified: still 410 after editing).
- **Expiry as a date**: the link works until the end of the chosen day in the person's time zone (`expiry.ts`); stored as an exact UTC instant.
- **Long URLs**: destinations wrap to two lines (`overflow-wrap: anywhere`) and open in a new tab with `rel="noopener noreferrer"`; the full value is in the editor.
- **Session expiry**: a member request that fails because the session ended (401 on reads, 403 `CSRF_INVALID` on writes) goes to `/login?next=…&expired=1`, which explains what happened.
- **Bug found and fixed (from T24/T25)**: the CSRF interceptor retried a rejected write after fetching a new token, and fetching a token without a live session starts a new anonymous one. A signed-in `POST /links` was therefore replayed as a guest request (found in the browser: it got 400 only because it had an alias; without one it would have created a 7-day guest link). The interceptor now retries a signed-in request only after `/auth/me` confirms the same user; otherwise the expiry flow runs. Verified: no guest link created.
- **Phone workspace fix**: the single-column grid stretched the navigation row to half the screen; rows are now `auto 1fr`. Header and Create buttons no longer wrap.

### Analytics views (T27)

- **Route** `/app/analytics?link=<id>&range=7|30|90`; each link row has an "Analytics" action. The selector lists up to 100 links (a `?link=` beyond them is fetched and added). Other `range` values fall back to 30.
- **Explicit UTC ranges**: the page sends `from`/`to` itself (last N UTC dates including today, `to` exclusive), so labels and requests always agree; 90 days is exactly the API maximum. All dates are labelled UTC.
- **Numbers**: counters stay decimal strings and are formatted as `BigInt` (exact above 2^53). "Clicks in this period" (`rangeClicks`) and "since the link was created" (`totalClicks`) are separate. Copy never says visitors; a note states counts include repeat visits and bots, are not unique visitors and do not confirm the destination loaded.
- **Chart without a library**: CSS bars with a 1/2/5 scale, first/middle/last date labels, `role="img"` with a summary (busiest day), and a "Daily numbers" table listing every day for screen readers and exact values. Breakdowns show count and share with a meter; `unknown`, `direct_or_unknown` and `other` get plain labels; countries via `Intl.DisplayNames`.
- **Distinct states**: loading; no links; analytics unavailable (5xx/network, with Try again); no clicks yet (lifetime zero); no clicks in this period; and the pipeline banner: healthy (Live, last counted …), delayed, degraded, unknown. A failed refresh keeps the last numbers and says so.
- **Bounded polling**: every 15 s while the tab is visible (resumes on return), at most 40 polls (10 minutes), then "Automatic updates paused" with Refresh. Late answers for a previous link/range are ignored. Well inside the 120/min read limit.
- **Verified honesty of `unknown`**: with the worker stopped the API reports `unknown` (no heartbeat for 30 s outranks delayed), and the page says it cannot confirm counting is running while keeping the last total.

### Account linking and recent authentication (T16)

- **Endpoints**: `POST /auth/reauthenticate { password }`, `POST /auth/google/reauthenticate` and `POST /auth/google/link` (both `{ attemptId, credential }`), each answering 204. Every one needs a signed-in, active, current session plus CSRF.
- **Recent authentication**: a session counts as recently authenticated for `RECENT_AUTH_MINUTES` (default 10, provisional) after sign-in, `/auth/reauthenticate`, Google re-authentication or a successful link. Stored as `recentAuthAt` in the Redis session; the `recentAuth` guard checks it. Password confirmation shares the sign-in rate limits (per account and network).
- **Both identities proven**: linking requires the recent-auth guard (proves the Shortlist account) and a fresh Google ID token for a link-purpose attempt (proves the Google account). Matching emails never link anything; the T15 `409 ACCOUNT_LINK_REQUIRED` is resolved only by this explicit flow (tested end to end).
- **No swapping or replay**: attempts carry purpose, browser-session binding and the starting user; link/reauthenticate verify all three, and attempts are single-use (GETDEL).
- **The Google subject never silently changes**: an account has at most one Google identity, enforced by migration `0006` (`UNIQUE (user_id, provider)`) and checked in code with clear 409s: `GOOGLE_ACCOUNT_IN_USE` (that Google account belongs to another Shortlist account) and `GOOGLE_ALREADY_LINKED` (this account already has a different one). A race between two links hits the index and gets the same 409. Linking the already-linked account again is a no-op 204. Google re-authentication accepts only the linked subject.
- **Out of scope (unchanged)**: unlinking, email changes, password enrollment for Google-only accounts (they are told to confirm with Google), MFA.
- **Contact email is unaffected by linking**: linking does not change or verify the account email.

### Account screen (T28)

- **`GET /auth/me` grew two fields** (additive contract change): `signInMethods { password, google }` and `recentAuthUntil` (when the session stops counting as recently authenticated, or null). The page uses them to show only the actions that exist and to skip the password step right after sign-in.
- **What the page offers**: email and its verification (resend if needed); password accounts get "Email me a reset link" (the existing reset flow, sent to their own address); Google-only accounts are told adding a password isn't available yet; a linked Google account shows Connected with no unlink control; Log out. Unlinking, email change and password enrollment remain out of scope (api-contracts).
- **Connect Google**: step 1 confirms the password (`/auth/reauthenticate`) unless the session was authenticated within the window; step 2 is Google's own button with a link-purpose attempt, then `/auth/google/link`. If the window ran out between the steps, the server's `REAUTHENTICATION_REQUIRED` sends the person back to step 1 with a note. Account-in-use and already-linked answers get plain messages. `GoogleButton` gained a `purpose` input; link attempts are never reused.
- **Suspension**: a member request answered `403 ACCOUNT_SUSPENDED` signs the person out locally and goes to `/login?suspended=1`, which explains it. (The server already discards the session.)
- **Sign-in collision copy updated**: the Google sign-in 409 now points to "log in with your password, then connect Google from your account page".

### Public abuse reporting (T29)

- **API**: `POST /api/v1/reports { code, category, details? }` answers `202 { status: "accepted" }` for every code. The row is written by one `INSERT … SELECT … FROM links WHERE code = $1`, so an unknown code stores nothing (no orphaned rows, no separate existence check). Malformed codes never reach the database. Exact, case-sensitive match. Reports never block a link by themselves; admins decide (T30–T31).
- **Protection**: session + CSRF (guests use their anonymous session), per-network `report` quota (5/hour default) counted before validation, strict schema (no `status`, `linkId` or other fields), details trimmed, at most 2000 characters (matches the database check), NUL characters rejected (PostgreSQL text cannot store them; would otherwise be a 500).
- **Challenge**: the contract lists an optional `challengeToken`; reports do not use one yet (the quota applies, and the real challenge provider is T37). The strict schema therefore rejects the field for now; it will be added with the provider.
- **Reporter**: a signed-in reporter's account id is stored; guests are anonymous.
- **Form** (`/report`, footer "Report abuse", `?code=` prefill): accepts a full short link or a code (case kept, `/r/` extracted), category as a native radio group with descriptions, optional details with a counter and a privacy hint. The confirmation is identical for every link and never says whether it was found; focus moves to its heading. Inputs are kept on every error; 429 shows the wait.
- **Placeholder removed**: no route uses the "coming soon" preview any more, so `ComingSoon` and the `.mock-banner` style were deleted.
- **Dev-server pitfall (again)**: after adding exports to `@shortlist/contracts/constants`, Vite's pre-bundled copy went stale and the app rendered blank (`does not provide an export named …`). Fix: stop `ng serve`, delete `apps/web/.angular/cache`, start again.

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
