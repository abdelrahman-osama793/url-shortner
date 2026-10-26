# Shortlist — URL shortener

A URL shortener built as a deliberate **system-design and implementation exercise**: guest and registered short links, public redirects, custom aliases, click analytics, Google and email/password sign-in, and an abuse-moderation workspace.

> **Status: early development.** The repository currently contains the project scaffold and the local Docker environment (tasks T01–T03). Links, redirects, authentication, analytics and the product UI are designed but **not implemented yet**. Nothing is deployed. See [Progress](#progress).

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

### 4. Start the frontend

```bash
npm start -w @shortlist/web
```

Open http://localhost:4200.

### 5. Check it works

```bash
curl http://localhost:3000/health/live
```

The expected response is `{"status":"ok"}`.

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
| `npm run build` | Generates contract type declarations, then builds Angular |
| `npm run check` | Type-checks the shared contracts (JSDoc). Angular is type-checked by its build |
| `npm test` | Runs the Angular unit tests. Server integration tests arrive with T06 |
| `docker compose logs -f api worker` | Follow backend logs |
| `docker compose ps` | Service status and health |
| `npm run dev:api -w @shortlist/server` | Run the API on the host instead of in Docker (needs the env vars from compose) |

## Project layout

```text
apps/web/                 Angular app (TypeScript)
apps/server/src/
  api.js, worker.js       process entry points
  config.js               reads environment once; passed to modules as arguments
  lifecycle.js            startup, graceful shutdown, process-level error handlers
  http/                   Express app, routes and middleware
packages/contracts/       zod schemas shared by server and web
database/migrations/      versioned SQL migrations (from T04)
deploy/                   Dockerfiles
compose.yaml              local development stack
docs/DECISIONS.md         implementation decisions and their reasons
```

## Engineering conventions

- **SOLID with restraint.** One module per responsibility. Dependencies are passed in rather than imported as globals. New features add a module or router instead of editing unrelated ones. No abstraction until a second implementation exists.
- **Readable code.** Small functions, clear names, blank lines between logical blocks, and comments that explain *why*.
- **No unhandled errors.** Process-level handlers, one Express error middleware returning a consistent error envelope (no stack traces), and `async`/`await` with every promise handled.
- **Honest status.** Mocked behaviour is labelled as mocked. Features and measurements are claimed only after they are verified.

## Progress

Planning follows a 39-task backlog across eight milestones:

| Milestone | Scope | Status |
|---|---|---|
| A. Local foundation | Baseline, scaffold, Docker, migrations, API conventions, CI | **In progress**: T01–T02 done, T03 under verification |
| B. Guest links and redirects | Code allocation, rate limits, guest creation, redirects | Not started |
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
