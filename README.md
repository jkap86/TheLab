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
| `PROJECTIONS_SYNC` | no | on | Set to `off` to disable the weekly projections sync. Each week it refreshes is a ~5.6MB download. |

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
- **`projections/`** — stores Sleeper's weekly projections and owns every read of
  them. `parse.ts` (which entries in a response are real projections), `weeks.ts`
  (which weeks to sync), `filters.ts` (the read route's query string) and
  `score.ts` (scoring a stat line with a league's own settings) and `optimal.ts`
  (the best legal lineup from a roster) are pure and directly tested; `sync.ts`
  fetches and writes, `queries.ts` reads, `scheduler.ts` runs the loop.
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
| `GET /api/projections` | A week of stored projections, ranked by the requested scoring. Reads only — it never calls Sleeper. |
| `GET\|POST /api/projections/sync` | Refresh stored weekly projections. Defaults to the current and next week if stale; `?force=1` ignores the freshness gate, `?week=1,2` backfills specific weeks, `?season=2025` picks another season. |
| `GET /api/adp` | Average draft position over the crawled drafts, filtered by draft and league attributes. |

`/api/adp` computes ADP from `draft_picks` — Sleeper has no ADP endpoint, so it
describes the leagues in *this* database, not the market. The filters exist
because that population is a mix; narrow it before reading anything into the
numbers.

| Filter | Values |
| --- | --- |
| `season` | 4-digit year, or `all`. Defaults to the current season. |
| `draft_type` | `snake` \| `linear` \| `auction`. Defaults to snake + linear. |
| `draft_status` | `complete` \| `drafting` \| `paused` \| `pre_draft`. Defaults to complete. |
| `rounds_min` / `rounds_max` | Bounds on the draft's round count. |
| `league_id` | Restrict to specific leagues. |
| `league_type` | `redraft` \| `keeper` \| `dynasty`. |
| `scoring` | `std` \| `half_ppr` \| `ppr`, derived from the league's `rec` value. |
| `best_ball`, `superflex` | Booleans. |
| `teams_min` / `teams_max` | Bounds on the league's team count. |
| `min_picks` | Drop players taken in fewer drafts than this. Defaults to 2. |
| `limit` / `offset` | Paging; `limit` caps at 1000. |

Lists accept repeated params or commas (`?scoring=ppr&scoring=half_ppr` ==
`?scoring=ppr,half_ppr`). Auction drafts are excluded by default because their
`pick_no` is nomination order rather than draft position. `rounds_min` matters
more than it looks — a dynasty league's 4-round rookie draft and its 25-round
startup are both drafts, and pick 1 of one is nothing like pick 1 of the other.
The response echoes the filters it applied, so the defaults stay visible.

`/api/projections` reads the `projections` table the background sync fills, so it
answers with whatever has been synced — a week nobody has pulled in comes back
empty rather than fetched on demand.

| Filter | Values |
| --- | --- |
| `season` | 4-digit year. Defaults to the current season. |
| `week` | 1–18. Defaults to the newest week on file, which is one of the two being kept fresh. |
| `scoring` | `std` \| `half_ppr` \| `ppr`. Picks what players are ranked and scored by; defaults to `ppr`. |
| `position` | Sleeper positions (`WR`, `TE`, `DEF`, `OLB`), matched against the players cache. |
| `player_id` | Restrict to specific players — a roster, say. Intersects with `position` when both are given. |
| `stats` | `1` to include the full projected stat line per player (~27 keys), which is what custom scoring needs. |
| `limit` / `offset` | Paging; `limit` caps at 1000, defaults to 100. |

Two fields in the response are worth reading before displaying anything:
`updated_at` says when those rows were last written — they are a cache of someone
else's numbers, so say how old they are — and `week: null` means the season has
nothing stored at all, which is not the same as a week that matched no filters.

## Background work

All three loops start in [`src/instrumentation.ts`](src/instrumentation.ts) once
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
- **Projections sync** (checks every 15 min, refreshes hourly) — stores Sleeper's
  weekly player projections for the current NFL week and the next one. Freshness
  is judged per week, so a tick that finds both weeks current costs one query;
  past weeks are never re-fetched, since their numbers stop moving once the games
  are played. Backfill one by hand with `/api/projections/sync?week=N`.

### Freshness windows

| Data | TTL |
| --- | --- |
| Manager league sync | 10 min |
| Stored league (crawler refresh) | 15 min |
| KTC values | 15 min |
| Weekly projections (per week) | 1 hour |
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
- `shared/projections/parse` — the filter separating real projections from the
  ~8,500 placeholder entries in every weekly response, which is the difference
  between a usable week and 8,500 rows that read as projected zeroes.
- `shared/projections/weeks` — which weeks the loop targets (Sleeper reports
  week 0 in the offseason) and the `?week=` validation.
- `shared/projections/filters` — the read route's query string, including the
  `scoring` enum that decides which column its `ORDER BY` interpolates.
- `shared/projections/score` — scoring a projected stat line with a league's
  `scoring_settings`. Errors here are silent and small, which is the worst kind
  for a tool whose job is to tell you to bench someone.
- `shared/projections/optimal` — the best legal lineup for a set of slots. Every
  flex case is pinned individually, and the result is cross-checked against an
  exhaustive search on 400 random rosters, because the algorithm is only optimal
  by an argument that deserves to be verified rather than believed.

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
