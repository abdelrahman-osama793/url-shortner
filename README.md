# Shortlist — URL shortener

A URL shortener built as a deliberate **system-design and implementation exercise**: guest and registered short links, public redirects, custom aliases, click analytics, Google and email/password sign-in, and an abuse-moderation workspace.

[![CI](https://github.com/abdelrahman-osama793/url-shortner/actions/workflows/ci.yml/badge.svg)](https://github.com/abdelrahman-osama793/url-shortner/actions/workflows/ci.yml)

> **Status: early development.** The repository currently contains the project scaffold, the local Docker environment, the database schema and the shared API conventions (validation, errors, logging, health checks) (tasks T01–T06, verified). Links, redirects, authentication, analytics and the product UI are designed but **not implemented yet**. Nothing is deployed. See [Progress](#progress).

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

`.env` holds local secrets and is git-ignored. Copy the example, then fill in `POSTGRES_PASSWORD` and `REDIS_PASSWORD`:

```bash
cp .env.example .env
```

Generate each value with `openssl rand -hex 24`. Compose refuses to start while a required value is missing.

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

Open http://localhost:4200.

### 5. Check it works

```bash
curl http://localhost:3000/health/ready
```

The expected response is `{"status":"ready","checks":{"postgres":"up"}}`. `/health/live` only shows that the process is answering; `/health/ready` also checks PostgreSQL.

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

Server tests use real PostgreSQL, not mocks. Each test file creates its own throwaway database (`shortlist_test_<random>`), applies the migrations and drops it afterwards, so test runs never touch your development data and can run in parallel.

Connection settings come from `TEST_DATABASE_URL` if set; otherwise from `POSTGRES_*` in `.env` (via the host port). If neither is available, or PostgreSQL is down, the tests **fail**. They are never skipped and never reported as passing.

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
- **Server integration tests:** the server suite against a PostgreSQL 17 service container, using throwaway credentials that exist only inside the job.

## Project layout

```text
apps/web/                 Angular app (TypeScript)
apps/server/src/
  api.js, worker.js       process entry points
  infra/postgres.js       connection pool and transaction helper
  config.js               reads environment once; passed to modules as arguments
  lifecycle.js            startup, graceful shutdown, process-level error handlers
  errors.js               AppError: the only errors whose details reach API clients
  infra/logger.js         structured JSON logs with secret redaction
  http/                   Express app, routes and middleware (request IDs, no-store, origin check, validation, errors)
packages/contracts/       zod schemas shared by server and web, plus generated openapi.json
database/migrations/      versioned SQL migrations
apps/server/test/         integration tests (node:test against real PostgreSQL)
deploy/                   Dockerfiles
compose.yaml              local development stack
docs/DECISIONS.md         implementation decisions and their reasons
```

## API conventions

- **Base path:** `/api/v1` for the API (routes arrive from T07), `/r/{code}` for redirects, and `/health/live` and `/health/ready` for operations.
- **Errors:** every failure returns `{ "error": { "code", "message", "requestId", "fields"? } }`. The codes are listed in `packages/contracts/src/errors.js` and in [`openapi.json`](packages/contracts/openapi.json). Responses never include stack traces or internal details.
- **Requests:** JSON bodies are limited to 16 KiB, and unknown fields are rejected. State-changing requests must send an `Origin` listed in `ALLOWED_ORIGINS`.
- **Responses:** every response has `Cache-Control: no-store` and a server-generated `X-Request-Id`. Quote that ID when reporting an error; it matches the log line.
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
| B. Guest links and redirects | Code allocation, rate limits, guest creation, redirects | Next: T07 (link domain) |
| C. Authentication and owned links | Sessions/CSRF, email flows, Google sign-in, account linking, link management | Not started |
| D. Analytics pipeline | Click capture, worker, queries, retention and health | Not started |
| E. Angular product UI | Public, auth, workspace and analytics screens | Not started |
| F. Reporting and moderation | Abuse reports, admin APIs and workspace | Not started |
| G. Verification and capacity | End-to-end journeys, failure tests, 1M-link / 1,000 rps benchmark | Not started |
| H. Deployment | Free-tier hosting, external integrations, release | Not started |

## Known limitations and open decisions

- **Hosting:** free tiers only. Sleeping services and quotas will limit the public demo. The capacity benchmark is a separate, documented experiment, not a claim about the free deployment.
- **Not configured yet:** Google OAuth client, email provider, human-verification challenge provider, GeoIP source. Until they exist, those features are not claimed to work.
- **Dev server audit warning:** `npm audit` reports an advisory in the Vite version used by Angular's dev server. It affects only local development, not production bundles.
