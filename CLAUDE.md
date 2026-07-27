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
- **A cache-backed route reads and nothing else.** `/api/projections`,
  `/api/league/[leagueId]` and `/api/adp` answer from what the background syncs
  have stored; a slice that hasn't been synced comes back empty rather than
  fetched on demand. (The `/api/user/[username]` routes are the deliberate
  exception — resolving a manager and syncing their leagues is what they are
  *for*, which is why the leagues one streams progress.) Where a read needs to
  know what week it is, derive it from stored data too: `projections/queries`
  takes the weeks still ahead from `game_date` rather than `state/nfl`, so it can
  only ever name weeks that are actually here to read.
- A route that needs several independent reads should `Promise.all` them, and
  decide per read whether a failure is fatal. `/api/league/[leagueId]` catches
  its projections read and sends `outlook: null` — the rosters are the point of
  that route and the lineups are a bonus on top.
- Aliases: `@/*` → `src/*`, `@thelab/http` → the configured axios instance.

## Anything crossing the network

Response and message shapes go in `shared/manager/contract.ts`, once. Routes
annotate what they send with those types; the client aliases them in
`features/manager/types.ts`. Never redeclare a response shape on the client —
that drift is invisible to the compiler, which is exactly what this prevents.

That file holds **every** route's payloads, not just the league ones — `/api/adp`
and `/api/projections` are both there. Adding a second contract file per module
is the drift this rule exists to stop; import the filter type it needs instead.

## Database

Use the helpers in `@/shared/db` rather than hand-rolling:

| Need | Use |
| --- | --- |
| A transaction | `withTransaction(client => …)` — never write `BEGIN`/`COMMIT`/`ROLLBACK` yourself |
| Work that must not run twice | `withAdvisoryLock(LOCK_KEYS.x, …)`, returns `null` if someone else holds it |
| Multi-row insert/upsert | `bulkInsert` — chunks and parameterises |
| Cache freshness gate (whole table) | `isFresh(table, ttlMs)` / `countRows(table)` |
| JSONB parameter | `jsonb(value)` |

New advisory lock? Add it to the `LOCK_KEYS` table in `shared/db/lock.ts` so
collisions stay visible.

`isFresh` judges a **whole table** by its newest `updated_at`, so it only fits a
cache that is replaced all at once (`players`, `ktc_values`). A table holding
independently-refreshed slices needs its own gate, or writing any slice marks
every slice fresh — `projections` is per `(season, week)`, so its sync selects
the stale weeks with a `NOT EXISTS … updated_at > now() - $ttl` query instead.

Refreshing a slice that can shrink means **upsert then delete what's missing, in
one transaction** — an upsert alone leaves rows that quietly look current
(`shared/projections/sync`). Guard the delete on a non-empty fetch, so an
upstream hiccup returning nothing can't empty the slice.

`NUMERIC` columns come back from `pg` as **strings**, not numbers. Cast in the
query (`pts_ppr::float8`) rather than converting in TypeScript, so a value is a
number by the time it leaves the query layer.

Schema: nested Sleeper payloads (settings, scoring, metadata, id arrays) stay
`JSONB`; promote a column only when it gets queried or joined on. Migrations are
plain SQL in `db/migrations`, applied automatically on boot.

Filtering *on* those blobs takes two habits:

- **Regex-guard a numeric cast before making it.** Sleeper omits its defaults
  and doesn't promise types, so a bare `(settings->>'type')::int` fails the
  whole query on the one league holding a junk value. Write
  `CASE WHEN settings->>'type' ~ '^[0-9]+$' THEN (settings->>'type')::int ELSE 0
  END`, and let the fallback match what the client already assumes (a missing
  `type` is redraft — see `features/manager/filters`).
- **Parenthesise a SQL fragment you intend to reuse.** Call sites append their
  own comparison, so a fragment ending in `= 1` makes `${FRAG} = $1` a chained
  `=`, which Postgres rejects. `shared/manager/adp` builds its `WHERE` this way.

Build a dynamic `WHERE` by pushing onto a params array and binding the index it
returns (`` `$${params.push(value)}` ``) — the validated enum decides *which*
fragments exist, and every value still arrives as a bound parameter.

## Background loops

Use `startBackgroundLoop` from `@/shared/util` — don't hand-roll `setInterval`.
It handles the Node-runtime guard, the `globalThis` double-start guard (dev/HMR
stacks timers otherwise), non-overlapping ticks, `unref`, and never letting a
throwing tick kill the loop.

Anything that scrapes or syncs should also take an advisory lock, so extra
instances sharing one database don't multiply load on Sleeper or KTC. Take it
around the freshness check too, not just the fetch — otherwise every instance
decides for itself that a refresh is due and they queue up to do it in turn.

Two cadences, and the choice matters:

- **Interval equal to the TTL, forcing on scheduled ticks** (`ktc`) — for a
  single cache refreshed as a whole, where jitter would otherwise skip a cycle.
- **Interval a fraction of the TTL, never forcing** (`projections`) — where the
  gate is per-slice and a tick that finds nothing due costs one query. Forcing
  here would re-download megabytes of unchanged data on every tick, all
  offseason.

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

`manager/adp-filters` is the same shape for a route: it validates the query
string and nothing else, so the SQL beside it only ever sees checked values.
It takes the default season as an argument rather than importing
`DEFAULT_SEASON` — that import is exactly what would make it untestable.

