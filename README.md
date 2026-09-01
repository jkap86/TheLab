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
| `npm run migrate:up` / `migrate:down` | Apply or roll back one migration |
| `npm run migrate:create <name>` | New SQL migration in `db/migrations` |

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
| `NFL_SEASON_OVERRIDE` | unset | Forces the active season. Read fresh on every call, so it takes effect on a running process. Overrides Sleeper's `state/nfl`. |
| `SLEEPER_MAX_CONCURRENCY` | `24` | Ceiling on how many requests one process may have open to Sleeper at once. The knob to reach for on a 429, and the one to lower before touching any per-caller number — it is the only bound that applies to the process rather than to one call site. |

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
