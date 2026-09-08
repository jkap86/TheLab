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

Requires **Node ≥ 22.6** — `npm test` runs under Node's own test runner with
`--experimental-strip-types`, which is where that floor comes from.

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
| `npm run check` | All three of the above, in order |
| `npm run comps:load-corpus` | Load historical player-seasons for `/comps` (see below) |
| `npm run migrate:up` / `migrate:down` | Apply or roll back one migration |
| `npm run migrate:create <name>` | New SQL migration in `db/migrations` |
| `npm run verify:manager-scope` | The manager scope end to end against a throwaway Postgres (needs `DATABASE_URL` and `ALLOW_DESTRUCTIVE=1`) |
| `npm run verify:crawl-pressure` | The crawler's resource guard end to end against a throwaway Postgres — same two variables. Checks the thing a unit test cannot: that a tick which stands down mid-batch leaves the leagues it never reached unclaimed |

If `npm run typecheck` fails on a file under `.next/types/`, the generated route
validator is stale rather than the code being wrong — `rm -rf .next` and run it
again.

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
| `CRAWLER_MEMORY_NORMAL_CONCURRENCY` | `CRAWL_CONCURRENCY` (4) | Leagues the crawler syncs at once at full width. Clamped downward only. |
| `CRAWLER_MEMORY_THROTTLED_CONCURRENCY` | half the above (2) | Width under moderate pressure. |
| `CRAWLER_MEMORY_HIGH_CONCURRENCY` | `1` | Width under high pressure. |
| `CRAWLER_MEMORY_FAKE_RSS_MB` | unset | **Development only** — a fake RSS reading, so the pressure levels can be driven without exhausting a machine's memory. Ignored in production, where the real reading is the only honest one. |
| `NFL_SEASON_OVERRIDE` | unset | Forces the active season. Read fresh on every call, so it takes effect on a running process. Overrides Sleeper's `state/nfl`. |
| `SLEEPER_MAX_CONCURRENCY` | `24` | Ceiling on how many requests one process may have open to Sleeper at once. The knob to reach for on a 429, and the one to lower before touching any per-caller number — it is the only bound that applies to the process rather than to one call site. |
| `COMPS_CORPUS_LOAD` | on | Set to `off` to stop the app loading the comps corpus on boot. The loop checks daily and loads only the seasons `player_seasons` is missing, so an ordinary boot fetches nothing; turn it off to keep the corpus entirely under `npm run comps:load-corpus`. |
| `COMPS_SAMPLE_CORPUS` | allowed in development, denied in production | `on` or `off`. Whether `/comps` may answer from its built-in sample corpus when `player_seasons` is empty. Production refuses by default so a deployment cannot silently serve twenty-six invented seasons; set `on` for a demo build that wants it deliberately. Anything that is not `on` or `off` falls to the default for the environment. |

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
