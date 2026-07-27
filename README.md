# The Lab

Fantasy football tools for [Sleeper](https://sleeper.com) leagues. The app mirrors
a manager's Sleeper league graph into Postgres, keeps it fresh with a background
crawler, and layers on dynasty player values scraped from
[KeepTradeCut](https://keeptradecut.com).

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
Postgres (`pg` + `node-pg-migrate`) · Node 22.

## Getting started

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL
npm run dev                 # http://localhost:3000
```

Migrations apply automatically on boot (see [Database](#database)), so a fresh
database needs no extra step. For local dev you usually also want
`LEAGUE_CRAWLER=off` in `.env` so the background crawler isn't hammering Sleeper
while you work.

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | Postgres connection string. Also read by the `migrate:*` scripts. |
| `DATABASE_SSL` | no | auto | `require` forces TLS on, `disable` forces it off. Auto-detects: off for `localhost`, on (relaxed verification) for remote/managed hosts. |
| `LEAGUE_CRAWLER` | no | on | Set to `off` to disable the background league crawler. |

## Architecture

```
src/
  app/         Routes — pages and API route handlers only; no business logic
  features/    Client UI, one folder per tool; `shared/` holds cross-feature
               pieces (PageShell, Avatar, apiFetch)
  shared/      Domain logic, one folder per concern
```

`shared/` never imports from `features/`. Each folder exposes a barrel
`index.ts`; import from the module (`@/shared/manager`), not its internals.

Path aliases: `@/*` → `src/*`, and `@thelab/http` → `src/shared/http` (a
preconfigured axios instance: 30s timeout, 3 retries with backoff).

The shapes crossing the network are declared once in
[`shared/manager/contract.ts`](src/shared/manager/contract.ts). Route handlers
annotate what they send with those types and the client annotates what it
receives, so the two ends can't drift without a type error.

### `shared/` modules

- **`sleeper/`** — typed client for the Sleeper API (users, leagues, rosters,
  drafts, transactions, players, NFL state).
- **`manager/`** — the core. Fetches a manager's full league graph
  (`graph.ts`), writes it transactionally (`persist.ts`), orchestrates syncs
  (`sync.ts`), reads it back for the UI (`queries.ts`), and runs the background
  crawler (`crawl.ts` for the orchestration, `crawl-queue.ts` for the queue
  SQL, `scheduler.ts` for the loop).
- **`ktc/`** — scrapes KeepTradeCut dynasty rankings and per-player value
  history. `parse.ts` (page parsing) and `match.ts` (KTC → Sleeper id matching
  by name) are pure and directly tested; `client.ts` does the fetching.
- **`players/`** — caches Sleeper's ~12k-entry global players map, and owns
  every read of it.
- **`db/`** — connection pool, TLS policy, migration runner, and the
  `bulkInsert` / `withTransaction` / `withAdvisoryLock` / `isFresh` helpers.
- **`util/`** — `startBackgroundLoop` (the shared scheduler lifecycle),
  `mapWithConcurrency`, `errorMessage`.

### API routes

| Route | Description |
| --- | --- |
| `GET /api/user/[username]` | Resolve a Sleeper user. |
| `GET /api/user/[username]/leagues` | A manager's leagues, as a **newline-delimited JSON stream** (`result` / `progress` / `error` messages). Serves cached data immediately and pushes a second `result` when a background refresh finishes. |
| `GET /api/league/[leagueId]` | One league's standings and rosters, with player ids resolved to names. |
| `GET\|POST /api/players/sync` | Refresh the cached players map. `?force=1` bypasses the freshness gate. |

## Background work

Both loops start in [`src/instrumentation.ts`](src/instrumentation.ts) once
migrations have applied. They are Node-only, `unref`'d so they never hold the
process open, and guarded by Postgres advisory locks so extra instances sharing
one database don't duplicate the work.

- **League crawler** (every 60s) — re-syncs the stalest stored leagues, then
  enumerates a few league members to discover leagues it has never seen. This is
  what grows the corpus; it is seeded by the first username anyone searches.
  Both passes are bounded, so a tick costs roughly the same no matter how large
  the corpus gets.
- **KTC scheduler** (every 15 min) — refreshes dynasty values, records a daily
  snapshot per player, and chips away at the per-player history backfill (5
  players per tick; their pages are 3–6MB each).

### Freshness windows

| Data | TTL |
| --- | --- |
| Manager league sync | 10 min |
| Stored league (crawler refresh) | 15 min |
| KTC values | 15 min |
| Manager league-list enumeration | 6 hours |
| Sleeper players map | 24 hours |
| KTC per-player history | 30 days |

## Database

Migrations live in `db/migrations` as plain SQL. They are applied two ways
against the same `pgmigrations` history table, so the CLI and the server agree:

- **On boot** — `src/instrumentation.ts` runs pending migrations before the
  server accepts requests, and fails loudly if they don't apply. `node-pg-migrate`
  takes an advisory lock and wraps the batch in one transaction, so concurrent
  boots are safe.
- **By hand** — `npm run migrate:up` / `migrate:down` / `migrate:redo`.

```bash
npm run migrate:create add_some_table   # new timestamped .sql migration
```

Sleeper's nested payloads (settings, scoring, metadata, id arrays) are stored as
`JSONB`; the columns that get queried or joined on are promoted to real columns.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server. |
| `npm run build` / `npm start` | Production build and serve. |
| `npm test` | Unit tests. |
| `npm run lint` | ESLint. |
| `npm run migrate:up` / `:down` / `:redo` / `:create` | Migration CLI. |

## Tests

`npm test` runs Node's built-in test runner over `src/**/*.test.ts` — no test
framework dependency, and no build step, since Node 22 strips the TypeScript
itself. Test files import with an explicit `.ts` extension so Node can resolve
them directly.

Coverage is aimed at the logic that is pure, load-bearing, and most likely to
break silently:

- `shared/ktc/parse` — the scrapers for KTC's embedded JSON. KTC can change its
  markup at any time, so these run against page-shaped fixtures.
- `shared/ktc/match` — name matching between KTC and Sleeper, including the
  cases where it must *refuse* to guess (a wrong player id is worse than none).
- `features/manager/filters` and `format` — the Sleeper `settings` quirks and
  the display formatting.

Anything that talks to Postgres or the network is deliberately not covered here;
those paths are kept thin so the logic worth testing sits outside them.

## Deployment

Runs on Heroku via the `Procfile` (`web: npm start`) with Node 22 pinned in
`package.json` `engines`. Managed Postgres providers require TLS and present a
self-signed chain, which `DATABASE_SSL`'s auto-detection already handles.
`node-pg-migrate` and `pg` are kept as native Node modules via
`serverExternalPackages` in `next.config.ts` — the migration runner loads
migration files through a runtime `import()` the bundler can't statically
resolve.

## Status

**Manager** is the implemented tool: search a Sleeper username to browse that
manager's leagues, filter by type and format, and expand any league for
standings and full rosters.

**Pick Tracker**, **Trades**, and **Lineup Checker** are listed on the tools
grid but not built. Their pages render a shared `ToolPlaceholder` that reads the
title and blurb from [`tools.data.ts`](src/features/tools/tools.data.ts), so
there is one description per tool. To build one, add a
`src/features/<tool>/` folder and point its page at that instead.