`projections/filters` follows it, and duplicates its small `list`/`integer`
helpers rather than importing them. That is deliberate: importing across modules
would pull a barrel — and the database code behind it — into a file whose whole
value is having no runtime imports. Copy the twenty lines.

Validation earns its keep when a value reaches SQL as anything but a bound
parameter. `scoring` picks the column `projections/queries` interpolates into
`ORDER BY`, so it is a closed enum that fails the request on an unknown value —
never a silent fallback to a default.

A feature that spans several of those pure modules gets one thin file that does
the I/O and composes them, and no logic of its own: `projections/outlook` reads
the weeks and the players cache, then hands off to `aggregate` → `score` →
`optimal`. The composition is what stays untested, and it is small enough that
that costs nothing.

Test the property the code rests on, not just its outputs. The rest-of-season
totals are only correct because scoring is linear, so `aggregate.test` asserts
`score(w1) + score(w2) === score(w1 + w2)` against real stat lines — if that ever
stops holding, a comment saying it does would not have caught it.

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
- **Projections live on a different host and aren't documented or versioned.**
  `api.sleeper.com/projections/nfl/<season>/<week>`, not `api.sleeper.app/v1` —
  and the v1 host answers that path with 200 and an object of empty objects, so a
  wrong base looks like working code with no data. Build the URL with
  `sleeperDataUrl`, not `sleeperUrl`.
- **A weekly projections response is ~9,400 entries and only ~800 are real.** The
  rest are placeholders for players with no game that week: `game_id` null and
  nothing in `stats` but ADP keys. Store them and every one reads as "projected
  zero" — `projections/parse` is the filter, and it belongs on anything reading
  this endpoint. Omitting `position[]` returns every position in one request, so
  a week is one 5.6MB fetch rather than nine.
- **`state/nfl` reports week 0 all offseason** while projections for week 1 are
  already published. Gating on `week` alone means syncing nothing until
  September; `display_week` is the one to follow (see `projections/weeks`).
- **A projection's `pts_ppr` is not any league's PPR.** It is scored at 0.05 a
  passing yard, where Sleeper's own league default is 0.04 — worth ~2.3 points a
  quarterback, before house rules. Only 14 of the 120 leagues stored here land
  within 0.15 of it. Score the stat line against the league's `scoring_settings`
  with `projections/score`; the two sides share a key vocabulary, so it is a dot
  product. Reserve `pts_ppr` for a generic, league-less board.
- **That dot product is linear, so aggregate the stat lines, not the points.**
  `score(w1) + score(w2)` is exactly `score(w1 + w2)`, and summing first is one
  dot product per player instead of one per player-week, rounding once instead
  of once a week (`projections/aggregate`). It is also the only way to tell a bye
  from a zero: a summed total needs the *count of weeks that contributed*
  alongside it, or a player Sleeper hasn't projected is indistinguishable from
  one projected to score nothing. Carry that distinction all the way to the
  screen — an em dash, not `0.00`.
- **The projections window is two weeks, not a season.** The sync keeps the
  current week and the next warm, so anything called "rest of season" is however
  many weeks happen to be stored. Send the horizon with the number
  (`outlook.weeks`) and show it wherever the number surfaces, the same way
  `/api/adp` has to say which drafts it averaged.
- **`unprojectedScoring` is non-empty for nearly every league**, because they
  nearly all weight defence and special-teams events Sleeper doesn't project. It
  only *means* anything where those players start, so gate any warning on the
  league having a DEF/IDP slot. A caveat that fires on all 120 leagues is noise,
  and noise is how the one league it matters for gets ignored.
- **There is no ADP endpoint** — `/api/adp` averages the `draft_picks` we have
  crawled, so it describes the leagues in this database, not the market. Say so
  wherever the number surfaces, and expose filters that narrow the population:
  pooling a 4-round dynasty rookie draft with a 25-round startup averages two
  different games.
- **A draft's `pick_no` is not always a draft position.** In auction drafts it
  is nomination order, which is why `/api/adp` excludes them by default.
- **Lineup slots overlap without nesting.** `WRRB_FLEX` takes RB/WR and
  `REC_FLEX` takes WR/TE, and leagues here use both, so filling slots one at a
  time — even most-constrained first — picks the wrong lineup. `projections/optimal`
  goes player-by-player in points order instead, which is optimal because a
  player's points don't depend on the slot they fill.
- **Eligibility is `fantasy_positions`, not `position`.** A back listed
  `["RB","WR"]` can fill a `REC_FLEX` his primary position bars him from, and
  Sleeper's own lineups use it — the IDP leagues here start players at DL whose
  `position` reads LB. `getFantasyPositions` is the query; a player the cache
  doesn't know is eligible for nothing, which is better than guessing and
  recommending a lineup Sleeper would reject. Exclude IR and taxi from the
  candidates for the same reason.
- **An optimal lineup that is arbitrary about interchangeable slots reads as a
  mistake.** The matching is free to seat the worse of two backs at RB1, or a
  15-point back in FLEX with a 14-point back at RB — same total, but as advice it
  looks wrong and diffs against a sane current lineup as pointless moves. So the
  answer is canonicalised: better player to the stricter slot, and among equally
  strict slots to the earlier one.
