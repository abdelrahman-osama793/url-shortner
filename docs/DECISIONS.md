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
| Tests | **Vitest** for server/contracts against real Compose PostgreSQL/Redis; Angular's built-in test runner for UI; Playwright for E2E journeys (T33) | Checks must fail, not skip, when dependencies are missing (T06). |
| Dev mail | **Mailpit** container | Local SMTP catcher; not a real provider. |
| Containers | Docker Engine 29 / Compose v5 present | See blocker below. |

## 4. Module boundaries

Follows technical-design §9:

```text
apps/web/                 Angular public, auth, member and admin UI
apps/server/src/http/     Express routes, middleware (CSRF, sessions, errors)
apps/server/src/modules/  accounts, links, analytics, moderation (domain + SQL)
apps/server/src/infra/    pg pool, redis clients, google, mail adapters
apps/server/src/worker/   analytics consumer, outbox sender, maintenance
apps/server/src/api.js    API process entry
apps/server/src/worker.js Worker process entry
apps/server/src/config.js Environment read once; passed to modules as arguments
apps/server/src/lifecycle.js  Shared graceful shutdown
packages/contracts/       zod schemas + inferred types shared by server and web
database/migrations/      versioned SQL
deploy/                   Dockerfile(s) and compose.yaml
tests/integration/, tests/load/
```

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
