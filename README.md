# The Lab

Fantasy football tools for Sleeper leagues. A [Next.js](https://nextjs.org) app
with no runtime dependency outside React and Next — the Sleeper client, the HTTP
retry ladder and the season resolver are all in `src/shared/`.

## Running it

```bash
npm install
npm run dev     # http://localhost:3000, which redirects to /tools
```

Requires **Node ≥ 22.6** — `npm test` runs under Node's own test runner with
`--experimental-strip-types`, which is where that floor comes from.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Node's test runner over `src/**/*.test.ts` |
| `npm run check` | All three of the above, in order |

If `npm run typecheck` fails on a file under `.next/types/`, the generated route
validator is stale rather than the code being wrong — `rm -rf .next` and run it
again.

## Configuration

Both variables are optional and neither has a `.env` file in the repo.

| Variable | Default | What it does |
| --- | --- | --- |
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
