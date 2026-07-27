@AGENTS.md

# The Lab — working conventions

Fantasy football tools over the Sleeper API and KeepTradeCut, backed by
Postgres. See `README.md` for setup, env vars, and what the app does; this file
is about how to change it.

## Layering

```
src/app/       Routes only — pages and API handlers. No business logic.
src/features/  Client UI, one folder per tool. `features/shared/` holds
               cross-feature pieces (PageShell, Avatar, apiFetch).
src/shared/    Domain logic, one folder per concern.
```

- **`shared/` must never import from `features/`.** The reverse is fine.
- Import from a module's barrel (`@/shared/manager`), not its internals
  (`@/shared/manager/queries`). Add new exports to the barrel.
- A module owns its tables. If you need data from another concern, add a query
  to *that* module and call it — don't write SQL against a table your module
  doesn't own. (`ktc/match` used to query `players` directly; it doesn't now.)
- Aliases: `@/*` → `src/*`, `@thelab/http` → the configured axios instance.

## Anything crossing the network

Response and message shapes go in `shared/manager/contract.ts`, once. Routes
annotate what they send with those types; the client aliases them in
`features/manager/types.ts`. Never redeclare a response shape on the client —
that drift is invisible to the compiler, which is exactly what this prevents.

## Database

Use the helpers in `@/shared/db` rather than hand-rolling:

| Need | Use |
| --- | --- |
| A transaction | `withTransaction(client => …)` — never write `BEGIN`/`COMMIT`/`ROLLBACK` yourself |
| Work that must not run twice | `withAdvisoryLock(LOCK_KEYS.x, …)`, returns `null` if someone else holds it |
| Multi-row insert/upsert | `bulkInsert` — chunks and parameterises |
| Cache freshness gate | `isFresh(table, ttlMs)` / `countRows(table)` |
| JSONB parameter | `jsonb(value)` |

New advisory lock? Add it to the `LOCK_KEYS` table in `shared/db/lock.ts` so
collisions stay visible.

Schema: nested Sleeper payloads (settings, scoring, metadata, id arrays) stay
`JSONB`; promote a column only when it gets queried or joined on. Migrations are
plain SQL in `db/migrations`, applied automatically on boot.

## Background loops

Use `startBackgroundLoop` from `@/shared/util` — don't hand-roll `setInterval`.
It handles the Node-runtime guard, the `globalThis` double-start guard (dev/HMR
stacks timers otherwise), non-overlapping ticks, `unref`, and never letting a
throwing tick kill the loop.

Anything that scrapes or syncs should also take an advisory lock, so extra
instances sharing one database don't multiply load on Sleeper or KTC.

## Testing

`npm test` runs Node's built-in runner over `src/**/*.test.ts`. No framework, no
build step — Node 22 strips the TypeScript.

Two constraints follow from that, and they shape where logic should live:

1. **Test files import with an explicit `.ts` extension** (`./parse.ts`).
2. **A module under test must have no runtime imports it can't resolve** — so a
   tested module uses `import type` only for cross-module dependencies (those
   are erased), and does no network or database work.

That is why `ktc/parse` and `ktc/match` are pure and take their inputs as
arguments. Keep new logic that's worth testing on the same side of that line:
thin I/O wrappers, pure logic underneath.

## Style

- Comments explain **why**, not what. Match the surrounding density — this
  codebase documents non-obvious decisions (rate budgets, Sleeper quirks,
  ordering constraints) and skips the obvious.
- Tailwind: use the `foreground` token for text/borders/surfaces and `active`
  for the accent. Both are registered in `@theme` in `globals.css`. Do **not**
  use `white` — it was the old convention and has been fully migrated.
- Wrap page content in `<PageShell>` rather than repeating the container
  classes.
- The expanded league panel uses container queries (`@lg:`), not viewport
  breakpoints, because it renders at half width inside a card.

## External API gotchas

- **Sleeper answers 200 with a `null` body** for "no such thing" (unknown user,
  deleted league) rather than 404. `sleeperGet` normalises this to a fallback —
  use it rather than calling axios directly.
- **Sleeper's players map is ~5MB** and they ask for at most one fetch per day.
  It's cached in `players`; go through `@/shared/players`.
- **KTC serves bot clients a page with no data**, so requests need browser
  headers. Player pages are 3–6MB, which is why the history backfill does a
  handful per tick.
- Transactions are keyed by week with no all-at-once endpoint; a league's full
  history is the union of each week.
