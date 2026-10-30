# Shortlist — URL shortener

A URL shortener built as a deliberate **system-design and implementation exercise**: guest and registered short links, public redirects, custom aliases, click analytics, Google and email/password sign-in, and an abuse-moderation workspace.

[![CI](https://github.com/abdelrahman-osama793/url-shortner/actions/workflows/ci.yml/badge.svg)](https://github.com/abdelrahman-osama793/url-shortner/actions/workflows/ci.yml)

> **Status: early development.** Guests can create short links on the home page and follow them. People can sign up, verify their email, log in, reset their password and log out in the web app. Signed-in users can manage their own links and read their click analytics through the API (those screens come in T26–T27). Tasks T01–T14 and T17–T24 are done and verified; T25 (auth screens) is done apart from the real Google sign-in check it shares with T15. Nothing is deployed. See [Progress](#progress).

## Why this project exists

A URL shortener looks simple, but it touches most of the problems real services face. This project was started to practise them properly, rather than to ship a toy:

- **Learn system design by building it.** Unique-code allocation under concurrency, immediate consistency of edits, an asynchronous analytics pipeline, rate limiting, sessions and failure handling. Each one has to be built and tested, not just drawn.
- **Build something that could be hardened for real clients.** Real authentication (email verification, password reset, Google sign-in, explicit account linking), moderation with audit history, and documented behaviour when PostgreSQL, Redis or the worker fail.
- **Produce defensible evidence.** Every claim should be backed by a test, a measurement or a recorded check. The capacity goal (one million stored links, 1,000 redirects per second) will be load-tested and reported with real numbers, whether or not it is met.

## What it will do

| Who | Capabilities |
|---|---|
| Guests | Shorten a URL with a generated code; the link expires after 7 days. No editing, aliases or analytics. Rate-limited, with a human-verification challenge when activity looks suspicious. |
| Registered users | Custom aliases (case-sensitive, immutable), optional expiry, edit the destination, disable/re-enable links, per-link analytics. |
| Visitors | `GET /r/{code}` → `302` redirect. Edits and disables take effect for every request after the update succeeds; no stale caching. |
| Analytics | Total and daily clicks, country, device type and referring site, updated within about 10 seconds under normal load. Click counts are approximate and are not unique visitors. |
| Administrators | Review public abuse reports, block links and suspend accounts, with recent re-authentication and an append-only audit trail. |

## Architecture

A modular monolith with two processes from one codebase:

```text
Angular SPA ──► Express API (one or more instances) ──► PostgreSQL  (links, accounts, aggregates — source of truth)
                     │                               ──► Redis       (sessions, shared rate limits)
Visitor ──► /r/{code} ┘ ── click event ──► Redis Stream ──► Worker ──► PostgreSQL aggregates
                                                            Worker ──► email outbox → SMTP
```

Key design choices:

- **Redirects read the PostgreSQL primary on every request.** A cache would make edits and disables visible only after a delay, which breaks a confirmed requirement.
- **Analytics is asynchronous.** Redirects publish an event and return immediately. The worker deduplicates by event ID inside a transaction, so a crash-and-replay never double-counts.
- **Sessions are opaque HttpOnly cookies stored in Redis.** Account status and session version are checked in PostgreSQL, so suspension and password-reset revocation take effect immediately.
- **Optimistic concurrency.** Link edits use ETag/If-Match, so a stale edit is rejected rather than overwriting a newer one.

The full reasoning is in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Angular 22 (TypeScript) |
| Backend API and worker | Node.js 22 + Express 5, **plain JavaScript (ES modules)** |
| Shared contracts | zod 4 schemas in JavaScript, with TypeScript declarations generated for Angular |
| Database | PostgreSQL 17 |
| Sessions, rate limits, queue | Redis 7.4 (Streams for click events) |
| Local email | Mailpit (catches mail; never delivers it) |
| Containers | Docker Compose |

## Getting started

### Prerequisites

- **Node.js 22.23+** and npm 10. With nvm, run `nvm use` in the repository (it reads `.nvmrc`).
- **Docker** with the Compose plugin. Your user must be able to run `docker` without sudo.
- `openssl`, used once to generate local secrets.

> **Docker installed as a snap (Ubuntu):** the snap is sandboxed. It can only read folders in your home directory that are not hidden, so keep the project under a path like `~/projects/…`, not in `/tmp` or a dot-folder. The snap also ships without a `docker` group: create it with `sudo addgroup --system docker`, add yourself with `sudo usermod -aG docker $USER`, restart the snap (`sudo snap disable docker && sudo snap enable docker`), then log out and back in.

### 1. Install dependencies

```bash
npm install
```

### 2. Create your local environment file

`.env` holds local secrets and is git-ignored. Copy the example, then fill in `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `RATE_LIMIT_SECRET` and `EMAIL_OUTBOX_KEY`:

```bash
cp .env.example .env
```

Also set `RATE_LIMIT_SECRET` (at least 32 characters) and `EMAIL_OUTBOX_KEY` (32 random bytes, base64). Generate the passwords with `openssl rand -hex 24`, the rate-limit secret with `openssl rand -hex 32`, and the outbox key with `openssl rand -base64 32`. Compose refuses to start while a required value is missing.

### 3. Start the backend stack

```bash
docker compose up -d --build --wait
```

This starts the API, the worker, PostgreSQL, Redis and Mailpit, and waits until their health checks pass. Backend source is mounted into the containers, so saving a file restarts the process automatically.

Startup order: PostgreSQL becomes healthy → the one-shot `migrate` service applies pending migrations and exits → the API and worker start.

### 4. Start the frontend

```bash
npm start -w @shortlist/web
```

Open http://localhost:4200. The Angular dev server forwards `/api`, `/r/` and `/health` to the API on port 3000 (`apps/web/proxy.conf.json`), so the browser uses one origin, exactly as in production. Short links returned by the API (`http://localhost:4200/r/…`) open from there too.

Screens built so far: the public home page, whose shortening form is connected to the real API (in development, the verification step uses a labelled mock challenge); Log in, Sign up, email verification and password reset, all connected to the real API (verification and reset emails arrive in Mailpit at http://localhost:8025); and the workspace (signed-in only) with your email, Log out, a verify-your-email banner for unverified accounts, and clearly labelled **sample data** for links (real links in T26). Placeholder screens say which task builds them.

### 5. Check it works

```bash
curl http://localhost:3000/health/ready
```

The expected response is `{"status":"ready","checks":{"postgres":"up"}}`. `/health/live` only shows that the process is answering; `/health/ready` also checks PostgreSQL.

### 6. Try it with curl

The home page does this for you, but you can also create a guest link and follow it from a terminal. The cookie file keeps your session between commands, like a browser would.

Get a session cookie and its CSRF token:

```bash
curl -s -c cookies.txt -H 'Origin: http://localhost:4200' http://localhost:3000/api/v1/auth/csrf
```

Copy the `csrfToken` value from the response, then create a link (replace `PASTE_TOKEN`):

```bash
curl -s -b cookies.txt -X POST http://localhost:3000/api/v1/links -H 'Origin: http://localhost:4200' -H 'Content-Type: application/json' -H 'X-CSRF-Token: PASTE_TOKEN' -d '{"destinationUrl":"https://www.wikipedia.org/"}'
```

The response contains a `code`. Open `http://localhost:3000/r/<code>` in a browser to be redirected. (With the Angular dev server running, the returned `shortUrl` on port 4200 works as well.)

The third creation within 10 minutes returns `403 CHALLENGE_REQUIRED`. In development, get a mock challenge token and send it as `"challengeToken"` in the body:

```bash
curl -s -b cookies.txt -X POST http://localhost:3000/api/v1/dev/challenge-token -H 'Origin: http://localhost:4200' -H 'Content-Type: application/json' -H 'X-CSRF-Token: PASTE_TOKEN' -d '{"action":"guest-create"}'
```

After 5 creations in an hour from your machine you get `429 RATE_LIMITED` with `Retry-After`. Delete `cookies.txt` when you are done.

#### Create an account and sign in

Using the same `cookies.txt` and CSRF token as above, sign up (passwords need at least 12 characters):

```bash
curl -s -b cookies.txt -X POST http://localhost:3000/api/v1/auth/register -H 'Origin: http://localhost:4200' -H 'Content-Type: application/json' -H 'X-CSRF-Token: PASTE_TOKEN' -d '{"email":"you@example.com","password":"a long passphrase here"}'
```

Open Mailpit at http://localhost:8025, open the "Confirm your Shortlist email address" message, and copy the value after `#token=` in its link. (The link itself opens a page that arrives with the UI in T25.) Verify with it:

```bash
curl -s -b cookies.txt -X POST http://localhost:3000/api/v1/auth/email/verify -H 'Origin: http://localhost:4200' -H 'Content-Type: application/json' -H 'X-CSRF-Token: PASTE_TOKEN' -d '{"token":"PASTE_EMAIL_TOKEN"}'
```

Then sign in. `-c` saves the new session cookie that sign-in issues:

```bash
curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:3000/api/v1/auth/login -H 'Origin: http://localhost:4200' -H 'Content-Type: application/json' -H 'X-CSRF-Token: PASTE_TOKEN' -d '{"email":"you@example.com","password":"a long passphrase here"}'
```

Sign-in returns a **new** `csrfToken`; the old one stops working. Check who you are:

```bash
curl -s -b cookies.txt http://localhost:3000/api/v1/auth/me
```

#### Manage your own links (signed in, email verified)

After signing in, use the **new** `csrfToken` from the sign-in response. Create a link with your own alias:

```bash
curl -si -b cookies.txt -X POST http://localhost:3000/api/v1/links -H 'Origin: http://localhost:4200' -H 'Content-Type: application/json' -H 'X-CSRF-Token: PASTE_NEW_TOKEN' -d '{"destinationUrl":"https://www.wikipedia.org/","customAlias":"my-wiki"}'
```

The response headers include `ETag: "v1"` and the body includes the link's `id`. List your links with `curl -s -b cookies.txt http://localhost:3000/api/v1/links`. To change the destination, send the version you last saw in `If-Match`:

```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/v1/links/PASTE_ID -H 'Origin: http://localhost:4200' -H 'Content-Type: application/json' -H 'X-CSRF-Token: PASTE_NEW_TOKEN' -H 'If-Match: "v1"' -d '{"destinationUrl":"https://example.org/"}'
```

Add `-H 'Idempotency-Key: <any UUID>'` to the create request to make it safe to retry: repeating it with the same key returns the same link (with `Idempotent-Replayed: true`) instead of creating another; the same key with a different body returns `409`.

See a link's clicks with `curl -s -b cookies.txt http://localhost:3000/api/v1/links/PASTE_ID/analytics` (add `?from=2026-10-01&to=2026-10-15` for a specific UTC range). Clicks appear a few seconds after the redirect, once the worker has processed them.

`http://localhost:3000/r/my-wiki` now redirects to the new destination. Sending `"v1"` again returns `412` (someone changed it since); leaving out `If-Match` returns `428`. `{"enabled":false}` disables the link (`410` on redirect) and `{"enabled":true}` re-enables it.

Forgot your password? `POST /api/v1/auth/password/forgot` with `{"email":"…"}` sends a "Reset your Shortlist password" email to Mailpit. Then `POST /api/v1/auth/password/reset` with `{"token":"…","newPassword":"…"}`, using the token from that email's link. Every session signed in before the reset stops working.

### Stopping

```bash
docker compose down
```

This keeps your database and Redis data in named volumes. Add `-v` only if you want to delete that data.

## Local services and ports

All ports bind to `127.0.0.1` only. Change any that clash with local services in `.env`.

| Service | URL / host port | Notes |
|---|---|---|
| Angular dev server | http://localhost:4200 | runs on the host, not in Docker |
| API | http://localhost:3000 | `API_PORT` |
| PostgreSQL | `localhost:5432` | `POSTGRES_PORT`; credentials from `.env` |
| Redis | `localhost:6380` | `REDIS_PORT`; password required. 6380 avoids clashing with a host Redis on 6379 |
| Mailpit web UI | http://localhost:8025 | view emails the app "sends" |
| Mailpit SMTP | `localhost:1025` | `MAILPIT_SMTP_PORT` |

## Commands

| Command | What it does |
|---|---|
| `npm run verify` | **Everything CI runs:** build, lint, check, then all tests. Run it before pushing |
| `npm run build` | Generates contract type declarations, then builds Angular |
| `npm run lint` | ESLint for the JavaScript backend and the Angular app |
| `npm run check` | Type-checks the shared contracts (JSDoc) and fails if `openapi.json` is out of date |
| `npm test` | Server integration tests (needs PostgreSQL) and Angular unit tests |
| `npm test -w @shortlist/server` | Server tests only |
| `EMAIL=… PASSWORD=… node apps/server/scripts/measure-analytics-freshness.mjs 40 250` | Measure how long clicks take to appear in analytics on the running stack |
| `docker compose up -d --no-deps <service>` | Restart one service without starting its dependencies (needed when simulating an outage) |
| `npm run openapi -w @shortlist/contracts` | Regenerates `packages/contracts/openapi.json` from the zod schemas |
| `docker compose run --rm migrate` | Apply pending migrations |
| `docker compose logs -f api worker` | Follow backend logs (JSON lines) |
| `docker compose ps` | Service status and health |

## Contributing

### Before you push

1. Start the stack with `docker compose up -d --wait`, because the server tests need PostgreSQL.
2. Run `npm run verify`. It must exit 0.
3. If you changed a schema in `packages/contracts`, run `npm run openapi -w @shortlist/contracts` and commit the regenerated `openapi.json`.

### How the tests reach the database

Server tests use real PostgreSQL, Redis and Mailpit, not mocks. Each test file creates its own throwaway database (`shortlist_test_<random>`) and Redis key prefix (`test:<random>:`), and removes them afterwards, so test runs never touch your development data and can run in parallel.

Connection settings come from `TEST_DATABASE_URL` / `TEST_REDIS_URL` if set; otherwise from `POSTGRES_*` / `REDIS_*` in `.env` (via the host ports). If neither is available, or a service is down, the tests **fail**. They are never skipped and never reported as passing.

### Lint rules that enforce the conventions

| Rule | Why |
|---|---|
| `promise/catch-or-return` | Every promise chain is awaited, returned or ends in `.catch` |
| `promise/avoid-new` | Use `async`/`await`, `util.promisify` or `events.once`, not `new Promise` |
| `no-console` | Backend code logs through the injected pino logger, which redacts secrets |
| `@typescript-eslint/no-floating-promises` | The same rule as the first row, for Angular (type-aware) |

### Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request:

- **Lint, type check, build:** `npm ci`, build, lint, check and the Angular tests.
- **Server integration tests:** the server suite against PostgreSQL 17, Redis 7.4 and Mailpit service containers, using throwaway credentials that exist only inside the job.

## Project layout

```text
apps/web/                         Angular app (TypeScript)
  src/styles.css                  design tokens (light/dark via light-dark()), base, buttons, forms
  src/app/layouts/                public, auth (inside public) and workspace layouts
  src/app/shared/ui/              icon, logo, status badge, theme switcher
  src/app/pages/                  screens (placeholders name the task that builds them)
apps/server/src/
  api.js                          API composition root: creates every service, controller and router
  worker.js                       worker process (email delivery; analytics later)
  config.js                       reads and validates environment variables once
  errors.js                       AppError: the only errors whose details reach API clients
  lifecycle.js                    startup, graceful shutdown, process-level error handlers
  http/
    app.js                        middleware every request passes through
    routes/<feature>.routes.js    paths + middleware chain + controller method, nothing else
    controllers/<feature>.controller.js   request → service call → response
    middleware/                   reusable checks: session, CSRF, rate limit, validation, errors
  modules/<feature>/             accounts, links, sessions, email, abuse, idempotency, analytics, maintenance
    <name>.service.js             business rules and transactions
    <name>.repository.js          SQL only
    <name>.presenter.js           database row → API response shape
    rules/                        small pure helpers (validation rules, generators, crypto)
  infra/                          PostgreSQL pool, Redis client, logger, mailer
packages/contracts/               zod schemas shared by server and web, plus generated openapi.json
database/migrations/              versioned SQL migrations
apps/server/test/                 integration tests (real PostgreSQL, Redis and Mailpit)
deploy/                           Dockerfiles
compose.yaml                      local development stack
docs/DECISIONS.md                 implementation decisions and their reasons
```

### How to read the backend

Every endpoint follows the same path: **routes → controller → service → repository**.

1. Start at **`src/api.js`**. It is the table of contents: it shows which services, controllers and routers exist and how they are connected.
2. Open the feature's **`http/routes/<feature>.routes.js`**. Each line is a path, the middleware it passes through, in order, and the controller method that handles it.
3. Follow the controller method in **`http/controllers/<feature>.controller.js`**. It only reads the (already validated) request, calls one service, and writes the response.
4. The **service** (`modules/<feature>/*.service.js`) holds the business rules and transaction boundaries.
5. The **repository** (`*.repository.js`) holds the SQL. Nothing else talks to PostgreSQL. Redis-backed services (sessions, rate limits, challenges) own their Redis keys directly, because there is no SQL to separate.

Example, creating a guest link (`POST /api/v1/links`):

```text
http/routes/links.routes.js            session → CSRF → signed-in check → rate limit → validation → challenge
http/controllers/links.controller.js   createGuestLink(req, res)
modules/links/links.service.js         createGuestLink(): destination rules, code allocation, transaction
modules/links/links.repository.js      lockCode(), insertGuestLink(), findLinkById()
modules/links/links.presenter.js       toGuestLinkResource()
```

The file suffix always tells you the layer: `.routes`, `.controller`, `.service`, `.repository`, `.presenter`; helpers live in `rules/`.

## API conventions

- **Base path:** `/api/v1` for the API, `/r/{code}` for redirects, and `/health/live` and `/health/ready` for operations.
- **Redirects:** `302` to the stored destination (the request's query string is never appended), `404` for unknown codes, `410` for any inactive link (one generic answer), `503` when PostgreSQL is down or overloaded. Codes are matched exactly and case-sensitively. Redirects never depend on Redis, and nothing is cached, so edits and disables apply to the very next request.
- **Errors:** every failure returns `{ "error": { "code", "message", "requestId", "fields"? } }`. The codes are listed in `packages/contracts/src/errors.js` and in [`openapi.json`](packages/contracts/openapi.json). Responses never include stack traces or internal details.
- **Requests:** JSON bodies are limited to 16 KiB, and unknown fields are rejected. State-changing requests must send an `Origin` listed in `ALLOWED_ORIGINS`.
- **Responses:** every response has `Cache-Control: no-store` and a server-generated `X-Request-Id`. Quote that ID when reporting an error; it matches the log line.
- **Sessions and CSRF:** the browser first calls `GET /api/v1/auth/csrf`, which sets an `__Host-session` cookie (HttpOnly, Secure, SameSite=Lax) and returns a CSRF token. Every state-changing request must send that token as `X-CSRF-Token`, including before sign-in. Protected requests re-check the account's status and session version in the database, so suspension and password resets take effect immediately. If Redis is down, session-dependent requests return `503`; they are never treated as anonymous.
- **Rate limits:** shared across API instances through Redis. Over the limit returns `429 RATE_LIMITED` with `Retry-After`; if Redis is unavailable, protected operations return `503` instead of running unlimited. Suspicious guests must pass a challenge (`403 CHALLENGE_REQUIRED`), and a passed challenge never resets a quota.
- **Challenges in development are mock:** `POST /api/v1/dev/challenge-token` issues test tokens and exists only when `CHALLENGE_PROVIDER=dev`. Production refuses to start until a real provider is integrated (T37).
- **Click capture:** every successful `GET` redirect publishes a small event (link, time, device category, referring site, country if a trusted proxy provides it) to a bounded Redis stream after the redirect is sent. No IP address, User-Agent or full referrer is stored. If Redis is slow, full or down, the redirect is unaffected and the lost event is counted. Click counts are approximate, not unique visitors.
- **Click counting:** the worker reads the click stream in batches and stores each event once, with daily counts per country, device and referring site (at most 100 sites per link per day; the rest are grouped as "other") plus lifetime totals. Events are acknowledged only after the database commit, so a worker crash or database outage loses nothing and never double-counts.
- **Analytics health:** each analytics response includes `pipeline.status`: `healthy`, `delayed` (events waiting more than 10 s), `degraded` (recent lost events or worker errors) or `unknown` (no worker heartbeat for 30 s). Counts are always marked approximate. Raw click events are deleted after 30 days and daily aggregates after `AGGREGATE_RETENTION_DAYS` (365 by default); lifetime totals are kept.
- **Email:** account emails are written to an outbox in the same database transaction as their one-time token, then delivered by the worker with retries. In development every email lands in Mailpit (http://localhost:8025) and nothing is really sent.
- **Logs:** JSON on stdout. Passwords, tokens, cookies and credentials inside connection strings are redacted. Query strings and client IPs are never logged.

## Database migrations

Migrations are plain SQL files in [`database/migrations/`](database/migrations), applied in filename order by [node-pg-migrate](https://salsita.github.io/node-pg-migrate/). Applied migrations are recorded in the `pgmigrations` table. Each file has an `-- Up Migration` section and a `-- Down Migration` section that reverses it.

**Adding a migration:** create the next numbered file, for example `0005_add_something.sql`. Never edit a migration that has already been applied anywhere; write a new one that changes the schema instead.

**If a migration fails:**

1. Each migration runs in its own transaction. A failure rolls back that file completely and it is not recorded, so the database stays at the last successful migration. The automated tests check this.
2. Read the error with `docker compose logs migrate`. The API and worker will not have started, because they wait for `migrate` to succeed.
3. Fix the SQL. If the failed migration was never applied anywhere, edit that file. Otherwise add a new migration.
4. Run `docker compose run --rm migrate` again, then `docker compose up -d --wait`.

To undo the most recent applied migration in development, run `docker compose run --rm migrate npm run migrate -- down`.

Exception: statements that cannot run inside a transaction, such as `CREATE INDEX CONCURRENTLY`, must sit alone in their own migration. If one fails, recover by hand (for example, drop an invalid index) before retrying. For a shared or production database, take a backup before migrating; restoring from it is the recovery path when a migration succeeds but turns out to be wrong.

## Engineering conventions

- **SOLID with restraint.** One module per responsibility. Dependencies are passed in rather than imported as globals. New features add a module or router instead of editing unrelated ones. No abstraction until a second implementation exists.
- **Readable code.** Small functions, clear names, blank lines between logical blocks, and comments that explain *why*.
- **No unhandled errors.** Process-level handlers, one Express error middleware returning a consistent error envelope (no stack traces), and `async`/`await` with every promise handled.
- **Honest status.** Mocked behaviour is labelled as mocked. Features and measurements are claimed only after they are verified.

## Progress

Planning follows a 39-task backlog across eight milestones:

| Milestone | Scope | Status |
|---|---|---|
| A. Local foundation | Baseline, scaffold, Docker, migrations, API conventions, CI | **Done**: T01–T06 |
| B. Guest links and redirects | Code allocation, rate limits, guest creation, redirects | **Done**: T07–T10 (guest links can be created and followed) |
| C. Authentication and owned links | Sessions/CSRF, email flows, Google sign-in, account linking, link management | **In progress**: T11–T14, T17–T18 done (sessions, CSRF, email, sign-up, sign-in, reset, owned link management, retry-safe creation); T15 Google sign-in built, awaiting the real-account check |
| D. Analytics pipeline | Click capture, worker, queries, retention and health | **Done**: T19–T22 (capture, worker, owner analytics API, retention, pipeline health; measured visibility ≤ 0.62 s at light load) |
| E. Angular product UI | Public, auth, workspace and analytics screens | **In progress**: T23–T24 done (design system, layouts, light/dark, guest shortening); T25 auth screens built and verified with email, awaiting the real Google check; next T26 |
| F. Reporting and moderation | Abuse reports, admin APIs and workspace | Not started |
| G. Verification and capacity | End-to-end journeys, failure tests, 1M-link / 1,000 rps benchmark | Not started |
| H. Deployment | Free-tier hosting, external integrations, release | Not started |

## Known limitations and open decisions

- **Hosting:** free tiers only. Sleeping services and quotas will limit the public demo. The capacity benchmark is a separate, documented experiment, not a claim about the free deployment.
- **Not configured yet:** Google OAuth client, email provider, human-verification challenge provider, GeoIP source. Until they exist, those features are not claimed to work.
- **Dev server audit warning:** `npm audit` reports an advisory in the Vite version used by Angular's dev server. It affects only local development, not production bundles.
