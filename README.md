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
| `DATABASE_URL` | yes | — | Postgres connection string. Also read by the `migrate:*` scripts. **Missing in production is a fatal startup error** — the server refuses to boot rather than let `pg` fall back to libpq's own defaults, and no background loop starts. In development it is a warning: the app renders, migrations are skipped, and the loops stay down. |
| `DATABASE_SSL_MODE` | no | auto | `disable` \| `verify-full` \| `insecure-require`. Auto-detects: `disable` for `localhost`, `verify-full` for every other host. An unrecognised value fails loudly rather than falling back. |
| `DATABASE_CA_CERT` | no | — | PEM certificate authority for `verify-full`, for providers whose chain isn't in Node's trust store. Literal `\n` sequences are unescaped, so a certificate pasted into a platform config UI works as-is. |
| `DATABASE_SSL` | no | — | **Deprecated**, kept working: `disable` maps to `DATABASE_SSL_MODE=disable`, `require` to `insecure-require`. |
| `DATABASE_POOL_MAX` | no | 10 | Connections **one process** may open. The limit that matters is the *role's* — a managed plan caps every dyno, review app and `psql` session at one number between them (20 on a Heroku Essential plan) — so set this to a single dyno's share when running more than one. Junk or a non-positive value falls back rather than failing the boot. |
| `REQUEST_DEADLINE_MS` | no | 30000 | The deadline the platform enforces on a request (Heroku's router answers `H12` at 30s). Every database wait is a share of it — connect at ⅙, advisory lock at ½, statement at ⅔ — so lowering it tightens them together. Set it if the app sits behind a proxy with a shorter timeout; the waits exist to be shorter than whatever gives up first. |
| `INTERNAL_SYNC_SECRET` | in production, to use the sync routes | — | Shared secret gating the operator sync endpoints (see [Internal sync endpoints](#internal-sync-endpoints)). Sent as the `x-internal-sync-secret` header. In production an unset secret makes those routes answer **503** — they fail closed, never open. On a dev server an unset secret lets them through, so `npm run dev` can still force a sync by hand. |
| `NFL_SEASON_OVERRIDE` | no | — | Pins the operating season (a 4-digit year). Otherwise the season is read from Sleeper's `state/nfl` and cached for six hours, so a league-year rollover needs no redeploy. An implausible value is ignored with a warning. |
| `BACKGROUND_JOBS` | no | every process | Where the background loops run. `worker` runs them in the dedicated worker only (`npm run worker`) and starts none in the web process — **the recommended production setting**, see [Running a worker](#running-a-worker). `off` disables every loop everywhere, the worker included, and outranks the five per-loop switches below, so a loop added later is off without a second edit. Unset — or any other value — every process that registers jobs runs them, which is what a single dyno and local development want. |
| `LEAGUE_CRAWLER` | no | on | Set to `off` to disable the background league crawler. |
| `PROJECTIONS_SYNC` | no | on | Set to `off` to disable the weekly projections sync. Each week it refreshes is a ~5.6MB download. |
| `STATS_SYNC` | no | on | Set to `off` to disable the weekly actual stat-line sync, likewise a multi-megabyte download per week. |
| `KTC_SYNC` | no | on | Set to `off` to disable the KeepTradeCut values refresh and its per-player history backfill. |
| `NFL_DRAFT_SYNC` | no | on | Set to `off` to disable the NFL draft-position refresh — one ~2.6MB CSV, twice a day. The cheapest of the loops by a wide margin. |
| `CACHE_DEBUG` | no | off | Set to `on` to log every read of the three server-side caches (the full ADP board, a manager's ranks, one league's core detail) as `hit`, `miss` or `coalesced`. Development only — these are the hottest reads in the app. |
| `READ_TIMING` | no | off | Set to `on` to log how long each League Details read took, one line per route (`league.core`, `league.values`, `league.outlook`, `league.week`, `league.timeline`). Development only, for the same reason: a line per request is a production log nobody can read past. |

Only the exact word `off` disables a loop. Anything else runs, including junk: a
typo that stopped the syncs would leave the database quietly unfilled for hours
with nothing failing, where a typo that leaves them running is visible at once.

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
- **`nfl-draft/`** — where players were taken in the **NFL** draft (not the
  fantasy drafts `manager/` crawls), keyed by Sleeper id. Sleeper publishes no
  draft position, so this reads the DynastyProcess id crosswalk — the file
  `nfl_data_py.import_ids()` reads. `parse.ts` (what a crosswalk row means),
  `capital.ts` (pick → draft capital) and `validate.ts` (is this response the
  crosswalk?) are pure and directly tested; `client.ts` fetches, `queries.ts`
  reads, `scheduler.ts` runs the loop.
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
| `GET /api/league/[leagueId]` | One league's **core**: standings, rosters, members and owned draft picks, with player ids resolved to names. This is what the detail panel renders on. |
| `GET/POST /api/league/[leagueId]/values` | The same league's KTC and ADP prices, on the ADP drawer's board. Answers a POST when the board's league rules are too long for a request line. |
| `GET /api/league/[leagueId]/outlook` | Every roster's best rest-of-season lineup. `null` when the league can't be projected. |
| `GET /api/league/[leagueId]/week?week=N` | The same league read as one week — projections, points per game and each team's current-versus-optimal lineup. |
| `GET /api/league/[leagueId]/timeline` | The league's stored moves, for the history rail. Fetched only once a reader opens the history. |
| `POST /api/players/sync` | Refresh the cached players map. `?force=1` bypasses the freshness gate. **Internal** — see below. |
| `GET /api/projections` | A week of stored projections, ranked by the requested scoring. Reads only — it never calls Sleeper. |
| `POST /api/projections/sync` | Refresh stored weekly projections. Defaults to the current and next week if stale; `?force=1` ignores the freshness gate, `?week=1,2` backfills specific weeks (at most 18), `?season=2025` picks another season. **Internal** — see below. |
| `GET /api/adp` | Average draft position over the crawled drafts, filtered by draft and league attributes. |

#### Internal sync endpoints

`/api/players/sync` and `/api/projections/sync` fan out to Sleeper — a forced
players refresh is a ~5MB download Sleeper asks be taken at most once a day, and
a projections week is ~5.6MB. They are operator tools, so:

- They are **POST-only**. A `GET` answers `405`, because a request that pulls
  tens of megabytes off an upstream is a state change whatever method it wears,
  and a safe method invites a crawler or a link preview to run it.
- They require `INTERNAL_SYNC_SECRET` in the `x-internal-sync-secret` header.
  Missing header → `401`; wrong secret → `403`; secret not configured on a
  production server → `503` (fail closed, and distinguishable from a wrong
  secret at 3am). On a dev server with no secret configured they are open.
- A run already in flight loses the advisory lock and answers `409` rather than
  a `200` describing someone else's work.

```bash
curl -X POST -H "x-internal-sync-secret: $INTERNAL_SYNC_SECRET" \
  "https://…/api/projections/sync?week=3,4"
```

`/api/user/[username]/leagues` stays public — it is the read every manager page
makes and it answers from cache. What it no longer honours from an anonymous
caller is `?refresh=1`, the knob that forces the full ~9-requests-per-league
fan-out past the TTL; with the internal header it still works. Without it the
parameter is simply ignored and the route behaves normally.

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

All five loops start in [`src/instrumentation.ts`](src/instrumentation.ts) once
migrations have applied. They are Node-only, `unref`'d so they never hold the
process open, and guarded by Postgres advisory locks so extra instances sharing
one database don't duplicate the work.

- **League crawler** (ticks every 60s) — re-syncs the stalest stored leagues,
  then enumerates a few league members to discover leagues it has never seen.
  This is what grows the corpus; it is seeded by the first username anyone
  searches. Both passes are bounded, so a tick costs roughly the same no matter
  how large the corpus gets. How long a league stays fresh between re-syncs is
  seasonal, read off Sleeper's NFL state each tick: 15 minutes in the regular
  season, an hour through the 75-day draft window before kickoff, six hours in
  the deep offseason. The log is the telemetry — a summary when a tick did work,
  an idle heartbeat at most every 15 minutes, and a warning when the stalest
  league is more than twice the active TTL overdue, which is the sign the batch
  can no longer keep up with the corpus.
- **KTC scheduler** (every 15 min) — refreshes dynasty values, records a daily
  snapshot per player, and chips away at the per-player history backfill (5
  players per tick; their pages are 3–6MB each).
- **Projections sync** (checks every 15 min) — stores Sleeper's weekly player
  projections for the whole rest of the season, on two clocks. The current NFL
  week and the next refresh hourly, because they move on injury news; the weeks
  behind them refresh daily, two per tick, because a week-12 projection in July
  changes over weeks rather than hours. Freshness is judged per week, so a tick
  that finds everything current costs two queries; past weeks are never
  re-fetched, since their numbers stop moving once the games are played. Fill the
  horizon in one go, or pull a past week, with `/api/projections/sync?week=N`.
- **Stats sync** (checks every 15 min) — the other half of the projections: what
  players actually did, week by week. Live weeks refresh hourly, settled weeks
  monthly, and the archive back to 2000 is fetched once and never again. It is
  what the Comps pool is assembled from.
- **NFL draft sync** (every 12 hours) — where players were taken in the *real*
  draft, which Sleeper's players map does not carry at all. One ~2.6MB CSV from
  the DynastyProcess id crosswalk — the file `nfl_data_py.import_ids()` reads,
  fetched directly rather than through Python, since that function is a single
  `read_csv` of it. It is the Comps tool's draft-capital dimension. A response
  that doesn't look like the crosswalk is refused rather than written, so a
  truncated body can't delete several thousand good rows; see
  [`validate.ts`](src/shared/nfl-draft/validate.ts). `scripts/nfl-draft-picks.py`
  is the same read done through the library, kept as the provenance note and as
  an oracle — `--check` diffs the TypeScript parser against it.

### Freshness windows

| Data | TTL |
| --- | --- |
| Manager league sync | 10 min |
| Stored league (crawler refresh) | seasonal: 15 min in-season, 1 hour in the draft window, 6 hours offseason |
| KTC values | 15 min |
| Weekly projections — current + next week | 1 hour |
| Manager league-list enumeration | 6 hours |
| NFL draft positions | 12 hours |
| Weekly projections — rest of season | 24 hours |
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
| `npm run worker` | The background-job worker (`src/worker.ts`) — every scheduled loop, no HTTP listener. See [Running a worker](#running-a-worker). |
| `npm test` | Unit tests (Node's test runner via `tsx`). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm run migrate:up` / `:down` / `:redo` / `:create` | Migration CLI. |

## Tests

`npm test` runs Node's built-in test runner over `src/**/*.test.ts` through
[`tsx`](https://tsx.is) — no test framework dependency and no build step. `tsx`
rather than bare `node --test`: Node 22's TypeScript stripping is behind
`--experimental-strip-types` and is not on by default across the 22.x range the
`engines` field allows, so `node --test "src/**/*.test.ts"` fails with
`ERR_UNKNOWN_FILE_EXTENSION` on, for instance, 22.16. Test files still import
with an explicit `.ts` extension.

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

Runs on Heroku via the `Procfile` with Node 22 pinned in `package.json`
`engines`. Two process types share one image and one database:

```
web:    npm start        # the Next server
worker: npm run worker   # the background loops, no HTTP listener
```

Two settings need a decision before a production deploy:

- **TLS.** The default for a remote host is `verify-full`, which verifies the
  server's certificate. Managed providers present a chain Node's trust store
  doesn't hold, so supply theirs as `DATABASE_CA_CERT`. If you need the previous
  behaviour — encrypted but *unverified* — set
  `DATABASE_SSL_MODE=insecure-require` and know that it accepts any certificate.
  **Heroku Postgres needs that second option**: it presents a self-signed
  certificate and publishes no CA to verify it against, so a dyno left on the
  default fails its on-boot migration with
  `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` and the app never serves a request. The
  failure names both variables (`shared/db/tls-error`), because Next reports a
  throwing instrumentation hook as nothing but the error's own message.
- **`INTERNAL_SYNC_SECRET`.** Without it the two sync endpoints answer `503` in
  production. That is deliberate: they are unauthenticated otherwise.

### Running a worker

The five background loops (KeepTradeCut, the league crawl, projections, stat
lines, NFL draft positions) can run *inside the process serving requests*,
sharing its event loop and its Postgres pool. On one dyno — and in development —
that is what you want: a second process would be ceremony around a database that
isn't busy.

It stops being what you want once requests and crawling compete for
`DATABASE_POOL_MAX` connections. The crawler holds a pooled connection across a
league's whole Sleeper fan-out, and a request that has to queue for one is a
request the platform answers `503` for on the app's behalf.

`src/worker.ts` is the dedicated process. It applies migrations, starts every
loop and stays up until the platform stops it, and it **does not listen on a
port** — no route manifest, no `$PORT`, none of the Next server that a second
`npm start` would boot purely to fire the instrumentation hook.

```
# Procfile
web:    npm start        # BACKGROUND_JOBS=worker
worker: npm run worker
```

Migrations run on boot in both, so the order they start in doesn't matter.

#### The one variable

`BACKGROUND_JOBS` says *where* the loops run, and only the exact words `worker`
and `off` mean anything:

| Value | Web process | Worker process |
| --- | --- | --- |
| unset (or `on`, or anything unrecognised) | runs every loop | runs every loop |
| `worker` | runs none | runs every loop |
| `off` | runs none | runs none |

Set it once on the app. Platform config vars are per-app, not per-dyno, so the
role can't come from the environment — it is a fact each entry point knows about
itself (`src/worker.ts` passes `"worker"`, `src/instrumentation.ts` passes
`"web"`), and this variable says which roles are allowed to run jobs. That is
also why `worker` does **not** switch the worker off: one variable, one setting,
no second variable needed to put the jobs back.

The five per-loop switches (`LEAGUE_CRAWLER`, `PROJECTIONS_SYNC`, `STATS_SYNC`,
`KTC_SYNC`, `NFL_DRAFT_SYNC`) still answer for themselves inside whichever
process is running the loops, so `LEAGUE_CRAWLER=off` means the same thing
wherever it is read.

#### Migrating an existing deployment

Order matters, and the failure of doing it backwards is silent:

1. Deploy. Nothing changes — unset, `BACKGROUND_JOBS` runs the loops in the web
   process exactly as before. A production web process logs one line
   recommending the split.
2. `heroku ps:scale worker=1`.
3. `heroku config:set BACKGROUND_JOBS=worker`.

**Do not set `BACKGROUND_JOBS=worker` before a worker dyno is running.** With
neither process running the loops, nothing refreshes KeepTradeCut, the league
corpus, projections or stat lines — and nothing fails, so the only symptom is
data that quietly stops moving. Run **at least one** worker.

Give each dyno its own share of `DATABASE_POOL_MAX` when you split: the ceiling
that matters belongs to the database *role*, not to any one process.

#### What is untouched

**Advisory locking stays load-bearing**: every loop takes its own lock, so a
second worker started by accident — or a web dyno somebody left the jobs on —
costs a skipped tick rather than a doubled scrape of Sleeper or KTC. Switching a
loop off is a scheduling decision; the lock is the correctness one, and neither
substitutes for the other. Nothing here changes any loop's cadence.

The worker shuts down on `SIGTERM`/`SIGINT`: it stops every loop it started (in
reverse order), releases its keep-alive and closes the connection pool, then
lets the process exit on its own. A startup failure it can't recover from — no
`DATABASE_URL`, a failed migration, a scheduler that throws on start — exits
non-zero rather than leaving a dyno the platform reports as healthy and that is
doing no work. A worker configured to run *no* jobs warns loudly and stays up,
since that state is reached by somebody's explicit instruction and crash-looping
the dyno would add nothing.

`node-pg-migrate` and `pg` are kept as native Node modules via
`serverExternalPackages` in `next.config.ts` — the migration runner loads
migration files through a runtime `import()` the bundler can't statically
resolve. `tsx` is a runtime dependency rather than a dev one for the same kind
of reason: the worker is TypeScript run directly, the way `npm test` and
`scripts/` already run, and a platform that prunes dev dependencies after the
build would otherwise leave `npm run worker` with nothing to run it.

## Status

**Manager** is the implemented tool: search a Sleeper username to browse that
manager's leagues, filter by type and format, and expand any league for
standings and full rosters.

**Pick Tracker** and **Trades** are built too — the first follows a draft that
uses kickers as rookie-pick placeholders, the second reads every crawled
league's trades.

**Lineup Checker** is started: it lists the leagues of the account resolved on
`/tools` with this week's opponent in each, over four stat columns that are
reserved and blank until there is something to grade a lineup with. The
opponent comes from `GET /api/user/[username]/matchups`, a cache-backed read of
the matchups the league crawler has stored, for the week
`getUpcomingWeek` derives from stored game dates.

A tool still on the grid and not built points its page at the shared
`ToolPlaceholder`, which reads the title and blurb from
[`tools.ts`](src/features/shared/tools.ts) so there is one description per tool.
To build one, add a `src/features/<tool>/` folder and point its page at that
instead.
