# The Lab

Fantasy football tools for Sleeper leagues. A [Next.js](https://nextjs.org) app
whose only runtime dependencies are React, Next and `pg` — the Sleeper client,
the HTTP retry ladder, the season resolver and the league-graph sync are all in
`src/shared/`.

## Running it

```bash
npm install
createdb thelab                       # see Database below
npm run dev     # http://localhost:3000, which redirects to /tools
```

Requires **Node 22, at 22.6 or later** — declared as `engines.node` in
`package.json` so a deploy resolves the same thing this is developed and tested
on. The floor is `npm test`, which runs under Node's own test runner with
`--experimental-strip-types`; the ceiling is the major the app is actually built
and run against, and moving it is a deliberate change rather than whatever the
platform installs next. `packageManager` pins npm for the same reason — the
lockfile decides which packages, and that field decides which npm reads it.

## Database

Postgres, for a manager's league graph: leagues, rosters, members, traded picks,
drafts and picks, transactions and matchups. `/manager/[username]` reads it and
syncs it from Sleeper on demand.

```bash
# psql isn't on PATH under Postgres.app; this is where its binaries live.
/Applications/Postgres.app/Contents/Versions/latest/bin/createdb thelab
echo 'DATABASE_URL=postgres://localhost:5432/thelab' > .env
npm run migrate:up      # or just `npm run dev` — it migrates on boot
```

Migrations live in `db/migrations` (node-pg-migrate, plain SQL). `next dev`
applies pending ones through `src/instrumentation.ts` before serving a request,
so the explicit `migrate:up` is only needed to run them without a server. With
no `DATABASE_URL` the app still boots and renders; anything that reads the
database fails until it is set (in production a missing one is fatal instead).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Node's test runner over `src/**/*.test.ts` |
| `npm run check` | Lint, typecheck and tests, in order — the fast one, for while you work |
| `npm run check:full` | A production `next build`, then `check`. What to run before pushing, and the only one of the two that works from a clean checkout. **The build comes first because `tsc` cannot run without it** — Next generates the route types under `.next/types/` that `layout.tsx` and every `[param]` page read, so on a tree with no `.next` the typecheck fails on names it cannot find rather than on anything wrong. `check` still runs afterwards: `tsc` covers `scripts/` and the test files, which the bundler never sees |
| `npm run comps:load-corpus` | Load historical player-seasons for `/comps` (see below) |
| `npm run migrate:up` / `migrate:down` | Apply or roll back one migration |
| `npm run migrate:create <name>` | New SQL migration in `db/migrations` |
| `npm run verify:manager-scope` | The manager scope end to end against a throwaway Postgres (needs `DATABASE_URL` and `ALLOW_DESTRUCTIVE=1`) |
| `npm run verify:crawl-pressure` | The crawler's resource guard end to end against a throwaway Postgres — same two variables. Checks the thing a unit test cannot: that a tick which stands down mid-batch leaves the leagues it never reached unclaimed |
| `npm run ktc:doctor` | Why KeepTradeCut values are missing from the page. Walks the whole chain — the switches, the stored board, the Sleeper players map the ids come from, a live scrape judged by the real validator, and what `getKtcBoards` hands a card — and names the first broken link. **Read-only**, so it is safe against production while the loop is running; add `--offline` where the network cannot reach keeptradecut.com |

If `npm run typecheck` fails on a file under `.next/types/` — or on a
`PageProps`/`LayoutProps` name it says it cannot find — the generated route
validator is missing or stale rather than the code being wrong. Both are a build
artefact: `npm run build` writes them, so a fresh checkout typechecks only after
one. `rm -rf .next && npm run build` is the reset. This is the other half of why
`check:full` exists.

## Deploying

`APP_PROCESS_ROLE` decides which of two jobs a process does. It has three
values, and the `Procfile` reads it in the two lines that matter:

| Role | Serves requests | Runs the background loops |
| --- | --- | --- |
| `all` — **the default, and what an unreadable value reads as** | yes | yes |
| `web` | yes | no |
| `worker` | no (`npm run worker` starts no server) | yes |

The loops are the league crawler, the KeepTradeCut refresh, the Sleeper players
refresh and the comps corpus check. **Migrations run under every role**, because
a process must not serve *or* maintain against a schema it cannot vouch for.

### The initial deployment: one Heroku Basic dyno

```
web.1     APP_PROCESS_ROLE unset  → `all`   (512 MB Basic)
worker    scaled to 0
```

```bash
heroku ps:scale web=1 worker=0
```

One dyno serves requests **and** maintains the database. That is what the
`Procfile`'s web line runs as when no `APP_PROCESS_ROLE` config var is set, and
it is exactly what the app did before the roles existed:

- Next.js serves pages and API routes.
- The league crawler ticks every 60 seconds.
- KTC values refresh every 15 minutes, the players map daily, the comps corpus
  check daily.
- **The crawler yields to the web server.** It reads its own RSS before every
  tick and between every batch and narrows — then stops — as memory rises, on
  the rule that background freshness is opportunistic and user-facing traffic is
  not. Below 300 MB it runs at full width, 300–350 MB halves it, 350–400 MB is
  one league at a time with no discovery, and at 400 MB it admits nothing new
  until RSS falls back to 340. See The crawler yields to the web server in
  CLAUDE.md, and the `CRAWLER_MEMORY_*` variables below.
- **The four loops do not all start at once.** Their first ticks are staggered
  over ninety seconds in dependency order — players, KTC, crawl, comps — so a
  cold boot is not four fan-outs and a 5 MB download landing together on a dyno
  that is also serving its first requests. Their cadences are unchanged; see
  `src/shared/util/boot-stagger.ts`.

### Later: a worker of its own

```
web.1     APP_PROCESS_ROLE=web
worker.1  APP_PROCESS_ROLE=worker  (the Procfile's own line)
```

```bash
heroku config:set APP_PROCESS_ROLE=web
heroku ps:scale web=1 worker=1
```

**Do both in one change.** A web dyno left on `all` beside a running worker is
two processes doing the same maintenance. They stay *correct* — every loop takes
a Postgres advisory lock per tick and stands down when another instance holds it,
which is what already made a second web instance safe — but the point of the
split is to get that work off the dyno serving requests, and a duplicated crawl
gets none of it.

**Nothing about the crawler changes across the split.** The same loop, the same
seasonal TTL, the same advisory lock, the same batch caps and the same RSS guard
ride into the worker process, where the guard bounds that process's own resident
set instead of competing with request handlers. Two things read differently there
and neither is a fault: the bands are sized for a process that is *also* holding
Next's runtime, so on a worker alone they are conservative rather than tight; and
the pool signal stops meaning "interactive traffic is queued" and starts meaning
"this crawler's own batches are". Both only ever narrow the crawl.

**The two `Procfile` lines read the variable differently, and that asymmetry is
the mechanism.** The web line takes it as a shell default
(`APP_PROCESS_ROLE=${APP_PROCESS_ROLE:-all}`), so one `heroku config:set` moves a
deployment between the two shapes with no redeploy. The worker line assigns it
outright, so the same config var — which Heroku applies to *every* dyno — cannot
tell the worker it is a web process.

A boot says which it read: `[jobs] Starting background loops
(APP_PROCESS_ROLE=all)`, or `[jobs] Background loops not started on this process
(APP_PROCESS_ROLE=web)`. A worker with a misspelled role and a web dyno doing
exactly as it was told look identical from outside, so neither is silent.

Nothing here is Heroku-specific beyond the `Procfile`: any host that can run two
commands can set `APP_PROCESS_ROLE` on each, and a host that runs only one gets
`all` by leaving it unset.

## Configuration

`.env` is gitignored, so none of these are in the repo. Only `DATABASE_URL`
matters for anything that reads the database; the rest are optional.

| Variable | Default | What it does |
| --- | --- | --- |
| `DATABASE_URL` | unset | Postgres connection string. A warning in development and **fatal in production** — without it `pg` would pick a database from libpq's own defaults rather than from configuration. |
| `DATABASE_SSL_MODE` | `disable` for localhost, else `verify-full` | `disable`, `verify-full`, or `insecure-require` (TLS without verifying the certificate). Pair `verify-full` against a managed provider with `DATABASE_CA_CERT`. |
| `DATABASE_POOL_MAX` | `10` | Connections one process may hold. |
| `MANAGER_SYNC_LIMIT` | `3` | Manager syncs one process runs at once. It *requests* a bound and cannot raise one — clamped to a third of the pool, because a sync holds an advisory-lock session across its whole Sleeper fan-out. |
| `CRAWLER_MEMORY_GUARD_ENABLED` | on | `false`/`off` restores the league crawler's unguarded behaviour exactly. On, the crawler reads its own RSS before every tick and between every batch and stands down as memory rises — wherever it runs, so under `APP_PROCESS_ROLE=all` it is yielding to the request handlers beside it and on a `worker` it is bounding that process — see The crawler's resource guard in CLAUDE.md. Anything that is not a recognised on/off word leaves it **on** and says so once. |
| `CRAWLER_MEMORY_NORMAL_MB` | `300` (`900` in development) | RSS below which the crawler runs at full width. |
| `CRAWLER_MEMORY_THROTTLE_MB` | `350` (`1050`) | RSS at which it drops to its minimum width and stops discovering new leagues. |
| `CRAWLER_MEMORY_STOP_MB` | `400` (`1200`) | RSS at which it admits no new league work at all. Sized for a 512 MB Heroku Basic dyno; development gets three times the headroom because `next dev` sits past the production numbers doing nothing. |
| `CRAWLER_MEMORY_RESUME_MB` | `340` (`1020`) | RSS a crawler that stood down must fall back below before it works again — the hysteresis that stops it oscillating around the stop threshold. Must be below `CRAWLER_MEMORY_STOP_MB`; a set that is not ordered (`resume < stop`, `normal <= throttle < stop`) is discarded whole for the defaults, with one warning. |
| `CRAWLER_MEMORY_NORMAL_CONCURRENCY` | `CRAWL_CONCURRENCY` (4) | Leagues the crawler syncs at once at full width. **Clamped downward only**: the guard may narrow the crawler and may never widen it, so a value above `CRAWL_CONCURRENCY` is capped at `CRAWL_CONCURRENCY` rather than honoured. |
| `CRAWLER_MEMORY_THROTTLED_CONCURRENCY` | half the above (2) | Width under moderate pressure. Clamped to the normal width. |
| `CRAWLER_MEMORY_HIGH_CONCURRENCY` | `1` | Width under high pressure. Clamped to the throttled width, so `high <= throttled <= normal <= CRAWL_CONCURRENCY` always holds. |
| `CRAWLER_MEMORY_FAKE_RSS_MB` | unset | **Development only** — a fake RSS reading, so the pressure levels can be driven without exhausting a machine's memory. Ignored in production, where the real reading is the only honest one. |
| `NFL_SEASON_OVERRIDE` | unset | Forces the active season. Read fresh on every call, so it takes effect on a running process. Overrides Sleeper's `state/nfl`. |
| `SLEEPER_MAX_CONCURRENCY` | `24` | Ceiling on how many requests one process may have open to Sleeper at once. The knob to reach for on a 429, and the one to lower before touching any per-caller number — it is the only bound that applies to the process rather than to one call site. |
| `APP_PROCESS_ROLE` | `all` | `all`, `web` or `worker` — which job this process does. See Deploying above. An unreadable value reads as `all`, which is the behaviour this app had before the switch existed. |
| `COMPS_CORPUS_LOAD` | on | Set to `off` to stop the app loading the comps corpus on boot. The loop checks daily and loads only the seasons `player_seasons` is missing, so an ordinary boot fetches nothing; turn it off to keep the corpus entirely under `npm run comps:load-corpus`. |
| `COMPS_SAMPLE_CORPUS` | allowed in development, denied in production | `on` or `off`. Whether `/comps` may answer from its built-in sample corpus when `player_seasons` is empty. Production refuses by default so a deployment cannot silently serve twenty-six invented seasons; set `on` for a demo build that wants it deliberately. Anything that is not `on` or `off` falls to the default for the environment. |

## Sleeper request budgets

Every Sleeper read in this process passes through one function, and how long it
may take is a fact about **who is waiting for it** rather than about the
endpoint. Two named policies, in `src/shared/sleeper/request-policy.ts`:

| | Interactive | Background |
| --- | --- | --- |
| What it is | a page, a card being opened, a lookup — somebody is watching a spinner | a crawl tick, a scheduled refresh, a sync whose answer is rows in Postgres |
| Longest queued for a Sleeper slot | 4s, then `AdmissionTimeoutError` | as long as it takes |
| Per attempt | 8s | 30s |
| Retries after the first | 1 | 3 |
| Whole ladder | 12s | unbounded by anything but its own arithmetic |
| Cancellation | only where the caller passes a signal | never |

The interactive numbers are sized against **the platform, not against Sleeper**:
Heroku's router abandons a request at 30 seconds, so one Sleeper read's worst
case is 4 + 12 = 16, which leaves a route its Postgres reads, its solve and its
serialisation inside the deadline. The background numbers are exactly what every
Sleeper request in this process ran under before the split existed, which is the
point — only the half that was wrong moved.

**Nothing declared is the background policy.** A route handler opens an
interactive scope around its body; the durable work a route can *start* —
`syncManagerLeagues`, `refreshLeague`, `extendLeagueHistory` — opens a
background scope inside itself, which replaces that budget **and drops the
reader's signal with it**. That is deliberate and is the one rule to keep: what
those produce is shared state every later reader and the crawler read, not this
request's answer, so a browser navigating away must not be able to abandon a
fan-out mid-write, and a reader's four-second queue budget must not shed leagues
under exactly the crawler pressure the sync is queued behind. The long-lived
SSE rooms (gametime, picktracker) say the same thing for the same reason: a
reader's join is what opens one, and the room outlives them.

There is no environment variable here on purpose. `SLEEPER_MAX_CONCURRENCY`
above is the operational knob — it bounds the *process* — where these two are a
statement about what a request is for, and a deployment that wanted to tune them
would be tuning the wrong thing.

## The comps corpus

`/comps` compares a player against historical player-seasons stored in
`player_seasons`. **The app fills it on boot**, and on an ordinary boot that
costs nothing: the loop reads the corpus's own metadata row and Sleeper's
state, works out which finished seasons are missing, and loads only those — so
the first boot against an empty database loads the default span, the boot after
a season ends loads that one season, and every other boot logs a skip. It runs
unawaited, so a load in flight never delays request serving, and it takes an
advisory lock, so two instances booting together do not fetch the same seasons
twice. `COMPS_CORPUS_LOAD=off` disables it.

Two things the boot loop deliberately will not do. It **never backfills below
the corpus's own earliest season**, so a corpus loaded with `--from 2021` stays
that span instead of being widened back to the default on every boot. And it
**never rewrites the corpus onto a different scoring basis** — it extends
whatever basis the metadata row names, so a corpus loaded on PPR keeps growing
on PPR.

The script is still how a *chosen* span is loaded, and the way to load one
before the app has ever booted:

```bash
npm run comps:load-corpus                     # 2018 → the latest complete season
npm run comps:load-corpus -- --from 2015
npm run comps:load-corpus -- --scoring ppr    # half_ppr (default) | ppr | std
npm run comps:load-corpus -- --positions WR,TE
npm run comps:load-corpus -- --help
```

It reads Sleeper's weekly stats for each season and joins them to the stored
**players map** for age, experience and draft capital, so run the app (or the
players sync) at least once first — a load against an empty map skips every
row and says so. It is safe to rerun: rows are upserted, never duplicated, and
a whole load commits or none of it does. It refuses, by name, any season the
NFL has not finished, and it writes a `comps_corpus_meta` row recording the
source, the scoring basis and which seasons were loaded.

Until a corpus exists — by either route — `/comps` answers from a sample corpus
in development and says "No comps corpus loaded" in production; see
`COMPS_SAMPLE_CORPUS` above.

## Layout

```
src/app/       Routes only — pages and API handlers. No business logic.
src/features/  Client UI, one folder per tool. `features/shared/` holds
               cross-feature pieces.
src/shared/    Domain logic and the API contract, one folder per concern.
               Never UI.
```

`CLAUDE.md` has the rules that are easy to get wrong and the reasoning behind
them — the import direction between `shared/` and `features/`, the barrel
convention, when a `.ts` extension belongs on an import, and why every Sleeper
call goes through one client. Read it before adding to `src/shared/`.
