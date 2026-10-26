# Shortlist — URL shortener

Angular (TypeScript) + Node.js/Express (JavaScript) + PostgreSQL + Redis. Planning docs live in `url-shortener-handoff/` (local only, git-ignored); implementation decisions in `docs/DECISIONS.md`; task status in `url-shortener-handoff/IMPLEMENTATION_TASKS.md`.

Status: scaffold only (T01–T02). No database, auth, links or analytics yet.

## Requirements

- Node.js 22.23+ (`nvm use` reads `.nvmrc`), npm 10
- Docker with Compose (from T03)

## Commands

```bash
npm install
npm run build        # contracts type declarations → web
npm run check        # contracts JSDoc type check (web is type-checked by ng build)
npm test             # web unit tests (server tests arrive with T06)
```

| Process | Dev (restarts on change) | Production |
|---|---|---|
| API (`:3000`, `PORT`) | `npm run dev:api -w @shortlist/server` | `npm run start:api -w @shortlist/server` |
| Worker | `npm run dev:worker -w @shortlist/server` | `npm run start:worker -w @shortlist/server` |
| Web (`:4200`) | `npm start -w @shortlist/web` | static files in `apps/web/dist/web/browser` |

## Layout

```text
apps/web/              Angular 22 app (TypeScript)
apps/server/src/       JavaScript: api.js and worker.js entry points, config.js, lifecycle.js, http/
packages/contracts/    zod schemas (JavaScript) shared by server and web; .d.ts generated for Angular
database/migrations/   versioned SQL (from T04)
```
