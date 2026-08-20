@AGENTS.md

# The Lab — working conventions

Fantasy football tools over the Sleeper API and KeepTradeCut, backed by
Postgres. See `README.md` for setup, env vars, and what the app does; this file
is about how to change it.

**This file is the rules. The reasoning is in `docs/`** —
`docs/architecture-notes.md` for the data layer and `docs/design-notes.md` for
UI and component decisions. Every rule here was learned from a specific failure,
and the notes record which one; read the relevant entry before reversing a rule
or redesigning a part, because most of what looks like an obvious simplification
here has already been tried. When you learn something new, put the rule here and
the argument there.

## Layering

```
src/app/       Routes only — pages and API handlers. No business logic.
src/features/  Client UI, one folder per tool. `features/shared/` holds
               cross-feature pieces (PageShell, Avatar, apiFetch).
src/shared/    Domain logic, one folder per concern.
```

- **`shared/` must never import from `features/`.** The reverse is fine.
- Import from a module's barrel (`@/shared/manager`), not its internals. Add new
  exports to the barrel.
- **One exception: client code may deep-import a designated pure module.** A
  `"use client"` file can't *value*-import a barrel that re-exports `pg`-backed
  code — the bundler would drag the database into the browser — so runtime values
  shared with the client live in modules with zero runtime imports, imported
  directly (`@/shared/projections/slots`). Type-only imports are erased and don't
  need this. Pure→pure value imports are relative with an explicit `.ts`
  extension (`optimal.ts` → `./slots.ts`), or Node's test runner can't resolve
  them.
- **The lineup-slot vocabulary lives in `projections/slots.ts`, once.**
  `DEFENSIVE_SLOTS` is *derived* from `SLOT_POSITIONS` rather than listed, so a
  new IDP slot gates the "projections read low" caveat the moment the solver
  learns it. **Two derived sets, and they are not interchangeable** — `IDP_SLOTS`
  is `DEFENSIVE_SLOTS` without `DEF`, because nearly every league starts a team
  defence (so that set barely distinguishes leagues) while starting a linebacker
  makes it a different game. Filters narrow on the narrow set; the projections
  caveat wants the wide one. Adding a third derivation is cheap and correct.
- **A module owns its tables.** Need data from another concern? Add a query to
  *that* module and call it — don't write SQL against a table your module
  doesn't own.
- **A cache-backed route reads and nothing else.** It answers from what the
  background syncs have stored; an unsynced slice comes back empty rather than
  fetched on demand. The exceptions are `/api/user/[username]`, `…/leagues`,
  `/api/picktracker/[leagueId]` and `POST /api/league/[leagueId]/sync`. **The
  prefix is not what makes a route an exception — being *the thing that resolves
  or follows* is.** Every other route under `/api/user/[username]` and
  `/api/league/[leagueId]` reads what a sync wrote, so a manager it has never run
  for gets an empty answer rather than a second sync of their own. A route
  belongs under the user prefix when a username is the *question*, not when a
  page that happens to know one is what reads it.
- `/api/kickoff` is neither cache-backed nor a resolver: it reads Sleeper's
  schedule through an in-memory read-through cache (`shared/schedule`). **The
  cache stamps the *attempt***, so a season answering null waits out its own TTL
  rather than refetching per request; a failed fetch stores nothing and serves
  stale.
- **Where a read needs to know what week it is, derive it from stored data.**
  `projections/queries` takes the weeks still ahead from `game_date` rather than
  `state/nfl`, so it can only name weeks that are actually there to read.
- **A route needing several independent reads should `Promise.all` them, and
  decide per read whether a failure is fatal.** `/api/league/[leagueId]/values`
  catches each lens and sends an empty map — the rosters are the point of that
  panel and the prices are a bonus.
- **A read that is only a bonus should also be asked whether it belongs on that
  response at all.** Split when a read is both slow *and* optional, keyed apart
  on the client so one board change re-fetches prices alone; a fast optional read
  is a field. **The question is per read, not per `Promise.all`** — dependent
  reads earn the same judgement, and the second one failing is not automatically
  fatal just because it had to wait for the first.
- **Two consumers of one read take a snapshot, not a cache.**
  `readWeekProjectionInputs` is the shape: `getLeagueWeekView` wanted the week's
  projections for its per-player column and `getWeekLineups` wanted the identical
  rows for the lineups, so one request read the heaviest table on the panel
  twice. Four rules. It **holds reads and never derivations** — the scoring is
  per league and the lock set is per request, so both are computed *from* it and
  a second league can answer off one fetch. It is **passed down explicitly**
  (`getWeekLineups`' optional `inputs`), because a snapshot that outlived the
  request would be a per-league cache with no key that could say whose week it
  held, and the callee still reads one of its own when handed none — the lineup
  checker passes nothing. The reads it gathers **run in the same `Promise.all` as
  the request's other independent ones**, and what follows is arithmetic, so
  sharing does not turn two parallel reads into two waits. And **what it does not
  need, it does not fetch**: the player metadata is the lineup solve's alone, so a
  league with no slots or scoring on file stays at the one query it always cost.
- Aliases: `@/*` → `src/*`, `@thelab/http` → the configured axios instance.

## Anything crossing the network

Response and message shapes go in `shared/contract`, once. Routes annotate what
they send with those types; the client aliases them in
`features/manager/types.ts`. **Never redeclare a response shape on the client** —
that drift is invisible to the compiler, which is exactly what this prevents.

That module holds **every** route's payloads, not just the league ones. Adding a
second contract file per module is the drift this rule exists to stop. Types
only: everything it pulls from the domain modules comes in with `import type`,
which is what lets client code import it without dragging `pg` into the bundle.

- **Route *policy* stays out of the upstream clients.** `resolveManagerUser` maps
  a searched username to the HTTP status the routes answer with (blank → 400,
  unknown → 404, unreachable → 502) and lives in `shared/manager/resolve.ts`; the
  Sleeper client only knows that Sleeper answers 200-with-null for an unknown
  user.
- **The HTTP half lives one layer out**, in
  `app/api/user/[username]/manager-request.ts`. `resolveManagerRequest` is the
  ten lines every route under that prefix opened with:

  ```ts
  const resolved = await resolveManagerRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { userId, season } = resolved;
  ```

  It sits in `src/app` because the only thing it adds is the `NextResponse`, and
  domain code has no business constructing responses. A non-route file in the app
  directory is fine — only `route.ts`/`page.tsx` are special.
- **Eight routes resolve a manager; only two may ask Sleeper who it is.**
  `resolveManagerRequest` fetches the profile, for `/api/user/[username]` and
  `…/leagues`. The rest read Postgres keyed on a `user_id` and take it back as
  `?user_id=` through `resolveManagerIdRequest`. Four rules hold it up. The hint
  is checked for *shape* (`isSleeperUserId`) and **never trusted as identity** —
  these are public statistical reads, so the worst a forged id buys is a public
  answer about a different public account, and it reaches Postgres as a bound
  parameter regardless. **Without a hint nothing changes**: a bookmark resolves
  the name exactly as before, unknown is still 404, blank still 400. **The id is
  not in the query key** — `searched` and the id are one manager. And
  `resolve.ts` **memoises the lookup for a minute** (`memoizeManagerLookup`),
  caching the in-flight promise rather than the settled answer (so simultaneous
  reads collapse), remembering a `null`, and **never remembering a failure** (a
  502 should be retryable at once). The decision half is pure and takes its
  lookup as an argument, which is what lets the request *count* be the assertion.
- It returns `username` **as spelled in the URL**, because Sleeper resolves a
  user id as readily as a name and that is the string worth logging. It parses
  `season` for all of them including the base route that ignores it; routes
  wanting more of the query string get `searchParams` itself.

## The server's own read caches

Postgres protects Sleeper and KTC; TanStack Query protects Postgres from one
browser. **The third cache protects the dyno from its own readers** — the case
where one expensive answer is computed for several readers at once. Five of
them: the full ADP board, a manager's ranks (CPU on the web process, so two
readers are two spells of a blocked event loop), a league's core detail, and the
two League Details enrichments computed on top of that detail — its
rest-of-season outlook and its week.

The core detail is not expensive the way the others are; it is there because
**one open makes four requests** — the values, outlook and week routes each need
the same rosters, slots and scoring first, so uncached, splitting one payload
into four would have introduced the tax a split is meant to avoid.

**Caching the read under an enrichment says nothing about the enrichment
itself.** `readLeagueDetail` stops four requests becoming four league reads; the
solve on top of one of them — ~180ms for an outlook, ~450ms for a week — still
ran once per tab, per reader and per revalidation, which is what
`readLeagueOutlook` (`projections/outlook-read`) and `readLeagueWeekView`
(`stats/week-read`) now hold. Both follow the same split as `manager/read-cache`:
policy, key and memoiser in a pure `read-cache.ts` that takes its **loader as an
argument**, so the assertion can be a request *count*; the wiring beside it.

- **The key is the invalidation**, which is why neither has a hook. It spells out
  the slots, the scoring and every roster the answer is computed from — the
  league detail, in other words — so a roster move, a lineup change or a settings
  change is a key nothing has answered yet. `persistLeagueGraph` already forgets
  the detail in the process that served the press, so the panel's refetch resolves
  the new rosters and cannot be handed a solve over the old ones. The invariant:
  **an enrichment entry can never be staler than the detail it was computed
  from.** What a hook would have to be for the week is a *listener* rather than a
  call (`shared/stats` reads `shared/manager`'s tables, so the import runs the
  other way), which is machinery for a guarantee the key already gives.
- **The outlook's TTL is exactly the detail's**, eight minutes, asserted across
  the two files: longer is an outlook outliving the rosters it describes, shorter
  re-solves for rosters this process is still answering from memory. What the
  clock is left bounding is the one input the key does not carry — the
  projections rows, on their sync's hourly tier.
- **The week is the one cache in this app whose window is deliberately *shorter*
  than the browser's**, and that inversion is asserted in
  `cache-layering.test.ts` so nobody straightens it. It is live data: what it
  absorbs is a **burst** — the readers arriving inside one ~450ms computation of
  each other, which is the half that costs no freshness at all, since a caller
  that coalesces asked before the answer existed — rather than a revalidation. Its
  ceiling is a minute, and the boundary that actually ends an entry is **the next
  kickoff**, read off the answer's own `games` map (`weekEntryTtlMs`, through
  `TtlPromiseCache`'s `ttlMsFor`) so the bound and the answer cannot disagree
  about what the schedule said. `lockedPlayers` settles a seat the minute a game
  starts, so an entry held past one names a swap Sleeper would refuse.
- **A non-positive lifetime stores nothing** (`BoundedCache.set`), so a window of
  zero is exactly coalescing and the bound is never spent on an entry no read can
  return.

- **Two of them are invalidated on *write* as well as by time, and it is the same
  write.** `persistLeagueGraph` forgets the league's core detail *and* the ranks
  of every manager holding a roster in it — both *after* its transaction commits,
  since a read starting between an early invalidation and the commit would cache
  exactly the rows the write is replacing. Ranks are read off those rosters, so a
  leagues sync that retires the browser's ranks entry (`leaguesRevision`) and
  then serves a payload computed before it ran is the client doing the right
  thing and being handed the number it was replacing. The ADP boards have no such
  path: no reader can ask for a draft to be crawled.

`TtlPromiseCache` (`shared/util`) is `BoundedCache` plus an **in-flight map**, so
ten callers arriving on a cold key run one computation. Six rules:

- **A rejection is never cached and never lingers**, so one database blip is not
  a TTL-long outage. The compute runs *inside* the promise chain, so a
  synchronous throw rejects rather than escaping past the bookkeeping and wedging
  the key forever.
- **The in-flight entry is retired by identity**, and that check guards the
  *store* as well as the delete — otherwise a `clear()` mid-flight lets the older
  computation write its answer over the newer one's.
- **The key names everything the answer varies on, spelled out rather than
  `JSON.stringify(theObject)`** — property order is not a fact about the values.
  `shared/manager/read-cache.ts` is pure precisely so keys can be tested: a key
  too narrow serves one board under another's filters, one too wide never hits,
  and *neither is an error*.
- **List fields are sorted and deduplicated into the key** (`= ANY(…)` is a set
  comparison), but **ids go in verbatim rather than digested** — a hash trades a
  silent collision for a shorter key, and a collision here is one reader's board
  served to another.
- **A shared answer is frozen** (`deepFreeze`), because every caller inside the
  TTL holds the same object and an in-place sort would edit what every later
  reader gets. The exception is the per-player board, which carries a `Map`:
  `Object.freeze` on one is a guarantee that cannot be kept.
- **Each TTL is *longer* than the browser stale time in front of it**, by half
  again at the very least. The two layers are not symmetrical: a browser entry
  going stale discards nothing, it schedules a *revalidation* — so `staleTime` is
  really "when this app's server is next asked", and this is the layer that
  should answer. Set the other way round (which all three were, while every
  comment claimed this rule) the first revalidation after a client entry goes
  stale is a guaranteed miss, and the cache built to absorb revalidations expires
  just in time to miss every one. A gap of merely more than zero is not enough,
  since nothing lines the two clocks up: a request arriving uniformly inside an
  entry's life finds `(ttl − stale) / ttl` of it left.
  `features/shared/cache-layering.test.ts` asserts the ordering across the seam
  (`shared/` cannot import `features/`, so neither side can assert it alone);
  each side's own test carries its ceiling.
- **Pick the ceiling from what writes underneath, not from one rule for
  everything** — the crawler's fastest tier for a league's detail, the
  projections sync's for ranks, and for an ADP board an average over ~1.5M picks
  that a handful of new drafts cannot move.
- **A longer TTL is only affordable where an explicit action invalidates**, and
  the invalidation is what to add first. `persistLeagueGraph` drops the league's
  core detail *and* the ranks of every manager rostered in it, so the paths a
  reader can press — the panel's sync key, their own leagues sync — are exact in
  the process serving them and the clock answers only for background writes.
- Each process holding its own is *correct* rather than merely acceptable —
  Postgres stays the source of truth. Nothing here wants Redis; it would put a
  network hop on the hot path.

**A cached read that joins several datasets is cached per dataset and gated per
field.** A comps season pool is that season's stat lines and profiles, one entry
every board shares; KTC, KTC history, ADP and the NFL draft each take an entry of
their own per season and are loaded only where the board being run weighs a field
whose catalogue entry `reads` them (`comps/enrichment.ts`, the `Metric.reads`
rule one layer down). Every market field defaults to weight 0, so the *typical*
request was paying for four aggregates per stored season and reading none of
them. Four rules hold it up. The gate reads the **effective** board — defaults
resolved against the subject's position, zero weights already dropped — never the
catalogue, so a field existing is not a dataset being fetched. The **merged**
corpus is deliberately *not* cached: it is a fresh row per player-season per
combination of datasets, and it would hand `withCareerValues`'s single memo slot a
different corpus per board, so the merge runs per request and **after** that pass
(the two commute — career values are arithmetic over games and points). **What a
payload prints is a different question from what a field compares**: the comps
route reads the draft crosswalk for the dozen rows it is about to send, where
`draft_capital` is a dimension over every player-season on file. And the datasets
are grouped by **source** rather than by field — dynasty and redraft ADP are one
name because they come off one query.

**A tool whose fan-out is seasons × datasets needs an admission of its own, and
there is exactly one for every expensive analytical read on the dyno.**
`shared/db/heavy-admission` bounds them at `databaseBudget().fanout` — a share of
the pool, `MANAGER_SYNC_LIMIT`'s own derivation — because neither factor is a
constant and the per-walk bound beside it (`COMPS_SEASON_BUILD_CONCURRENCY`) is
per request rather than per process. **`compsReadAdmission` and
`adpComputeAdmission` are that one object under two names**, because two
independent thirds of the pool are two thirds of the pool: a cold comps board
weighing ADP held three comps reads *and* started three ADP computations, both
caps intact and every other route queueing on `pool.connect()`. Four rules. A slot
wraps **one** `pool.query`-shaped call and nothing else (a loader resolves the ids
it needs *before* admitting, or a full limiter is a queue waiting on itself). A
read that admits for itself is **not** wrapped again — `getDraftAdpForPlayers`
takes this same budget, so wrapping it is one limiter acquired twice, which at the
limit is a deadlock rather than a slow page. That is enforced as well as written
down: `run` carries a **token** for the held slot in an `AsyncLocalStorage`, so a
caller that does nest is passed through on the slot it already holds — a token
rather than a flag because the context is inherited by async resources that
outlive the callback, and a detached descendant reading "already admitted" while
holding nothing is the one way this bypasses the limiter; the token is
deactivated as the slot goes back, so such a descendant queues like anyone else.
And the **total** is what a test asserts — the arrangement this replaced passes
every per-subsystem assertion there is. `DB_HEAVY_READ_LIMIT` configures it;
`COMPS_READ_LIMIT` and `ADP_COMPUTE_LIMIT` are still honoured as aliases,
tightest first — and **all three are a *request*, clamped to the pool less one
ordinary request's fan-out share** (`dbHeavyReadCeiling`, 7 of 10). A knob that
could be set to the whole pool is the failure this budget exists for, reached
through the variable meant to prevent it; junk, zero and negatives still fall
back to the derivation, which is never clamped because it *is* the reserved
share.

**A cache whose keys age at different speeds takes a TTL per key.**
`BoundedCache.set`/`TtlPromiseCache.read` accept one; `getCompsSeasonTtlMs`
chooses it per season, since comps walks the whole archive on every request and
one fifteen-minute clock rebuilt seasons that have not moved in seventeen years —
four times an hour, all at once, on whichever reader arrived first. **The season
it classifies against is peeked, never resolved** (`peekActiveSeason`, never
`getActiveSeason`): a lifetime for a corpus already in Postgres must not be able
to block on Sleeper, so an unknown season takes the live tier — the shortest
clock costs a query, where an archive clock over a season still moving costs a
day of a wrong answer. Live season
fifteen minutes (the floor the browser's stale time needs), last season six hours,
older a day, plus a **deterministic** spread of up to a quarter of the tier keyed
on the *entry* — random jitter makes the test a coin toss, and a season's pool and
its datasets must not expire together. **A day rather than forever**, because
history really is corrected here; `onStatsSeasonWritten` → `forgetCompsSeason`
makes a correction visible at once where the sync and the reader share a process,
and the day is the backstop where they don't. **The announcement goes immediately
after the committed write and *before* the bookkeeping that follows it** — after,
the `persistLeagueGraph` rule; before, because a stamp failing on its own
connection would otherwise leave corrected rows in Postgres and a day-long entry
nothing could tell about them. **A cache bound states its
invariant**: the enrichment cache is `COMPS_MAX_SEASONS × COMPS_ENRICHMENTS.length`,
not a number that happens to fit this year's corpus.

**The ranks read is split at the work, not at the route.** Its expensive half is
the projections; the cheap half comes off rosters it already fetched, and the
record ledge needs the standing whatever the stat columns say. So
`?projections=0` is a parameter on the same request — a route split would make
the cheap half a round trip for everyone who wants both. Two rules make it safe:
**absent reads as *on*** (`booleanFilter`, never `booleanFlag`, whose
absent-is-false is the opposite meaning), and the flag is in **both cache keys**.
`managerDataRequirements` derives it as it derives `ktc` and `adp`.

## The client cache

One `QueryClient`, created in `app/providers/query-provider` and mounted at the
**root layout** (not around the manager subtree — a trip out to another tool and
back would take the cache with it). Nothing is stored on the device.

- **A key is built in `shared/manager-query`, never at the call site.**
  Everything manager-scoped hangs off `manager(searched)`, **lower-cased**
  (Sleeper resolves `Jkap` and `jkap` to one account), and the season is always a
  segment with `"default"` spelled out rather than dropped. The table is in
  `features/shared` because a second tool reads these entries;
  `features/manager/query-keys.ts` re-exports it. **The ADP board is deliberately
  outside that prefix** — it describes every crawled draft, so a manager-wide
  invalidation has no business throwing it away; its key is the query string
  *normalised* to sorted pairs.
- **All readers of the leagues stream ask by *username*, not by `user_id`.** The
  manager tool has only a name (it is the URL segment), so the id is the one
  spelling the three tools could never share. The cost is that a Sleeper rename
  leaves the stored account naming somebody who no longer exists — the same
  exposure every `/manager/<name>` URL already has.
- **Staleness is per query (`query-config`), retention is global**
  (`features/shared/query-client`, 30 minutes). A slice's TTL matches how fast
  that slice moves. They are all shorter than the server's TTLs on purpose: a
  stale client read costs a request the server answers from its cache, where a
  stale server read costs a fetch to somebody else.
- **A refetch follows a revision, never an array identity.** `leaguesRevision` is
  two halves because one alone is wrong: a content digest for what the payload
  carries, plus a **refresh sequence** for what it doesn't — rosters are not on
  that payload, so a sync that persisted a waiver claim changes nothing visible
  while making every dependent read stale.
- **The comparison belongs to the *entry*, not to whoever is reading it.**
  `features/shared/leagues-cache`'s `publishManagerLeagues` reads the cached
  revision, writes the new state, and invalidates dependents when the two differ;
  every reader passes it as the stream's `publish`, so the invalidation happens
  whoever ran the refresh and whether or not anything is mounted to notice. **An
  absent revision on either side is never a change.** **It cannot loop**, because
  `dependentManagerQueryKeys` excludes the leagues entry itself and the board.
  And **there is one mechanism** — no mount-local effect beside it.
- **A stream is published into the cache, not resolved at the end.**
  `fetchManagerLeagues` writes every state it reaches into its own entry and
  *then* resolves with the last, so a refresh doesn't sit on a loading screen. A
  failure with a payload already sent is a `refreshError` **field**; only a
  failure with nothing to show throws.
- **An abort is not one of those failures.** An unmount or a cancelled query
  rejects with an `AbortError`, which written into `refreshError` is a lie shown
  over leagues that synced fine. `isAbortError` splits the branch: with a payload
  in hand the abort costs nothing, with nothing in hand it is rethrown as-is
  (which says *cancelled* rather than failed). The published state still clears
  `refreshing`/`progress`, since no further message is coming; and the bail-out
  cancels the reader, since `cancel` on an errored stream rejects with that same
  error.
- **A read is enabled by what is on screen, and "on screen" means the *columns*.**
  Splitting a payload stops a panel *waiting*; only `enabled` stops it *asking*.
  `leagueDetailNeeds` answers for League Details as `managerDataRequirements`
  does for the leagues list, off the same per-metric `reads` declaration in both
  catalogues — required, so a new metric can't forget, and **declared rather than
  inferred from `group`**, since what a bay is *called* has no business deciding
  whether a request is made. Four rules: **`values` is column-driven and nothing
  else**; **`week` is the panel's subject, not a column** (a week panel always
  asks, a season panel has no week to ask about however its slots are aimed);
  **`outlook` is both** — structural on a season panel, whose starters *are*
  `optimal` and whose standings rank on `weekly_optimal_points`, and column-driven
  on a week panel, where the week payload supplies all of that; and **an open
  columns editor widens it**, because a bay of em-dash previews is a picker that
  can't be read. **Derive the needs above the loaded panel, never inside it** — a
  selection read off `localStorage` needs no fetch, so deriving it under a
  component that renders on the core is how a split becomes a waterfall. A
  disabled query keeps its entry, so a column switched off and on inside the stale
  time costs nothing.

The fetchers and keys are pure modules with relative `.ts` imports, so the
cache's behaviour is tested by driving `QueryObserver`s directly — the assertions
are request *counts*, which is what the work was for.

## Database

Use the helpers in `@/shared/db` rather than hand-rolling:

| Need | Use |
| --- | --- |
| A transaction | `withTransaction(client => …)` — never write `BEGIN`/`COMMIT`/`ROLLBACK` yourself |
| Work that must not run twice | `withAdvisoryLock(LOCK_KEYS.x, …)`, returns `null` if someone else holds it |
| Work whose *result* a caller needs | `withBlockingAdvisoryLock(key, …)` — waits instead of skipping |
| Multi-row insert/upsert | `bulkInsert` — chunks and parameterises |
| Cache freshness gate (whole table) | `isFresh(table, ttlMs)` / `countRows(table)` |
| JSONB parameter | `jsonb(value)` |
| A TTL bound against `now() - $n::interval` | `msInterval(ttlMs)` |

New advisory lock? Add it to the `LOCK_KEYS` table in `shared/db/lock.ts` so
collisions stay visible.

- **Skipping and waiting are different locks.** `withAdvisoryLock` never waits: a
  loser returns `null`, right for background loops where queueing piles ticks up
  instead of shedding them. `withBlockingAdvisoryLock` is right where the caller
  needs the *result* — a manager's league sync, where skipping hands back an
  empty page while the data is being written a connection away. Keep it to
  per-key, short-lived work; a background loop that blocks is the stacking
  problem again.
- **A bounded wait has a third outcome, and it is not "skipped".** Because the
  wait times out (`ADVISORY_LOCK_WAIT_MS`), a blocking caller can return having
  done nothing *while the winner is still writing* — the opposite of the skip
  where the winner finished. `SyncSummary.locked` separates them. **Whatever a
  lock-loser hands back, the thing it must never say is that the data is final.**
- **"How fresh is this" and "how recently did we try" are two columns.**
  `manager_syncs` carries `synced_at` and `attempt_at`;
  `shared/manager/sync-freshness` advances `attempt_at` always and `synced_at`
  only when no league failed. Four rules: **the two TTLs are deliberately
  equal**, so a manager whose leagues keep half-failing never costs more upstream
  traffic than one whose leagues succeed; **one gate function answers both
  askers** (the route before it decides to refresh, the sync again inside the
  lock), because a throttle read correctly in one place and not the other is a
  throttle that isn't there; **a race is never overridden, not even by `force`**;
  and **`SyncSummary.complete` is the only field that licenses `stale: false`** —
  `failed === 0` is not it, since a run that did nothing has no failures to
  report and no claim to make either.
- **A per-key lock is computed, not listed** — `managerSyncLockKey(userId)`
  hashes the id into the object slot under one class id. **There are two such
  classes** (`HASHED_LOCK_CLASSES`): `leagueSyncLockKey` hashes ids from the same
  alphabet, so one class would let a manager's sync and an unrelated league's
  refresh take turns on a meaningless collision. A third grain wants a third
  class, not a longer key. Both helpers **drop the connection when *unlock*
  fails** rather than returning it to the pool — a session lock outlives
  `release()`.
- **`isFresh` judges a whole table** by its newest `updated_at`, so it only fits
  a cache replaced all at once (`players`, `ktc_values`). A table holding
  independently-refreshed slices needs its own gate, or writing any slice marks
  every slice fresh.
- **Judge that gate by whether the fetch happened, not by whether it left rows.**
  A week Sleeper hasn't published stores *no* rows, so a gate reading the data
  reads as never-synced and refetches every tick forever.
  `projection_week_syncs` stamps `(season, week)` on a **successful** fetch
  whether or not it returned anything; a *failed* fetch stamps nothing and
  retries. **When "nothing came back" is a legitimate answer, freshness is a fact
  about the sync and belongs in its own table.**
- **Staying eager and holding the head of the queue are the same fact, so a
  capped pass orders on the *attempt*.** Not stamping is what keeps a failed or
  refused week retryable — and an unstamped week sorts first in an
  ascending-by-week queue on every tick thereafter, so two of them are the whole
  of `HORIZON_WEEKS_PER_TICK` and the rest of the season is never *attempted*.
  `projection_week_syncs.attempt_at` is stamped **before** the fetch and read
  **only** by the ordering (`projections/horizon-queue`, pure and tested);
  `synced_at` is stamped only on success and is still the only thing the TTL
  reads. Untried outranks tried, then longest-since-tried, then week number — so
  a cold horizon still walks in week order and the change is invisible until
  something fails. **Any tier with a per-tick cap wants this**; the crawler's
  `sync_attempt_at` tiebreaker is the same rule, and `stats`' settled/archive cap
  is the next place to apply it.
- The same trap's second instance: a league Sleeper has deleted answers
  200-with-null forever, so its `updated_at` never advances and it occupies a
  slot in every refresh rotation. `leagues.gone_at` marks it and the crawler
  skips it; **the row and its drafts stay**, because they still feed ADP, and a
  manager-driven sync that finds the league alive clears the marker.
- **Refreshing a slice that can shrink means upsert then delete what's missing,
  in one transaction** — an upsert alone leaves rows that quietly look current.
  **Guard the delete on a non-empty fetch.**
- **Which slices earn that guard is decided by whether one can legitimately be
  empty.** Users and rosters can never be empty for a live league, so `[]` there
  is a failed request wearing a successful answer (`sleeperGet` folds Sleeper's
  200-with-null into the fallback without throwing). An emptied `rosters` drops
  the league out of every member's list. Traded picks, transactions and matchups
  *do* empty legitimately, so guarding those would leave rows that look current.
  The guard is free when the answer is honest. A refusal is logged.
- **A cascading delete is a destructive write in a table you did not name.**
  `DELETE FROM drafts` cascades to `draft_picks`, so an empty drafts fetch used
  to take the league's ADP corpus with it. Drafts are **upserted**; picks are
  replaced per draft that actually returned some, which stops one draft's failed
  fetch from emptying another's.
- **`NUMERIC` columns come back from `pg` as strings.** Cast in the query
  (`pts_ppr::float8`) rather than converting in TypeScript.
- **`ON CONFLICT DO UPDATE` does not deduplicate a multi-row INSERT.** Postgres
  refuses the whole command when one statement carries the same key twice, so the
  clause covers `bulkInsert`'s chunk boundaries and nothing inside a chunk.
  Deduplicate in code first (`dedupeBy`) — a duplicate otherwise costs the
  league's entire sync transaction and repeats on every retry. Composite keys are
  joined with `:`, safe only because no part can carry the separator; a key with
  a free-text part wants a different join. **A conflict clause is still worth
  having where the delete cannot cover the insert** (`transactions` is replaced
  by week and keyed by `transaction_id` alone).
- Schema: nested Sleeper payloads (settings, scoring, metadata, id arrays) stay
  `JSONB`; promote a column only when it gets queried or joined on. Migrations
  are plain SQL in `db/migrations`, applied automatically on boot.
- **A paged read is keyset, and the index is what makes it one.**
  `transactions_trade_keyset_idx` is partial on
  `type = 'trade' AND status = 'complete'` and ordered on
  `(coalesce(status_updated, created, 0) DESC, transaction_id DESC)` — **both
  keys descending** so a `LIMIT` is a fast-start ordered walk with no sort, and
  **the tiebreaker present** so the order is *total* and therefore resumable
  (without it a page boundary inside a group sharing a timestamp drops and
  duplicates rows across the seam). Read one row past the limit and drop it, so
  "is there another page" costs no second query.
- **The older `transactions_trade_recency_idx` is not redundant and must not be
  dropped without a change beside it**: it is ordered on the *two*-argument
  `coalesce`, which is a different expression to the planner from the keyset
  index's three-argument one, and it is what the date window is written on. The
  board never needs it (its `ORDER BY` pins it to the keyset walk), but the
  counting and facet aggregates have no `ORDER BY` at all, so a windowed board's
  denominators can take it as an index range instead of a filter over the season.
  `sql.test.ts` pins each expression to the migration that indexes it.
- **Write the population as correlated `EXISTS` subqueries, not joins.** With a
  join tree above it the planner cannot satisfy the `ORDER BY` from the keyset
  index and collects the whole population to top-N heapsort it — the same cost on
  page 40 as on page 1. Measured at 23.2ms/518 buffers as joins against
  0.33ms/21 as `EXISTS` for one page.
- **A predicate over ids is written from the joined table inwards so it stays
  decorrelatable.** `FROM rosters WHERE league_id = t.league_id AND owner_id =
  ANY(…)` lets the planner hash-join the whole population; unnesting an array
  column makes the subquery a function of `t` so it cannot be pulled up — 205ms
  against 9ms over 150k transactions, and only the first is flat with depth.
- **An unbounded count is precomputed, never counted per request**
  (`trade_market_stats`, refreshed on the crawler's own tick — the loop that
  writes the rows it counts, so no second timer). Narrowed counts can't be stored
  (the space is unbounded), so they run once per filter set on a first page only,
  and two of them are **one pass**: the scope population is a superset by
  construction, so count the wider one and read the narrower off an aggregate
  `FILTER` over the same scan. Its freshness gate stamps the *attempt*, the
  `projection_week_syncs` rule — a season with no trades counts zero, and a gate
  reading the count itself would recount every tick forever.
- **No Postgres cursor is held while anything is enriched.** Interleaving cursor
  reads with id lookups leaves a pooled connection idle-in-transaction across
  every one of them, which at a handful of concurrent readers is the pool. Finish
  and release the `LIMIT`-bounded query before resolving a single name.

Filtering *on* those blobs takes four habits:

- **Regex-guard a numeric cast before making it.** Sleeper omits its defaults and
  doesn't promise types, so a bare `(settings->>'type')::int` fails the whole
  query on one league holding a junk value. Write
  `CASE WHEN settings->>'type' ~ '^[0-9]+$' THEN (settings->>'type')::int ELSE 0
  END`, and let the fallback match what the client already assumes.
- **Parenthesise a SQL fragment you intend to reuse.** Call sites append their
  own comparison, so a fragment ending in `= 1` makes `${FRAG} = $1` a chained
  `=`, which Postgres rejects.
- **A CTE whose column is one of those fragments must be `AS MATERIALIZED`.**
  Postgres 12+ inlines a CTE referenced once, which pushes a JSONB extraction
  plus a regex plus a cast into every `FILTER` of every aggregate above it. The
  tell is that the cost is invisible in the SQL and only shows up in a plan. A
  subquery in `FROM` is not affected; it is the single-reference CTE that
  inlines. The covering indexes beside it are a *consequence* of that fix, not an
  independent one — on their own they make the board **slower**, and neither half
  should be reverted without the other.
- **The planner needs *statistics* on such a fragment, or it estimates the same
  number of rows whatever you asked for.** Postgres keeps none for an expression,
  so `SCORING_SQL = ANY(...)` fell to its default guess and every board came out
  at 9 rows against 1,400–3,800 actual. `CREATE STATISTICS`
  (`leagues_scoring_bucket_stats`) is the fix. Four things hold it up: it is the
  scoring expression **alone**, measured rather than minimal (and `SUPERFLEX_SQL`
  could not be added anyway — `CREATE STATISTICS` rejects a sublink, `0A000`);
  **the expression in the migration has to stay textually the one in `adp.ts`**,
  since the planner matches by comparing parsed expression trees — change the
  buckets or the regex and this silently stops applying, with no error and no
  warning; **the migration runs `ANALYZE`**, because creating a statistics object
  collects nothing; and **it is not a substitute for `AS MATERIALIZED`**.
- **A plan that is wrong for one shape is not wrong for all of them, so measure
  every shape before reaching for a switch.** Forcing a hash join fixed one bad
  board and made the other three worse. The nested loop is right whenever the
  estimate is; what was broken was the estimate. **Reach for better statistics
  before a different plan preference.**

Build a dynamic `WHERE` by pushing onto a params array and binding the index it
returns (`` `$${params.push(value)}` ``) — the validated enum decides *which*
fragments exist, and every value still arrives as a bound parameter.

## Domain rules

Facts about what a number *means*. Each is invisible to the compiler and silent
when broken — the symptom is a plausible wrong answer, not an error.

- **The leagues route lists the leagues you *fielded a team in*, not every
  membership Sleeper reports.** `getManagerLeagues` narrows the `league_users`
  join by `FIELDED_A_TEAM_SQL`: a roster owned now, or — **in a chopped league
  only** — a place in the draft when it happened. Membership alone is not
  evidence of a team (Sleeper leaves you in `league_users` after you stop holding
  one), and every page downstream counts over this list.
  **A vanished roster means opposite things in the two formats, which is why the
  draft half is gated.** In a chopped league (`CHOPPED_LEAGUE_SQL`, Sleeper's
  native guillotine) being knocked out is that game's ending, not an exit;
  everywhere else it means you walked away, and an ungated draft half keeps those
  leagues forever on the strength of a draft you attended once. Within a chopped
  league both draft signals are read, because neither covers the other —
  `draft_order` is null until an order is set, and `picked_by` is an empty string
  on an autopick. **Every read answering "this manager's leagues" applies it**,
  not just the route, or a league missing from the list is still ranked and
  priced and one narrowed read sits beside an unnarrowed one.
- **Sleeper's league order is preserved in its own table.** The order
  `/user/:id/leagues/nfl/:season` answers in is the one ordering carrying any of
  the manager's own arrangement. It is a fact about a *manager's enumeration*,
  not about a league, so it can't ride on `leagues` or `league_users` — both are
  replaced wholesale by any sync of that league, including the crawler's.
  `manager_league_order` is written by `syncManagerLeagues` over **every** league
  Sleeper listed, *before* the graphs are fetched, so a league whose graph fails
  keeps its place; the wipe is guarded on a non-empty response, since Sleeper's
  200-with-null arrives as `[]` and would silently re-sort the page. Read with
  `position NULLS LAST, name`.
- **A player share is out of the leagues that hold a roster of yours, not the
  leagues listed.** They are different numbers, because Sleeper keeps you in
  `league_users` after you stop holding a team, so counting membership deflates
  every share. `playerShares` counts only leagues that contributed a roster — and
  an empty roster (pre-draft) still counts, since holding nobody is a real
  answer.
- **A leaguemate is shared by membership, though a player share is counted by
  roster — the opposite choices on purpose.** `leaguemateShares` counts
  co-membership over the filtered leagues, and its denominator is leagues that
  contributed a member list. The ghost `league_users` rows that
  would deflate a player share are exactly who that page is for. The manager's
  own row is *kept* in `members` (its presence is what separates "shared with
  nobody" from "not cached") and dropped by the counting, which takes the self id
  as an argument.
- **A league where every total is zero gets *no* rank** (`projectedRank`): before
  a draft, "1st of 12" dresses an empty league up as a lead. Ties share the
  better rank.
- **A KTC roster's starting value is summed by walking the *roster* and asking
  whether each player starts, never by walking the lineup** (`rosterKtcValue`),
  so a lineup naming someone the roster doesn't hold can't hand back a negative
  bench. `bench` is `total − starters`, so the three always reconcile.
- **The expanded standings sort is stable over the standings order the server
  sends** (`orderByProjectedPoints`), so ties, unprojected teams and a league
  with no outlook degrade to the standings rather than to a shuffle.
- **A league's ADP pool is floored at one pick** (`leagueAdpPool` off
  `total_rosters` and `roster_positions`): a pool of zero rounds every player but
  the 1.01 to nothing, which is a card of zeroes rather than a visible shortfall.
  `startingSlotCount` reuses the slot vocabulary, so a new flex counts the moment
  the solver learns it.
- **A team's owned picks are the whole grid with traded rows overriding**
  (`ownedDraftPicks`), tagged with the roster they originally belonged to so the
  client can mark acquired ones without a per-pick field on the wire.
- **A dynasty league's pick seasons are a fixed horizon, not whatever has been
  traded** (`dynastyPickGrid`). Sleeper carries the next three drafts and rolls
  them forward when a rookie class is taken, so deriving seasons from
  `traded_picks` gets the roll-over wrong in *both* directions. Three readings
  hold it up, each the same "absent is not evidence" rule: **the startup is not
  this year's rookie draft** (an inaugural league runs both under one season
  label, so `STARTUP_DRAFT_SQL`'s rule — earliest draft, only where
  `previous_league_id` is null/`''`/`'0'` — decides which is which); **only
  `complete` counts as taken**, and a season with no stored draft keeps the
  nearer year; and **the depth is the last rookie draft's**, since Sleeper
  publishes no round count for a draft that doesn't exist yet — a league offering
  no bound shows nothing rather than inventing rounds.
- **A draft's slots are read through `draft_order`, and the season's draft is
  chosen before its order is looked at** (`getDraftSlots`). `draft_order` is
  user → slot, joined back through `rosters.owner_id`, so a roster whose owner
  has left resolves to nothing rather than to a guessed slot. **An auction is
  excluded outright** — its `pick_no` is nomination order, so its `draft_order`
  is not a pick order. The choose-then-check ordering is the subtle half: picking
  the latest draft *and then* finding it unordered has to report nothing, where
  filtering unordered drafts out first falls through to the startup and hands
  back that draft's slots for a pick in this one.
- **Ordering a rookie pick and pricing it are two questions off two boards**
  (`rookieLadder`). *Which rookie a pick takes* is a fact about **rookie
  drafts**; *what that rookie is worth* is a fact about **startup drafts**, where
  the class is priced against the whole pool. A rookie-draft ADP of 1 and a
  startup ADP of 1 are not one number in two spellings. **Presentation state must
  not reach a valuation** — the boards are the reader's own population with the
  round bounds fixed, so every other control still propagates. The two are
  asymmetric about a missing player: one the *ordering* board never averaged is
  not a rung (a place invented for him shifts every pick below by one), while one
  the *pricing* board never averaged **keeps** his rung and is interpolated in
  rank space — dropping him renumbers everyone under him.
- **Naming the rookie class reads `players.years_exp`, and absent is "not known
  to be a rookie", never "veteran"** — it is null for a team defence and for
  anyone Sleeper hasn't filled in, and one wrongly-included name shifts the whole
  ladder. **The cache carries no history, so this always names the class that is
  a rookie *now***: a board for a past season gets an empty ladder, which reads
  as unpriced picks rather than a ladder built from prices those players never
  had. That is a **known limitation, and the obvious fix is not one** —
  `activeSeason − years_exp` is wrong for anyone whose count didn't advance, and
  a wrong *inclusion* shifts every rung below it. Doing it properly wants a
  persisted `rookie_season`.
- **Trades made before a league's startup draft ended are not on the trades
  board.** A startup fills empty rosters from the whole pool, so everything
  traded up to its last pick is draft position changing hands. The bound is the
  league's *first* draft's `last_picked`, for a league with no
  `previous_league_id`, and **only where that draft says `complete`** — on a
  running draft `last_picked` is the running edge, so the comparison would keep
  essentially every in-draft trade. An unfinished startup drops the league's
  trades outright. **A null `last_picked` excludes nothing**, and a status
  Sleeper didn't send reads as finished, since hiding a whole league on a missing
  field is the louder failure. It is done in the read rather than on the client
  so the board's `total` counts the same population the rows come from.

## Background loops

Use `startBackgroundLoop` from `@/shared/util` — don't hand-roll `setInterval`.
It handles the Node-runtime guard, the `globalThis` double-start guard (dev/HMR
stacks timers otherwise), non-overlapping ticks, `unref`, and never letting a
throwing tick kill the loop.

Anything that scrapes or syncs should also take an advisory lock. **Take it
around the freshness check too, not just the fetch** — otherwise every instance
decides for itself that a refresh is due and they queue up to do it in turn.

**Every loop has a switch, and there is one switch over all of them**
(`shared/util/background-jobs`). `BACKGROUND_JOBS=off` disables the lot and the
five per-job variables keep the names they had. Four things about it:

- **The switch is scheduling; the lock is correctness, and neither substitutes
  for the other.** Removing either because the other exists is the mistake to
  watch for.
- **The master switch is checked first**, so a job added later is off on a web
  process without a second edit.
- **Only the exact word `off` disables anything.** A typo that stopped the syncs
  would leave the database quietly unfilled for hours with nothing failing.
- **`BACKGROUND_JOBS` is read by two gates and they answer different
  questions.** `backgroundJobSwitch` answers "should this job run at all";
  `shared/jobs/mode` answers "should this *process* be the one running them",
  which is where the third value `worker` lives.

**There is a real worker, and one registration list feeding both entry points.**
`src/worker.ts` (`npm run worker`) applies migrations, starts every loop and
holds itself open with no HTTP listener; `src/instrumentation.ts` does the same
for the web server. Both go through `startBackgroundJobs` in `shared/jobs`, and
that list is **derived from `BACKGROUND_JOB_VARS`** rather than written twice —
two copies drift, and the way they drift is a job added to one entry point and
not the other, which is a sync that silently stops the day the recommended
deployment is adopted. Six rules:

- **The role is passed in, never read from the environment.** Platform config
  vars are per *app*, not per dyno, so `BACKGROUND_JOBS=worker` reaches both
  processes and each one knows for itself which it is. That is why `worker` does
  not switch the worker off — one variable, one setting, and no second variable
  needed to put the jobs back.
- **The default did not move.** Unset still runs every loop in every process, so
  an existing deployment upgrades to what it had; a production web process on
  that default logs one line recommending the split. Flipping it would stop
  every refresh on any app that deployed without scaling a worker, and that
  failure is the silent one — the same argument as "only the exact word `off`".
  The Procfile and the README carry the ordering: **scale a worker before
  setting the variable**, and run at least one.
- **An absent `NEXT_RUNTIME` is Node** (`isNodeRuntime`). The old guard read as
  "Node only" and meant "*Next's* Node only", so the one process that exists to
  run these loops would have started none of them and said nothing.
- **A startup failure exits non-zero; a configuration that runs no jobs does
  not.** The first is a dyno reported as healthy doing no work; the second is
  somebody's explicit instruction, and crash-looping it adds nothing.
- **The loops are stopped before the pool is closed** on `SIGTERM`/`SIGINT`. The
  other order is a tick mid-query losing its connection, which is a stack trace
  describing a clean shutdown.
- **The worker holds a ref'd keep-alive of its own**, because every loop
  `unref`s its interval — right for a server held open by its socket, exactly
  wrong for a process with no socket. `startBackgroundLoop` returns a handle so
  a shutdown has something to stop; the handle's `stop` releases the guard key,
  or a clean shutdown makes the loop unstartable for the life of the process.

The crawler most wants that separation: its advisory lock spans the whole sync,
network included, so it holds a pool connection across a league's entire Sleeper
fan-out. That is deliberate and cannot be shortened (released before the fetch,
two instances both decide a refresh is due), which leaves *where the loop runs*
as the only lever.

Two cadences, and the choice matters:

- **Interval equal to the TTL, forcing on scheduled ticks** (`ktc`) — for a
  single cache refreshed as a whole, where jitter would otherwise skip a cycle.
- **Interval a fraction of the TTL, never forcing** (`projections`) — where the
  gate is per-slice and a tick that finds nothing due costs one query. Forcing
  here would re-download megabytes of unchanged data on every tick, all
  offseason.

**A slice's TTL should match how fast *that slice* moves, not the table's.** The
projections sync runs two: this week and next at an hour because an injury
designation changes them, the rest of the season at a day because it doesn't.
Where the slow tier is also large, cap how many slices a tick will fetch
(`HORIZON_WEEKS_PER_TICK`) and **report what the cap deferred** — a skipped slice
that reads as "fresh" is how a backfill silently stops advancing.

The league crawler varies on time instead of slice: `manager/crawl-ttl` picks one
TTL per tick from live NFL state — 15 minutes in-season, an hour through the
75-day window before kickoff, six hours in the deep offseason. **Only
`"regular"` is matched by name**, since Sleeper labels most of the offseason
`"off"`; the window before `season_start_date` decides the rest, and a missing or
unparseable date **fails toward the *fresh* tier** — extra fetches are the
failure you can see. **A TTL is a capacity claim, not just a freshness one**: the
batch retires 15 leagues a minute, so 15 minutes is honorable to 225 leagues and
past that silently stops being a promise. That is why the scheduler warns when
the stalest league is past twice the active TTL, heartbeats when idle, and why
`CRAWL_LEAGUE_BATCH` moves on that telemetry — the tick interval is execution
granularity, not the freshness period.

**Once the corpus outgrows that claim, *which* league goes first matters —
`manager/crawl-priority` is the ordering, not a bigger batch.** Leagues already
due are ordered by five tiers (starved, demanded, live, known, cold); nothing
else about the crawl changes. Four things are load-bearing. **The starvation tier
is what makes the rest safe** — past four TTLs overdue a league outranks
everything, because pure demand-first fails silently: the leagues that stop being
crawled are exactly the ones nobody is looking at. **Demand is observed, never
inferred** — `leagues.last_accessed_at` is stamped by a manager's league sync and
a league detail read, and deliberately *not* by the crawler, or within one
rotation every league would look demanded. **The tiebreaker stays
`sync_attempt_at`**, so a league whose fetch keeps failing rotates to the back of
its own tier. And **the `CASE` is generated from the same table the pure
comparator reads**, since a five-armed ordering written twice is two orderings.

## Operating safety

- **A route that spends someone else's budget is an operator route.**
  `/api/players/sync` and `/api/projections/sync` are POST-only and require
  `INTERNAL_SYNC_SECRET` in the `x-internal-sync-secret` header; the decision is
  pure and tested in `shared/internal-auth/policy.ts`, the `NextResponse` half is
  `app/api/internal-auth.ts`. Three details are load-bearing. **Unconfigured is
  503 in production**, never a pass and never a 403 — failing open leaves the
  endpoints as exposed as they were, and a 403 makes a missing variable
  indistinguishable from a wrong secret at 3am. **GET is 405**, because a request
  that pulls tens of megabytes off Sleeper is a state change whatever method it
  wears. And **a lost advisory lock is 409**, not a 200 describing someone else's
  run. The public manager routes stay public; what `…/leagues` stops honouring
  from an anonymous caller is `?refresh=1` — the knob, not the read.
- **Judge a destructive reconciliation by whether the payload is a payload.**
  Both syncs replace-and-delete, and `length > 0` is a guard every interesting
  failure passes: a 17-player KTC "board" nulls the other 480. So `ktc/validate`
  and `projections/validate` run **before the transaction opens**, and a refusal
  **writes nothing and stamps nothing** — no `updated_at`, no
  `projection_week_syncs` row — so the next tick tries again. Each carries an
  absolute floor, a maximum shrink against what is stored, and a duplicate rule;
  each treats **zero stored as a first sync**, where only the floor applies. The
  numbers are named constants with the reasoning on them, because a threshold
  without a rationale is one someone will tune to zero.
- **A manager is stamped only once every league discovered for them is in.**
  Stamping suppresses that manager for the enumeration TTL, so stamping alongside
  a failed league loses the league until some *other* member of it comes up.
  `syncLeagueGraphs` reports `loadedIds`/`failedIds` rather than counts, and the
  stamp is an **intersection against ids** — counts can't answer this, because
  two managers can share an unknown league. `remainingDue` counts tombstoned
  leagues as leaving the queue too, or the backlog is overstated.
- **That rule needs a bound, because an unstamped manager sorts to the *front* of
  `pendingManagers`** — so a league that fails its first sync every time held its
  managers at the head of the queue forever and the corpus stopped growing.
  `partitionSyncFailures` re-asks for the league itself before deciding. **The
  probe is a second signal, not a re-read of the first** — a first sync fetches
  half a dozen child collections, so its error cannot tell a deleted league from
  a hiccup, and only the league endpoint can. A null answer tombstones it through
  `persistGoneLeagues`; `getLeague` folds 404 into Sleeper's usual 200-with-null,
  since the two spellings mean one thing.
- **The write is the fix, and the tombstone was only half of it.** *Any* first
  sync that fails every time wedges the queue, so a league Sleeper still serves
  is written down too — `persistUnsyncedLeagues`, a bare row with no children —
  and the hold is released by the league being **recorded** rather than by its
  syncing. `unrecordedFailures` is what is left blocking. Four things hold it up:
  - **Discovery finds leagues; the refresh pass retries them.** A parked row is
    known, so discovery never selects it again; refresh claims in bounded
    batches, stamps `sync_attempt_at` as it claims, and re-probes `getLeague`
    first. Retrying was never discovery's job, and doing it there had no bound.
  - **The row is written before the manager is stamped**, so a write that throws
    takes the tick with it and nothing is suppressed. This is why
    `unrecordedFailures` takes the ids actually written and never the ids
    intended.
  - **An ambiguous probe parks instead of staying retryable.** That is safe only
    because parking claims nothing about whether the league exists.
  - **A parked row takes `updated_at`'s default**, so the retry is a freshness
    TTL out rather than the next tick.
- **The season is resolved, not compiled in.** `shared/season` is an override
  (`NFL_SEASON_OVERRIDE`), then Sleeper's `state/nfl` on a six-hour cache, then
  `DEFAULT_SEASON` as the floor. Three rules make it safe: an upstream outage
  falls back to the last resolved value (and a failed attempt does **not**
  re-stamp the cache, so recovery is immediate); a cached value outlives its TTL
  when nothing better exists; and **an explicitly requested season never comes
  here** — `?season=2024` is the caller's answer and historical routes stay
  deterministic. Call it where a season would otherwise be *defaulted* and
  nowhere else. **A page that reads it must not be prerendered**
  (`force-dynamic`), or the resolution is baked into the bundle and it is a
  hardcoded constant again. **`peekActiveSeason` is the synchronous half**, for a
  caller whose *answer* doesn't depend on the season and whose bookkeeping does
  (a cache choosing a TTL): it is the override else what this process already
  resolved, never a fetch and never the compiled-in fallback, and `undefined`
  means *not known* — which is only usable where the caller has a conservative
  reading of not knowing.
- **That last rule is broken by evaluation order, not by intent, and it takes a
  predicate to keep.** `parseAdpFilters(params, await getActiveSeason())`
  evaluates the argument first, so a historical read waits on a state call whose
  answer the parser discards. The parser's own branch is exported as
  `usesDefaultSeason` and the route gates on it; the argument is `string | null`
  where null means the caller checked. It is **refused rather than defaulted** on
  the path that does read it, because an unbounded board with no season silently
  spans every season on file — the one wrong answer here that looks like a
  working one.
- **A request never waits on Sleeper for a value this process can already
  answer.** A stale cache is served *now* and refreshed behind the request. A
  cold process still waits, bounded by a short failure backoff: a failed attempt
  is remembered for a minute, and only the *cache* stays un-re-stamped.
  The UI's `nfl-calendar` is a *separate* concern: it derives provisional markers
  past its table, bounded by the window being drawn rather than by a clock, so
  server and client renders agree.
- **The one reader-driven write is a single-league refresh, and it takes four
  bounds** (`refreshLeague`). The league must **already be stored** (a refresh
  re-reads the corpus; it is not a way to fetch an arbitrary league id); a
  **per-league advisory lock**, blocking, so a second presser gets the winner's
  answer instead of starting a second fan-out; a **cooldown inside that lock**
  (`LEAGUE_REFRESH_COOLDOWN_MS`, a hammer bound and not a freshness policy — a
  window sized like `SYNC_TTL_MS` would refuse the very press this serves), which
  stamps `sync_attempt_at` **before** the fetch so a failing league holds it too;
  and a **process-wide admission**, because the lock is per league and a hundred
  leagues is a hundred locks that never contend, each holding a pool connection
  across a Sleeper fan-out. A **race is a success, not a refusal** — an attempt
  landing after this caller began queueing means somebody else's fan-out wrote
  what it was waiting for. Every outcome but "not in the corpus" is a 200.
- **Every request that press makes is cache-busted, and nothing else is**
  (`freshUrl`/`cacheBustToken`). Sleeper sits behind a CDN, so a roster read
  seconds after somebody set a lineup can be answered from an edge copy minted
  before they did — and every layer below then behaves perfectly: a 200 with the
  old starters is stored as current, `updated_at` advances, and the reader sees
  what they saw before pressing. **That is the one failure this path cannot tell
  from working**, which is why the token is minted inside `refreshLeague` rather
  than left to a caller. One token for the whole graph (so a press is one group
  in an access log) and a timestamp, so two presses can never re-request a URL
  the edge has already answered. The scheduled callers want the opposite — the
  crawler promises a fifteen-minute TTL, so an edge copy is inside its own error
  bars. **A `Cache-Control: no-cache` request header is deliberately not sent**
  and must not be added later as though it did the same job: the major CDNs
  ignore it from anonymous clients, so it reads as a fix while changing nothing.
  The successful refresh is the one success this app logs, because a refresh that
  fetched stale data and one that never ran look identical from outside.
- **Encrypted is not verified.** `DATABASE_SSL_MODE` is `disable` /
  `verify-full` / `insecure-require`, defaulting to the first for localhost and
  the second everywhere else; `DATABASE_CA_CERT` supplies a provider's chain
  (unescaping `\n`). The old behaviour survives under `insecure-require` — the
  name is the point, since it was previously reached by *default* under an option
  spelled `require`. An unrecognised mode throws. A missing `DATABASE_URL` is
  fatal in production: `instrumentation.ts` throws before starting a single loop,
  because "alive but connected to libpq's defaults" is worse than not booting.
- **Every wait is bounded, and bounded shorter than the deadline the request is
  already under.** `shared/db/budget.ts` holds one platform deadline (30s) and
  four shares of it — connect, lock wait, statement, and how much of the pool one
  request may hold. A route with no `connectionTimeoutMillis` does not fail when
  the pool is full, it *queues*; with no `statement_timeout` the query underneath
  runs to completion holding the connection the next caller is queueing for; and
  the browser, told only that the request failed, asks again. Four things hold
  the fix up:
  - **The shares are ordered connect < lock wait < statement < deadline**, and
    the ordering is load-bearing. `lock_timeout` being the shorter of the two
    bounds is what keeps a caller that lost the lock reported as one (`55P03` →
    `AdvisoryLockTimeoutError`) instead of as a cancelled query.
    `budget.test.ts` asserts the ordering, not just the values.
  - **One pool per process, cached on `globalThis` in production too.** A route
    bundle carrying its own copy of `pool.ts` gets its own `max` and nothing in
    the process can tell. The ceiling that matters belongs to the *role*, not the
    pool — that is what `DATABASE_POOL_MAX` is for.
  - **A fan-out whose width is data is bounded to a share of the pool**
    (`collectWithConcurrency`, `budget.fanout`). `Promise.all(items.map(…))` over
    a list that grows with the account, where each unit holds a connection, is
    one request holding more of the pool than the pool has. A fixed-width fan-out
    over units that are mostly *network* is not this
    (`LEAGUE_FETCH_CONCURRENCY` stays as it is).
  - **A route's *enrichment* stage is that same fan-out wearing a fixed length,
    and takes `loadEnrichments`** (`shared/db/fanout.ts`). `Promise.all([a(),
    b(), c(), …])` over a handful of named, differently-typed reads is the shape
    that reads as harmless because somebody counted them: `/api/adp` released
    the aggregate's admitted connection and then opened five at once against a
    budget of three. Tasks are **named** (the call site stays the destructured
    object) and each **declares what it reads** — `dbRead` counts against
    `databaseBudget().fanout`, `memoryRead` never queues, since serialising work
    that takes no connection is latency for nothing, and the declaration is
    conservative because it cannot be inferred. Three properties are the
    contract: **every task is started**, including after another fails; **a
    rejection gives its slot back** rather than killing the worker; and **the
    first rejection chronologically is the one thrown**, since which error
    arrives is what decides 503 against 500.
  - **That bound is a plain concurrency limiter and must never be a second
    admission.** A task may take the process-wide heavy-read slot *inside* the
    route slot (`getDraftAuctionSpend` does), which is safe in that direction
    only: the heavy budget is shared, a route's is private to one request, so no
    holder of a heavy slot ever waits on a route slot. A heavy-read token taken
    at the route would be one limiter acquired twice — a deadlock at the limit.
  - **Two reads against one row are one read.** `/api/adp` resolved a page's
    names and then re-asked `players`, on the same ids through the same index,
    which of them had `years_exp = 0`; one column on the first read answers both
    (`getPlayersWithExperience`) and the classification is pure
    (`rookieClassIds`). Consolidate where the second read is the *same lookup*.
    The two KTC reads beside it are deliberately left apart — an id lookup and a
    `position = 'RDP'` filter over rows carrying no `sleeper_id` are different
    populations, not one query asked twice.
  - **Out of budget is a 503, not a 500** (`isDatabaseBusy` →
    `app/api/read-failure.ts`). A 500 says stop asking, and asking again is
    exactly right when the database merely had no room. Applied at **every** route
    that catches a read, not just the ones seen to be slow.
  - **A read that is only a bonus still fails as a failure.** Deciding an
    enrichment is non-fatal is a decision about what the *client* does with it,
    never a licence to answer `200 null` — `…/week` and `…/outlook` caught their
    reads and sent one, so a database timeout arrived as a successful answer
    holding nothing: the query client's retry never ran (no failure to retry),
    the empty answer was cached as a good one for the whole stale time, and no
    layer could tell it from a league that genuinely has nothing to project. Go
    through `readResponse` (`app/api/read-response.ts`), which is
    `withReadTiming` + `readFailureResponse` and nothing else. **A null body is
    reserved for the domain saying "nothing"**, and a route whose loader cannot
    return null has no null on the wire at all — `LeagueWeekPayload` is not
    nullable because `getLeagueWeekView` isn't. The graceful half stays where it
    always belonged: the enrichments are separate queries, so only the core's
    error is the panel's error.

## Testing

`npm test` runs Node's built-in runner over `src/**/*.test.ts` through `tsx`.
No framework, no build step — but not bare `node --test` either: Node 22's
TypeScript stripping is behind an experimental flag and is not on across the
22.x range `engines` allows, so that command fails with
`ERR_UNKNOWN_FILE_EXTENSION` before a single test runs.

Two constraints follow, and they shape where logic should live:

1. **Test files import with an explicit `.ts` extension** (`./parse.ts`).
2. **A module under test must have no runtime imports it can't resolve** — so it
   uses `import type` only for cross-module dependencies (those are erased), and
   does no network or database work.

**Keep new logic that's worth testing on the same side of that line: thin I/O
wrappers, pure logic underneath.** `shared/manager/adp-filters` is that shape for
a route — it validates the query string and nothing else, and takes the default
season as an *argument* rather than importing `DEFAULT_SEASON`, since that import
is exactly what would make it untestable.

**A *query count* is the one claim that side of the line cannot make**, because
it is a fact about the composition file rather than about any module under it.
`shared/stats/league-week.test.ts` is the exception and stays a narrow one: it
drives the real loaders with `pool.query` and `@thelab/http`'s instance replaced
by counting stubs, so nothing connects and what comes back is a fixture. Two
things make it safe — the alias resolves under `tsx` and `new Pool(…)` does not
connect, so importing the I/O module costs nothing; and the stub **dispatches on
the table named in the SQL** rather than on call order, so a read moving between
callers cannot quietly re-label itself. The rules those reads feed are still
asserted where they are pure (`projections/week-inputs.test.ts`); this file
asserts only the counts and the handful of numbers proving the shared snapshot
reaches the solve intact. **Reading the same table twice in one request is not an
error** — it answers, it typechecks, it passes every other test in the repo —
which is why it takes a test of its own.

**Three files carry an ADP name and they sit on opposite sides of the wire:**

| File | Side | Job |
| --- | --- | --- |
| `shared/manager/adp-filters.ts` | server | validates `/api/adp`'s query string, and the league ids off a POST body |
| `features/shared/adp-controls.ts` | client, pure | *builds* that request, resolves the date range, seeds the league rules from a league |
| `features/shared/ui/adp-drawer.tsx` | client, UI | the drawer that drives the controls |

**The two ends are a matched pair with no compiler link between them** — the
client writes the vocabulary the server parses, so a value added on one side and
not the other fails as an ignored parameter rather than a type error.

- **The board's league filters are evaluated on the client and cross as their
  answer.** They are a predicate engine over Sleeper's blobs and cannot be
  re-implemented in SQL without drifting silently, so the browser evaluates them
  and sends `league_id`/`xleague_id`. The server's `scoring` and `superflex`
  parameters survive because `adpBoardFor` still matches them *per league*.
- The `list`/`integer`/`enumList` primitives both filter modules use live once,
  in `shared/query`, imported relatively with a `.ts` extension. **`booleanFlag`
  and `booleanFilter` are two named functions on purpose** — absence means "off"
  for a flag like `?stats=1` and "don't filter" for a population filter like
  `?best_ball=`, and one function serving both meanings is the bug the split
  names.
- **A date primitive earns its place twice over.** `isIsoDate` does not stop at
  the `YYYY-MM-DD` shape, because `2026-02-31` passes a regex *and* parses — V8
  rolls it forward to March 3 — so it formats the parsed date back and compares.
  And `isoDate` returns **the string it was given, not a timestamp**: what a bare
  date means is a zone question, and the caller that knows the zone is SQL.
  Converting to epoch ms in the parser bakes this process's timezone into every
  answer. An absent bound is `null`, since an open end has to be expressible.
- **There are two "today"s, and they answer to different people.** `TODAY_ET` is
  server-side and Eastern because it decides what the NFL has already played — a
  fact about the schedule, not the reader. `todayIso` is client-side and *local*,
  because it anchors what a reader means by "last 30 days". The seam holds
  because the client sends resolved `YYYY-MM-DD` bounds rather than a relative
  phrase. **Reach for one because of whose day you are naming.**
- **`manager/record` re-encodes the same two rules rather than inventing any**,
  which is the sign they are house rules. *The denominator is what contributed,
  not what was listed* — `aggregateRecord` counts leagues carrying a `record`,
  because Sleeper keeps a manager in `league_users` after they stop holding a
  team, and a population-derived number travels **with** its population. *Zero
  and absent are different answers* — `pct` is null before a game is played,
  never `0`, since preseason every record is `0-0-0` and `.000` there is a claim
  about a season that hasn't happened. **A new module of this kind should be
  checked against both before it is written.**
- **`shared/trades/sql` is the one whose regressions are silent** — a mistake
  there is not an error but *the wrong rows*. Being a string builder is what
  makes it feel untestable and exactly why it needs testing; the tests are
  **properties rather than snapshots**: every caller value bound and none
  spliced, every `$n` resolving to a value actually pushed, `all` and `any`
  differing in all three categories, the window never joining the alternatives.
  Two reach past the module: `TRADE_SORT_SQL` is checked against the migration
  that indexes that expression (breaking it turns an index walk into a
  season-wide sort while still answering), and the probe for the `OR` join is
  written over the two categories that emit no `OR` of their own. Two more pin
  invisible agreements: the managers filter and the `traders` circle are asserted
  to be *one* fragment, and `tradeScopeSql` + `tradeNarrowingSql` are asserted to
  concatenate to `tradeFilterSql`, since halves that are not exactly the whole
  leave a count describing rows the list doesn't show.
- **Three decisions live in the trades pair rather than in the components.** *A
  side is what was received, never both halves* — what a roster gave up is
  exactly what the other sides received, and sides come from `roster_ids` rather
  than from the assets, so a roster that only gave things up still appears. *The
  filters ask what moved, not who ended up with it* — a filter that only answers
  when you already know the answer is the trap. *`all` and `any` are both real
  questions*, so the selection carries one mode over the whole of it, and **the
  date is not one of the alternatives**: it always narrows, because it is a bound
  rather than a selection.
- **The league filters' rule lists are AND-only, and that difference from the
  trades selection is deliberate.** A trade selection is a set of *subjects*,
  where `any` reads as naturally as `all`; a league rule narrows on an
  *attribute*, and the question people arrive with is "dynasty leagues that start
  two QBs" — every rule narrowing. **The AND is load-bearing rather than merely
  sufficient**: a size *band* is two rules on one key, which is only a band
  because they narrow together.
- **Validation earns its keep when a value reaches SQL as anything but a bound
  parameter.** `scoring` picks the column interpolated into `ORDER BY`, so it is
  a closed enum that fails the request on an unknown value — never a silent
  fallback to a default.
- **A feature spanning several pure modules gets one thin file that does the I/O
  and composes them, and no logic of its own.** That composition file is what
  stays untested. **Police that bar, because logic drifts into it a line at a
  time** — the rule that a player unprojected for a week is *omitted* from that
  week's candidates (not passed as a zero) once lived inline where nothing tested
  it. If a loop in the composition file starts making a decision, that decision
  wants a pure module.
- **A second and third entry point is how that drift arrives at scale.**
  `projections/candidates` owns `lineupCandidates`, `isProjectable` and
  `rosterPlayerIds`; `optimal` owns `recognisedSlots`. What that buys is not
  lines but that `getWeeklyTeamPoints` can no longer disagree with
  `getLeagueOutlook` about who is allowed to start. `lineupCandidates` takes the
  scorer as a **callback**, since that is the only thing that varied between the
  copies; and `isProjectable` is a **type predicate**, so `filter(isProjectable)`
  narrows and the `scoringSettings!` assertions are gone.
- **`getWeekLineups` solves every team it is handed**, which is why
  `/api/user/[username]/matchups` hands it the two rosters in each game and not
  the league. **One league is handed over whole**: a league playing
  `league_average_match` scores every team against the week's *median*, which no
  pair of rosters can answer — so the narrowing was never "solve two", it was
  **solve exactly the teams this payload speaks for**. A league with the setting
  but nobody in a game this week is still skipped. Three rules follow:
  `medianScore` **averages the two middle scores** on an even population (take
  either middle and a twelve-team league hands out seven wins and five losses in
  perpetuity); a median league is **one league and two games**, so
  `projectedRecord` counts `games` and `leagues` apart and sums through the same
  `projectedOutcomes` the marks are drawn from; and a **bye is still a game**.
- **`getWeekLineups` does not go through `readBatchInputs`, because it makes one
  decision for itself: a played game is kept, not dropped.** The horizon reads
  filter `game_date >= TODAY_ET`, which is the exact wrong reading of a lineup —
  dropped, a Thursday starter scores zero *and* his slot reads empty, so the
  solver seats a Sunday player in it and reports a gap for a swap Sleeper will
  refuse. `game_date` is a `DATE`, so this is not a Sunday-night edge case.
  `listLineupWeekStats` reads the week whole and marks each row `locked`, and
  `compareLineup` holds those slots **and** keeps those players out of the pool
  for every other slot — either half alone still produces an impossible move.
  `lockedPlayers` (pure, tested) folds the week's `start_time`s over the
  day-accurate flag, locking at the minute and **only ever earlier**, so an
  unreadable schedule degrades to the midnight-ET fallback and a postponed game
  stays settled once its original date passes. **An empty lock set is asserted to
  be exactly the unlocked answer**, so the horizon callers are unaffected by
  construction.
- **Test the property the code rests on, not just its outputs.** The
  rest-of-season totals are only correct because scoring is linear, so
  `aggregate.test` asserts `score(w1) + score(w2) === score(w1 + w2)` against
  real stat lines — if that stops holding, a comment saying it does would not
  have caught it.

## Style

The per-part reasoning — how the trade card, the league card, the ADP drawer, the
app bar, the filters dialog and the league detail panel arrived at their shapes,
with the alternatives already tried and rejected — is in
**`docs/design-notes.md`**. Read the entry for a part before redesigning it. What
follows is the rules that outlive any one part.

### Writing and tokens

- Comments explain **why**, not what. Match the surrounding density — this
  codebase documents non-obvious decisions (rate budgets, Sleeper quirks,
  ordering constraints) and skips the obvious.
- Tailwind: `foreground` for text/borders/surfaces, `active` for the accent, both
  registered in `@theme` in `globals.css`. Do **not** use `white`.
- **A gradient may hold literal colour; everything around it takes the token.**
  `@theme` registers exactly two colours, so a multi-stop gradient has no token
  to read. Keep the literals in one table in the component, and spell the one
  that *does* have a token as that token's value.
- Wrap page content in `<PageShell>` rather than repeating the container classes.
- **A loaded font is not a used font.** `app/fonts/index.ts` self-hosts Geist,
  Geist Mono and Orbitron and `@theme` maps all three; they were once downloaded
  and preloaded on every page while `body` named `Arial` outright. The check is a
  grep for the variable, not for the `localFont()` call.
- **Measure a fixed track, don't estimate it** — in a headless Chromium page with
  the real `woff2` files and the compiled stylesheet, reading
  `getBoundingClientRect()`. The two failure modes are invisible in review and
  opposite: a track a hair too narrow clips a total into bad data, one too wide
  comes out of the name, which is the only column with nowhere else to go.
- **The display face comes with a size step down.** Orbitron is wider, so holding
  the size truncates sooner.

### CSS mechanics that bite

- **`hidden` does not beat a `display` utility that sorts after it.** Tailwind v4
  emits them *alphabetically*, so `.block` loses to `.hidden` while
  `.inline-flex`, `.inline` and `.table` win against it. Source order in the
  `class` attribute never enters into it. The general form: **a shared component
  that hard-codes a property a caller has to override is a component no caller
  can override it on** — silent in both the class list and the compiler.
- **An element is never its own query container.** `@container` and `@lg:p-4` on
  one div makes that padding resolve against an ancestor that doesn't exist: it
  silently never applies. Splitting them also keeps the query *stable*, since a
  container whose padding is set by a query on itself changes the box that query
  measures. **Any `@container` element whose own classes carry a `@`-variant is
  this bug.**
- **Use container queries, not viewport breakpoints, for anything rendering at a
  fraction of the page width.** A panel at half a card's width is not a phone.
- **A tier that adds a column takes back more than it gained, so what a part can
  hold is not monotonic in its width.** When moving a breakpoint, sweep the *band
  just above* it.
- **A cell rendered into a track that isn't there doesn't overflow, it *wraps***
  onto an implicit row, where `justify-self-end` lands it in the gutter and
  pushes it off the edge. Shed a column in all three places: the grid template,
  the heading, and the row's own cell.
- **Row and heading share one grid template**, or the header drifts the moment a
  width changes. Write every template out as a whole class string.
- **Neither gutter may be `auto`.** Every row is its own grid container, so an
  intrinsic track is measured per row and two sections' names land at different x.
- **Horizontal chrome is spent twice and comes out of the names**, since boxes
  nest. **Trim the padding, never the gap** — an inset holds content off an edge
  nothing is written on, where a gutter is the only thing separating two columns.
- **A scroll bar is a lane.** Reserve it with trailing **padding**, not
  `scrollbar-gutter: stable` — a gutter is ignored wherever scrollbars *overlay*
  content (iOS, macOS by default), which is the case where the bar covers
  numbers. A heading rail *outside* the box must give up the same width.
- **A heading sharing a track is sized against the track, not its sibling
  headings.** Where something must truncate it should be the field whose content
  varies — a clipped name reads as a long name, a heading clipped inside its own
  word reads as broken.
- **A length threshold cannot express a width.** Names of 17 and 19 characters
  can measure 128px and 118px, so every character count either contracts names
  that had room or clips names that didn't. Contract uniformly and exclude the
  cases where it means nothing (a team defence, a name with no space). A `title`
  is the desktop backstop, not the plan — there is no hover at the width the name
  is short of room.
- **Keyframes live in `globals.css`.** Tailwind v4 has no per-component keyframe
  mechanism; per-element timing stays in the component as data. An SVG shape
  animated with `transform` needs `transform-box: fill-box` or it pivots on the
  SVG root.
- **A decorative animation freezes under `prefers-reduced-motion`, it doesn't
  disappear** — dropping the indicator takes the *status* away from the reader
  who asked for less motion.
- **An exit animation costs a mounted beat, and the unmount is a timer rather
  than `animationend`** — under reduced motion the event never fires, so a
  component closed once stays mounted forever. The exit is `forwards` (or it
  snaps back for a frame) and takes `pointer-events: none`.

### The machined material

`.lab-*` classes in `globals.css` carry the app's grammar: **raised means press
me, recessed means you are here.** Break that pairing and a label invites a press
that does nothing.

- **A `.lab-*` class carries material and never layout**, and lives in
  `@layer components` so a utility beside it wins. A class owning
  `display`/`width` meant a stale stylesheet laid the part out at min-content and
  burst it out of its row; and unlayered, these rules outranked every utility on
  their own elements, so call sites had been writing `group-hover:` into a void.
- **A key sizes itself off its face, never the reverse** — no part is a
  percentage of a box itself sizing to content. The face is the flex row rather
  than the `<button>`, since a form control is the element engines disagree about
  as a flex container.
- **`clip-path` cuts a `box-shadow` off.** A notched part cannot cast a shadow or
  glow with `box-shadow` at all — use `filter: drop-shadow()`, which applies
  after clipping; a "simplification" back silently deletes every shadow.
  `clip-path` clips the whole subtree, so a part meant to rise out of a clipped
  face must be its **sibling**.
- **Thickness is a stacked layer, not a shadow** — wrapper is the dark side wall,
  child the lit face, the wrapper's padding is how thick the part is. That is
  what makes the press animation free.
- **A shadow doesn't scale**: 2px/5px of inset reads as a slot on a chip and as
  flat paint across a 400px table. **A part seated in another must catch more
  light than what it is seated in**, and **thickness has to fall with count** — a
  dozen chip-thickness parts 4px apart read as mud.
- **A corner-lit gradient is a claim about a box's shape and degenerates off it.**
  The gradient line for an angle over w×h is `|w·sinθ| + |h·cosθ|`, so a fill
  tuned for a card resolves inside the leading fifth of a wide rail. Re-lay it in
  percentages. **Sample the pixels rather than trusting the class.**
- **A range input is styled through per-engine pseudo-elements that cannot share
  a selector.** One unknown pseudo-element voids the whole rule, so both are
  written out even where identical; deduplicating them silently deletes the
  styling in one browser.
- **A dimmed control is drawn flat, not merely dimmed** — a part that does
  nothing when pressed must not look pressable.
- **A dimmed cell on a lit face can't ask for a shade of `foreground`** — on cyan
  that is a shade of the wrong colour. Use plain `opacity-*`.
- **A cut is read against the face it is cut into**, so a slot tuned for a light
  face reads as a raised sliver on a dark one.
- **A `backdrop-filter` is a live composited texture, not a paint.** Drop blurs
  whose backdrop is opaque anyway — the combined GPU texture budget is what
  mobile WebKit discards a page over. Use a Tailwind variant (`sm:blur-3xl`), not
  a `filter: none` override, since a `.lab-*` rule in `@layer components` loses
  to a utility and would silently do nothing.

### Components and state

- **A pure-SVG component is not a client component.** Reach for `"use client"`
  when there's state or a handler, not because a component draws. Use `useId` for
  gradient and clip ids so two instances can't collide.
- **Client-side persistence is one mechanism** (`features/shared/local-store.ts`,
  a `useSyncExternalStore` over `localStorage` per key). Three rules are easy to
  undo by "simplifying" the store away: `getServerSnapshot` returns null and a
  stored value appears only after hydration (reading `localStorage` during render
  is the hydration mismatch this avoids); **the snapshot is the raw string**,
  parsed in a `useMemo` keyed on it, because `useSyncExternalStore` compares by
  identity and a fresh `JSON.parse` per read looks like a change every render and
  loops; and **a write notifies its own listeners by hand**, since `storage`
  fires in *other* tabs but never the one that wrote. Writes are `try`/`catch`ed
  because storage can be blocked — and a blocked write still lands in the
  module-level `memoryFallback`, or a successful lookup is discarded.
- **A stored preference is keyed by the catalogue's *grain***, never by the page
  or the league. `resolveColumns` (pure, tested) reconciles stored against
  catalogue **per slot**, so a renamed metric falls back on its own rather than
  resetting three good choices with it. `assignColumn` **swaps** rather than
  spending a second slot on a metric already on screen. **`reset` is what makes
  the persistence safe to have** — it clears the key rather than writing today's
  defaults into it, since what a table opens with is the catalogue's to change.
- **A default put back by hand is not a customization, on either half of a
  stored preference.** `setPositionWeights` drops the entry when the board equals
  the position's defaults, exactly as `setPositionWindows` already did for its
  half — normalized on the way in as well as out, since a blob written by an
  older build is still in readers' browsers and a board is not customized on the
  strength of which build wrote it. The tell that it is missing: a lit "customize"
  key over an untouched board, and a Reset that does nothing visible.
- **A debounce is per subject, and a change of subject skips it.** Debouncing an
  edit is right — a drag across a slider is one request, and the rows on screen
  still answer the player named above them. It is wrong across a change of
  *subject*, where the state that identifies the subject moves on the press and
  the debounced state lags it: comps boards are per position, so picking a
  quarterback mid-edit built a request pairing the new subject with the previous
  position's weights, and the answer landed in its own cache entry under its own
  key rather than merely flickering. The fix is a **derivation**
  (`comps/board-settle.ts`): what the request is built from is computed during
  render from the settled board *and* the current position, so it cannot be a
  frame behind; the settled state catching up afterwards only moves the baseline
  the next edit is measured against.
- **A list-wide selection is named once above the list, never on every card**, at
  *every* width — a heading rail on a laptop and per-card labels on a phone is
  one list being two products either side of a breakpoint. What legitimately
  changes at a width is geometry, not the control. Cards keep an `sr-only` label,
  since nothing visible says what "#3 of 12" ranks.
- **Which heading was pressed belongs to the rail, not the parts.** The heading
  takes `onOpen(slot)` and holds no state; the dialog reports every way out
  through the `<dialog>`'s own `close` event, so the parent hears one signal
  rather than three. `openSlot` **seeds** the armed slot rather than being it,
  during render — an effect points the panel at the wrong column for a frame.
- **A repeated catalogue key is legitimate**, so ask what the *armed slot* holds
  rather than where a key first appears.
- **A `<dialog>` gives you the top layer, focus trap, Escape and backdrop press
  for free** — don't reimplement one-open-at-a-time, outside-click listeners and
  stacking-order lifts.
- **`onClose` must test its target.** React walks its own tree for `close`, which
  does **not** bubble in the DOM, so a dialog opened *inside* another takes the
  outer one down with it.
- **`showModal()` throws, so never call it bare** (`shared/dialog-open`, pure and
  tested): on a dialog already open non-modally, on one detached between press
  and effect, and by absence on an engine that never shipped it. The call is in
  an effect, where a throw unmounts to the nearest boundary. `openDialog` returns
  an outcome and falls back to the non-modal `open` attribute.
- **Autofocus is a fact about the pointer, asked of the platform**
  (`shared/pointer`, `(pointer: fine)` — never the user agent string): on a
  finger, focusing a text field *is* raising the keyboard over the content.
  **Unknown answers false** — autofocus withheld from a desktop reader costs one
  click, given to a phone it costs the list.
- **A modal that refocuses itself must not depend on its callers' callbacks.** An
  open effect holding `onClose` in its deps re-runs on every keystroke and takes
  focus off whatever is in use. Put the callback in a ref.
- **A combobox has exactly one focusable part, and it is the field.** The
  suggestions are `<li role="option">` named through `aria-activedescendant`
  (`features/shared/combobox.ts` — the keyboard, and *both ends* of the id pair,
  since that reference is a string match with no compiler link behind it). **A
  focusable descendant inside a `role="option"` is the bug to recognise**: it is
  a tab stop per suggestion, and Enter on it fires a `click` where a popup
  listening for `pointerdown` selects nothing at all. Four rules hold the rest
  up. **`aria-expanded` and `aria-controls` follow what is *rendered***, not what
  the reader last intended — a field permanently naming an unmounted listbox is a
  broken relationship rather than a closed one, so "not dismissed" and "has
  something to show" are two facts and only their conjunction is a popup.
  **Selection is a `click` on the option, and the popup swallows the default of
  `mousedown` to make that possible** — without it the field blurs, the list
  unmounts, and the click lands on nothing; acting on `pointerdown` instead is
  what makes a touch drag to scroll select whatever it started on, since the
  compatibility `mousedown` is only synthesised for a real tap. **Tab is the one
  press a combobox must not consume**, and a focus leaving the field is what
  closes the popup — a pointer going down outside closes it too, since a tap on
  inert page furniture does not reliably blur a field on iOS. And **Home, End and
  Space stay the text field's**, or the reader cannot edit what they are
  searching for.
- **A render-body latch is the bug to recognise.** `if (open && !everOpened)
  setEverOpened(true)` in a render body is legal, so nothing catches it — and it
  re-runs the whole subtree synchronously before React commits, in the frame
  already carrying a dialog mounting and a chunk evaluating. **The tell is a
  `setState` reached from the render body whose condition is "has this ever been
  true".** Use `features/shared/use-latched-disclosure`, which sets both in one
  batched update from the *handler*. A no-op must return the **same** value.
- **A `useState` adjusted during render is right where a ref is wrong.** A ref
  written during render survives a concurrent render that was thrown away, while
  React re-runs a self-adjusting component before committing anything under it.
- **Decide per read whether a failure is fatal — on the client too.** A read
  decorating a control the reader can still use should leave it empty rather than
  tearing it down.

### Lists, windowing and paging

- **Virtualise the window when the list is the page, and an element when the list
  is already inside a bounded box.** An inner scroller on a phone is a scroll
  trap; a list in a modal already has its bound. Virtualising an element costs an
  origin mismatch, which `scrollMargin` reconciles.
- **Measure `scrollMargin` off the part *above* the list, never `document.body`**
  — the body's box grows with the list's own height, so observing it fires on
  every card measured and page appended, each forcing a synchronous reflow, and
  none of that traffic can say anything.
- **Fixed row heights are *written onto* the row, not estimated**, since rows sit
  at multiples of it and an estimate a pixel out is a screen of drift a thousand
  rows down. A row that can wrap or expand wants `measureElement`, not a bigger
  constant.
- **Key measurements by the row's domain id, not its index**, or a search that
  reshuffles hands an expanded card's height to whoever now sits there.
- **Which rows are open moves up to the list** wherever it is windowed — a card
  that scrolls out unmounts and would lose the disclosure.
- **The gap is the virtualizer's `gap` option, not padding**, when the card *is*
  its `<li>`.
- **Offset a windowed row with `top`, not a transform** (an inline `transform`
  outranks a hover lift), and pass an `offset`, not a `style` object, or a fresh
  object per notification fails `memo` for every row.
- **Rank and `aria-posinset` are the index in the whole list**, so a screen
  reader hears the board's length rather than the DOM's.
- **Memo the row, and know why**: the virtualizer notifies on
  `[isScrolling, startIndex, endIndex]`, so the whole window re-renders when it
  crosses a boundary and at both ends of a gesture. It works because the props
  are stable by construction (lookup maps are `useMemo`s).
- **Keep the virtualizer one component down from the chrome**, or every scroll
  notification rebuilds headings a scroll cannot change.
- **A sticky element travels only as far as its own parent's box** — a rail
  seated inside a header that scrolls away goes with it; the box it needs is the
  one the rows are in. A pinned rail must **paint the page's ground on its own
  box**, or rows scroll through the gutter beside it.
- **A pinned part covers what is under it — give it a resting band**, or its
  first frame sits on the first row's own chrome before any scrolling.
- **`w-fit` is load-bearing on a wrapper whose child is centred on it**
  (`left-1/2`), since a block-level flex container fills its parent.
- **`keepPreviousData` is what makes committing live affordable** — a filter
  change is a *different key* with nothing in it, so without it every press
  replaces the list with a loading state. Hold pagination back while stale (the
  cursor belongs to the board on its way out), and dim only the count.
- **The one press that has to undo it is a *position*.** Holding the reader's
  place is right for a narrowing and wrong for a seek, where staying put is the
  one outcome that hides the answer.
- **A board that becomes a *different board* sends the list back to the top**,
  and which changes those are is one tested function — the read's cache key plus
  any display selection that reorders. A control that only *reprices* rows must
  not reset the scroll. Fire on the press, not the arrival; `behavior: "auto"`.
- **`useInfiniteQuery` pages are never evicted.** React Query drops the *oldest*
  page past `maxPages`, and a keyset walk resumes forwards only, so there is no
  path to read a dropped one back. Bound memory honestly instead: a shorter
  `gcTime` plus a **count** of retained boards (pure, tested). Three exclusions
  carry the safety — **the active key is never dropped**, even before its first
  page arrives and its `dataUpdatedAt` is still 0 (exactly when a recency sort
  would choose it first); **a board with observers is never dropped**; and
  **three rather than one**, so widening back two presses still finds it loaded.
  The sweep runs in an **effect** on the key changing, because `removeQueries` is
  a cache write and a cache write during render mutates what another component is
  reading.
- **A page names its own ids rather than sending a delta** — the client listing
  everything it holds on each request is a 414 waiting for the reader who scrolls
  furthest. The client still *merges* rather than replaces.
- **A client-side residual filter is three-state.** Two states force an
  undecidable row to count as *out*, and the only correction is to discard the
  answer and re-walk. A pending bucket is re-judged alone when its metadata
  arrives; resolved indices are **merged** into the allowed list rather than
  appended; and a page that admits nothing hands the **previous arrays** back,
  since the memoisation and the virtualizer's measurement cache ride on their
  identity.

### Bundle splitting

- **A `dynamic()` import splits nothing if the trigger sits in the same module as
  the thing it opens, and nothing at all if a barrel re-exports either one.**
  Both halves are invisible in review — the code reads as split and the bundle is
  not. Give the trigger its own module so the seam is a module boundary, and let
  the `dynamic()` call site name the module path.
- **A barrel is one module to the bundler, so importing one name pulls every name
  it exports.** A prerendered page whose entire content is one text field shipped
  every view in its feature because it imported a search box from the feature
  barrel. The same applies to a component *file*: a shared part that statically
  imports a heavy panel drags it into every page importing the part, so put such
  a part in a module that imports nothing and re-export it.
- **Which side of the line a barrel export sits on is what it costs to name**: a
  provider is a context and a `useState`, and the layout mounting it is on every
  route's path anyway; a view is the whole tool.
- The check, worth running whenever something behind a press moves house:

  ```
  grep -rl "<a string only the split-out part contains>" .next/static/chunks/
  # → then grep that chunk's name in .next/server/app/<route>.html
  ```

  A route with no button for the part must not name its chunk.
- **Split what a reader might never open; a control they always see is not a
  candidate however small the diff looks** — a chunk boundary costs more than a
  handful of controls saves, in bytes and in the placeholder holding the row's
  height.
- **A fallback declared in the split-out module pulls it back into the static
  graph.** Put the placeholder, and the geometry it stands in for, in a third
  module both import.
- **A part behind a press that nothing is holding space for takes no `loading`
  fallback** — a placeholder there is a flash rather than a reserved box.

### Naming, absence and honesty in the UI

These recur everywhere and are the rules most often broken by accident:

- **Absent is not zero, and the two are different answers.** An unsynced
  `roster_positions` is not evidence a league starts no tight end; a league
  present and empty is a real zero. A number a population was derived from
  travels **with** that population. Draw an em dash rather than `0.00`, no rank
  rather than "1st of 12", and nothing at all rather than an empty housing where
  the housing would claim a fact.
- **State a denominator only where it is a shortfall** — "116 of 116" is a
  denominator restating its own numerator.
- **A control that has to be summarised outside itself is one that wanted to be
  on the page.** A line beside a control must not restate what the control
  already says, and **a panel driven by a selection should not restate the
  selection**.
- **A menu's counts are computed over the population *without* that menu's own
  selection**, or it collapses to the selection the moment you make one and
  cannot be widened without being cleared.
- **A dialog whose options carry counts holds a draft and commits on Apply** — a
  count can't be read while the list behind it moves. A dialog whose controls
  only *preview* has nothing to protect and commits live; its footer says `Done`.
- **A list of subjects earns `all`/`any`; a list of attribute rules does not.**
- **A ladder is a stepper, not a row of keys.** Where what is chosen is a
  position on a line, `‹`/`›` over a readout is the shape; the table it walks
  must be **in ladder order**, and the stepper owns both bounds and answers null,
  so a key with nowhere to go is drawn inert rather than re-selecting what shows.
- **A number that previews is committed on release, not on change** — a committed
  value that re-fetches must not fire once per notch of a drag.
- **The population is not a filter of itself.** A season re-keys every read
  hanging off it, so it is seated apart from the filters that narrow within it.
- **Two controls over one axis is a bug that looks like a selection** — narrowing
  to dynasty with a board seeded to redraft is an empty list with nothing saying
  which control emptied it. Drop the row rather than the field, so a value that
  somehow arrived is still named and still clearable.
- **A chip asks the question, not the column behind it** — what kind of draft it
  was, rather than how many rounds it ran.
- **A default that cuts nothing is not automatically neutral.** Where the
  unnarrowed population pools two different games, opening unnarrowed averages
  both.
- **Compare against *the default*, not against "all", when badging a control as
  narrowed**, or it lights for every reader on every page and means nothing.
- **A metric goes where its subject lives.** Six catalogues, one per grain — one
  league, one team, one player, one subject across leagues, one side of a trade,
  one league's week. The same lens means something different in each, which is
  why it is not one shared metric. Only the collapsed-card catalogue holds `rank`
  cells, because only it places a league against its peers; a rank inside an
  already-ranked list is a second ordering competing with the rows.
- **A catalogue entry declares what it `reads`**, so a board nobody has aimed at
  an expensive dataset doesn't pay for it. Declared per metric and **not inferred
  from `group`** — what a bay is *called* has no business deciding whether a
  request is made — and required, so a new metric can't forget. The test pins the
  agreement: nulling a declared dataset must change the cell, nulling an
  undeclared one must not.
- **Narrowing a catalogue entry's type needs `Omit`, not `&`.**
  `Metric<C> & { cell: … }` makes an overload and a call resolves to the *first*,
  so the narrow type silently stops narrowing. Write
  `Omit<Metric<C>, "cell"> & { cell: … }`.
- **A view that can't answer with today's numbers refuses *per metric*, it does
  not drop the columns.** A rewound league can still price the roster it holds,
  so `REWINDABLE_METRICS` names the keys that survive and everything else draws
  an em dash — dropping the selection makes a reader press `Now`, read, and press
  back. Three things hold it: a key is **not** rewindable until it is named there
  (a metric quietly reading today's numbers under a past date is invisible on
  screen where an em dash is not); the refusal is gated **before** the
  catalogue's own null path, so the hover names the thing a reader can act on
  rather than "No projection"; and the blanks are explained once, under both
  halves, **only where there are any** — naming the columns, not counting them.
- **A hover warms only the cheap read**, on fine pointers only (`pointerenter`
  fires on a touch, so a tap would prefetch and then immediately fetch), debounced
  with a cancel on leave. Keyboard focus is exempt — focus is deliberate.
- **A label for a person is a username; a label for a team is a team name.** A
  team name is a nickname changed at will, so labelling by it makes the same
  opponent read as a different person in every league they're in. Pass the same
  string to an avatar's `label` so its fallback initial matches.
- **A caveat that fires on everything hides the one case that mattered.** Over a
  season horizon one missing week is a bye, not a shortfall.

## External API gotchas

- **Every request to Sleeper passes one process-wide limiter.** `sleeperGet` is
  the choke point, so the cap lives there (`sleeper/limiter`,
  `SLEEPER_MAX_CONCURRENCY`, default 24 — above the largest single fan-out, so
  nothing that ran in parallel is serialised by arithmetic). **Every other
  concurrency constant here is local, and local bounds do not sum**: two manager
  syncs plus a crawl tick was three times the fan-out anyone chose, and the
  advisory locks cannot help because they are per manager. Two asserted
  properties: the slot is released in a `finally` (a slot leaked on a thrown
  request tightens the limiter by one per timeout until it admits nobody), and
  the queue is **FIFO**.
- **The other half of that problem is *admission*.**
  `shared/manager/sync-admission` is the process's whole manager-sync budget
  (`MANAGER_SYNC_LIMIT`, defaulting to `databaseBudget().fanout`), reserved for
  **every** sync `/api/user/…/leagues` runs — a stale refresh is the *same*
  fan-out holding the same lock connection as a cold one. **The cap is a share of
  the pool** rather than a number of its own. **The variable is a *request*, not
  a grant** — `fanoutLimit` clamps it to that share, as `LEAGUE_REFRESH_LIMIT`
  is clamped for the other work of this shape, because a knob settable to the
  pool size is the failure the cap exists for reached through the variable meant
  to prevent it; junk, zero, a negative and a decimal all fall back to the
  derivation, and a clamped request warns **once, as the semaphore is built**,
  never per request. **It is three layers, not one** —
  the semaphore bounds this instance, the per-manager in-flight map dedupes
  within the process, and the advisory lock is the only one surviving a second
  dyno; reading any one alone makes the other two look redundant. **Acquisition
  never queues** (`tryAcquire`, whose release is idempotent, since a doubled
  release widens a bound permanently where a leaked one only tightens it): every
  caller holds a streaming response open. **Only the cold caller sheds with a
  503**, since it is the one with no cache to fall back on.
- **A browser that disconnects mid-stream stops being written to and nothing
  else.** Nothing in the sync stack takes an `AbortSignal`, deliberately: a cold
  sync fills *shared* Postgres state rather than this request's answer, so
  cancelling throws away the Sleeper budget already spent — and a run cancelled
  between two leagues is neither "we tried" nor "this graph is current", so a
  partial implementation puts a lie into the column the throttle is read off. The
  stream's `cancel` sets a `closed` flag, so the disconnect is noticed there
  rather than at whichever later `enqueue` throws.
- **Sleeper spells "no such thing" two ways, and which one you get is a fact
  about the endpoint rather than about the request.** Usually 200 with a `null`
  body; several endpoints answer 404. `sleeperGet` folds the null body;
  `sleeperGetOptional` folds both. **Pick by whether a missing resource is an
  *answer*.** The league graph's child collections take the second, because
  folding one spelling and throwing on the other is deciding by spelling. The
  projections sync takes the first: its gate stamps on a *successful fetch*, so a
  folded 404 would stamp an empty week fresh and never come back for it.
  `isMissingResource` is pure and tested because both ways of getting it wrong
  are silent — a 429 folded into a fallback is a rate-limited crawl writing empty
  collections over good rows.
- **Sleeper's players map is ~5MB** and they ask for at most one fetch per day.
  It's cached in `players`; go through `@/shared/players`.
- **KTC serves bot clients a page with no data**, so requests need browser
  headers. Player pages are 3–6MB, which is why the history backfill does a
  handful per tick.
- **KTC publishes two boards and they move in opposite directions.** A
  quarterback averages 3,219 superflex against 2,554 1QB, while a receiver
  averages 2,569 against 3,027 — so **a roster read off the wrong board is wrong
  at every position, not just at quarterback**. Which board a league reads is
  whether it starts more than one QB, derived from `SLOT_POSITIONS` rather than
  testing for `SUPER_FLEX` by name (`ktc/roster.ts`). It travels **with** the
  number in the payload instead of being assumed by whoever renders it. 118 of
  the 122 leagues stored here are superflex, so the four that aren't are exactly
  the ones a default misprices.
- **Two KTC rows can legitimately name one Sleeper player, so the read resolves
  the two boards *independently*.** The match is by name, so an alias or a
  retired entry beside a current one lands on one `sleeper_id` — hence no unique
  constraint, and cleaning the table up would not stop the next scrape producing
  another pair. `DISTINCT ON … ORDER BY sf_value` takes *both* numbers off
  whichever row won on **superflex**. `foldKtcValues` is the fix:
  order-independent, highest per board, treating null as "this row says nothing"
  rather than as zero (SQL's own `max()` semantics). A **pure fold rather than a
  `GROUP BY`**, because a duplicate-resolution rule nothing can test regresses.
- **KTC prices ~500 dynasty skill players, so a roster total is never the whole
  roster.** 93.7% of rostered players carry a price; the shortfall is IDP plus
  the deep end of every skill position, and kickers and defences are off the
  board entirely. A total ships with `priced` of `rostered`. It is a *dynasty*
  board and the only one this app scrapes, so anything showing the number says
  "dynasty" rather than leaving it inferred.
- **The same board carries rookie draft picks, as `position` "RDP", named rather
  than identified** — `"2027 Mid 1st"`, `"2029 1st"`: a season, a round and
  sometimes a third of the round, in a string, with no id to join on (a pick is
  not a player, so every pick row's `sleeper_id` is null). Read them through
  `getKtcPickBoard`, parse with `parseKtcPickName` (**never a bespoke regex** —
  it is a scraped string KTC has promised nothing about, so it fails the whole
  name on one token it doesn't know), and place a traded pick with
  `pickTier`/`ktcPickPrice`. Which seasons get three tiers and which get one
  untiered row moves through the year, so a lookup states a preference and
  **reports which row it landed on**. **Both ends of a ratio must read the same
  row** — resolving each independently was a 20% error on the most-traded asset
  on the board, always understating a future first, with nothing about the number
  looking wrong.
- Transactions are keyed by week with no all-at-once endpoint; a league's full
  history is the union of each week.
- **Matchups are the second collection keyed that way, and the two are gated
  separately.** `league/<id>/matchups/<week>` returns a *side* per roster, not a
  game — two sides share a `matchup_id`, null for a bye — so `matchups` is keyed
  `(league_id, week, roster_id)`. **What must not be shared is the
  stored-max-week gate**: the two fill up independently, and every league stored
  before matchups existed has transactions to the current week and no matchups at
  all, so one gate opens the refresh window past a whole unfetched season.
  `fetchLeagueGraph` takes a range per collection and runs both through one
  bounded per-league pool — adding a second request per week doubles the burst
  otherwise, and `CRAWL_DISCOVERY_CAP` is written against that arithmetic.
- **Projections live on a different host and aren't documented or versioned.**
  `api.sleeper.com/projections/nfl/<season>/<week>`, not `api.sleeper.app/v1` —
  and the v1 host answers that path with 200 and an object of empty objects, so a
  wrong base looks like working code with no data. Build the URL with
  `sleeperDataUrl`, not `sleeperUrl`.
- **Kickoff instants come from the *scoreboard*, never the schedule.**
  `schedule/nfl/regular/<season>` looks like the source and cannot be: it carries
  `status, date, home, week, game_id, away` and **no `start_time` at all**,
  checked against 2024, 2025 and 2026. Read `scores/nfl/regular/<season>/<week>`
  (`getNflWeekScores`), which publishes a believable ms `start_time` months
  ahead, plus the two teams on **`metadata.home_team` / `metadata.away_team`**
  rather than at the top level — the one shape difference, and the one a port
  back to the schedule shape would silently fail on, since reading the wrong keys
  yields no teams rather than an error.

  **What that mistake cost is the lesson, because nothing failed.** Three readers
  degraded politely exactly as designed: the kickoff ordering was a permanent em
  dash, the game lock fell back to day accuracy, and the countdown fell back to a
  provisional instant that was a day out and looked right. Tests passed
  throughout, because they construct rows *with* a `start_time`. **A fallback
  that fires always is indistinguishable from a feature that works**, so a field
  a whole feature rests on gets one assertion against the live payload before the
  feature is built on it.

  The plausibility window stays and stays a *rejection*: a believable
  `start_time` is epoch ms inside 2000–2100, and a seconds epoch reads as January
  1970, so the parse **refuses the wrong unit rather than converting it**. What
  it must never absorb is a *missing* field, which is what made the above
  invisible. A week with no believable instant answers null and the client falls
  back to the calendar table rather than the server inventing an hour; an
  unscheduled season answers `[]`.
- **A weekly projections response is ~9,400 entries and only ~800 are real.** The
  rest are placeholders for players with no game that week: `game_id` null and
  nothing in `stats` but ADP keys. Store them and every one reads as "projected
  zero" — `projections/parse` is the filter, and it belongs on anything reading
  this endpoint. **Omitting `position[]` returns every position in one request**,
  so a week is one 5.6MB fetch rather than nine.
- **`state/nfl` reports week 0 all offseason** while projections for week 1 are
  already published. Gating on `week` alone means syncing nothing until
  September; **`display_week` is the one to follow**.
- **A projection's `pts_ppr` is not any league's PPR.** It is scored at 0.05 a
  passing yard, where Sleeper's own league default is 0.04 — worth ~2.3 points a
  quarterback, before house rules. Only 14 of 120 leagues stored here land within
  0.15 of it. Score the stat line against the league's `scoring_settings` with
  `projections/score`; the two sides share a key vocabulary, so it is a dot
  product. Reserve `pts_ppr` for a generic, league-less board.
- **Every key the league pays for and the line carries scores.** The only
  exclusion is `NOT_SCORABLE` — `pts_std`, `pts_half_ppr`, `pts_ppr` and the ADP
  keys, which restate the answer rather than naming an event. Nothing else is
  filtered: `pass_fd`/`rush_fd`/`rec_fd` really are the matching yardage over ten
  and the reception splits really are a fixed carve-up of `rec`, but **how
  Sleeper populates a category is Sleeper's business** — points are
  `settings[key] × stats[key]`, and dropping those keys hands back a total the
  league's own settings do not produce.
- **A week is five days long, so filter the horizon by game, not by week.**
  `getRemainingWeeks` keeps a week until its *last* game, which is right for
  labelling the horizon and wrong for summing it. `listPlayerWeekStats` filters
  on the row's own `game_date` against the same `TODAY_ET` expression.
- **Ask what Sleeper projects, not what this roster happens to have.**
  `unprojectedScoring` measures a league's scoring against the week's whole
  vocabulary (`getProjectedStatKeys`). Fed the roster subset instead, a league
  with no kicker or defence slot reports `xpm`, `sack` and `int` as unsupplied
  and the real gaps are lost in noise. It is non-empty for nearly every league,
  because they nearly all weight defence and special-teams events Sleeper doesn't
  project — so it only *means* anything where those players start, and any
  warning is gated on the league having a DEF/IDP slot.
- **That dot product is linear, so aggregate the stat lines, not the points.**
  `score(w1) + score(w2)` is exactly `score(w1 + w2)`, and summing first is one
  dot product per player instead of one per player-week, rounding once instead of
  once a week. **It is also the only way to tell a bye from a zero**: a summed
  total needs the *count of weeks that contributed* alongside it. Carry that all
  the way to the screen — an em dash, not `0.00`.
- **The horizon is whatever is stored, so send it with the number.**
  `getRemainingWeeks` reports the weeks actually on disk rather than assuming a
  full season, so a failed backfill shortens the answer without invalidating it.
- **Keep the weekly lineups, don't just sum them.** `weeklyLineupSplit` returns
  the total *and* who filled the slots, because the attribution is the only thing
  separating a bench player who is occasionally the better start from one who is
  never startable. Three consequences: the halves belong to
  `weekly_optimal_points`, **not** to the aggregate lineup's `optimal_points`,
  and the two are deliberately different numbers; a week a player has no
  projection for is left out of that week's candidates rather than passed as a
  zero, which keeps the bye out of his benched-weeks count (so
  `starting_weeks + bench_weeks` is the player's *projected* weeks, not the
  horizon); and the split hangs off `TeamOutlook`, not the league-wide players
  map, because being stuck behind someone is a fact about a roster.
- **`weekly_bench_points` is summed from the raw weeks, not by adding the
  per-player halves** — one rounding off the source instead of a cent of drift
  per player. It is not a number to minimise: a bye has to be covered by
  somebody, so a zero bench means no depth at all.
- **There is no ADP endpoint** — `/api/adp` averages the `draft_picks` we have
  crawled, so it describes the leagues in this database, not the market. Say so
  wherever the number surfaces, and expose filters that narrow the population:
  pooling a 4-round dynasty rookie draft with a 25-round startup averages two
  different games.
- **A priced board is cached in-process, and the reason is the *curve* rather
  than the query** (`getDraftAdpForPlayers`): steepness is applied by the caller
  *after* that read returns, so every notch of the slider re-asked for a
  byte-identical board. **The key is the statement, not `boardSignature`** —
  that names the axes a *board* varies on, where a cache key must name everything
  the *answer* varies on, which is strictly more (`min_picks`, `draft_types`,
  `draft_statuses`) — and **the ids go in verbatim rather than digested**, since
  a collision is one manager's roster priced off another's board.
- **A season and a date range are different cuts of the same drafts, and
  `/api/adp` takes both.** `season` is what a draft is *for*;
  `start_after`/`start_before` (`YYYY-MM-DD`, read in ET against
  `drafts.start_time`) is when it *happened*. Every dynasty league runs a rookie
  draft in May and a startup in August under one season label, so "the last 30
  days" is a question a season cannot express — and the 2026 rookie class is not
  in a 2025 draft at all, which is the question a range cannot express. **The
  season leads: it is the board's population, the range a cut inside it.** Pooled
  across seasons the top of a twelve-month board is taken in ~46% of the drafts
  averaged, because half were drafted from a different player pool. Four
  consequences:
  - **An omitted `season` is not a season default — it is a default that switches
    itself off.** `DEFAULT_SEASON` applies only when the caller bounded the board
    *neither* way, so a client that leaves the season out and narrows a window
    silently goes back to spanning every season. Send it every time, `"all"`
    included.
  - **A date bound drops drafts Sleeper never gave a `start_time`**, because
    there is no honest side of the boundary for them — so "all time" can match
    *more* drafts than a range covering every date on file. Say it in the caption.
  - The two never intersect by accident, which is what that first rule prevents.
  - **The date→timestamp conversion lives in SQL, not the parser**, because what
    a bare date means is a zone question. The end bound is exclusive against the
    next ET midnight so the named day is included whole.
- **A draft's `pick_no` is not always a draft position.** In auction drafts it is
  nomination order, which is why `/api/adp` excludes them by default — and why an
  auction's `draft_order` is not a pick order either.
- **What an auction *does* answer is the price, and it is a second population
  rather than a second column of the first.** `metadata.amount` on a pick over
  `settings.budget` on its draft is a share of what a manager had to spend —
  cardinal where an ADP is ordinal, and the only number on the board that says
  whether the 1.01 is a nose ahead of the 1.02 or twice the price of him.
  `shared/manager/adp-auction` reads it, and four rules hold it up. **It inherits
  every filter but `draft_types`** — the same leagues, season, window and round
  bounds, so a row's ADP and its bid describe one slice of the corpus, but the
  board is *always* read `snake,linear`, so honouring that list would leave every
  share null for every reader: a fallback that fires always, indistinguishable
  from a corpus with no auctions in it. That override is `DraftTypeScope`, one
  named argument on the shared `draftSelection`, never a second copy of it.
  **Neither guarded cast takes a default**, unlike every other one here: a share
  is a fraction of a *specific* budget, so assuming the common 200 silently
  reprices every player in a room that played for 100, and an unreadable bid is
  left out of the average rather than counted as free. **It is split per board**,
  since a dynasty startup auction and a redraft auction are two markets. And
  **the auction counts on the wire are of matched auctions, not priceable ones**
  — that is what keeps a Sleeper build that stopped sending `budget`
  distinguishable from a corpus holding no auctions, which is the one failure
  this read cannot otherwise tell from working.
- **When a draft *ended* is only knowable from `last_picked`.** It rides at the
  top level of Sleeper's draft object (not inside `metadata` or `settings`), and
  `draft_picks` carries no timestamp of its own. **On a draft still running it is
  only the running edge, which is why it is read with `status` and never alone**:
  a boundary that advances with the draft admits everything happening inside the
  draft, since each trade in the room lands after the pick before it. It is
  absent for a draft nobody has picked in — read the null as "unknown", **never
  as a date**.
- **A placeholder pick's number is its place in the kicker sequence, not its
  draft slot.** Leagues trading next year's rookie picks during a startup can't
  draft players who aren't in Sleeper's pool yet, so they draft kickers as
  stand-ins: the Nth kicker off the board is rookie pick N. `shared/picktracker`
  sorts by `pick_no`, filters to `metadata.position === "K"` and numbers from the
  *filtered* index — the pick's own `round`/`pick_no` are the wrong numbers on
  purpose. Two adjacent traps: slots-per-round is `settings.teams`, because
  `draft_order` only maps users who claimed a slot and is null before an order is
  set; and "next pick" must gate on the draft's `status`, because after the last
  pick the arithmetic still names a plausible slot that will never exist.
- **Lineup slots overlap without nesting.** `WRRB_FLEX` takes RB/WR and
  `REC_FLEX` takes WR/TE, and leagues here use both, so filling slots one at a
  time — even most-constrained first — picks the wrong lineup.
  `projections/optimal` goes player-by-player in points order instead, which is
  optimal because a player's points don't depend on the slot they fill.
- **Eligibility is `fantasy_positions`, not `position`.** A back listed
  `["RB","WR"]` can fill a `REC_FLEX` his primary position bars him from, and the
  IDP leagues here start players at DL whose `position` reads LB.
  `getFantasyPositions` is the query — `getPlayerLineupMeta` where the caller
  also needs each player's **NFL team**, since both are one `players` row and two
  reads of it can straddle a sync; **a player the cache doesn't know is eligible
  for nothing**, which is better than recommending a lineup Sleeper would reject.
  IR and taxi players *are* candidates — a stashed player is bench depth that
  could be started, a deliberate choice.
- **An optimal lineup that is arbitrary about interchangeable slots reads as a
  mistake.** The matching is free to seat the worse of two backs at RB1 — same
  total, but as advice it looks wrong and diffs against a sane current lineup as
  pointless moves. So the answer is canonicalised: better player to the stricter
  slot, and among equally strict slots to the earlier one.
- **A best-ball league is the one league where `starters` is not the lineup.**
  Sleeper seats it *after* the games are played, so that array holds whatever the
  draft left behind. `compareLineup`'s `bestBall` is four consequences of one
  sentence: `current` **is** the optimal lineup, `points_left` is zero,
  `start`/`sit` are empty, and `locked` is ignored (a seat chosen after the fact
  is not constrained by a game already played). Read through `BEST_BALL_SQL`, the
  same fragment the board filters on, so a league priced as best ball and solved
  as an ordinary one can't happen. Absent or unparseable reads false.
- **ADP is ordinal, so it cannot be summed.** A draft position is a rank where
  lower is better, so adding raw ADPs gives a deep roster a worse number and lets
  a stud *lower* the total. `adpValue` inverts it onto a scale, and the shape
  matters: value decays across a league's **startable pool**
  (`teams × starting slots`), not a fixed pick count, so the gap between picks 1
  and 2 is worth vastly more than between 100 and 101 and a plain
  `maxPick − adp` would overvalue bench depth. Anchoring to the pool is what
  makes a late first worth the same in a 10- and a 14-team league. The one knob
  is the **steepness** — a *user control*, not a hardcoded constant, because it
  is a modeling choice that reprices every card; `ADP_PEAK` is only the scale.
- **The steepness default is a measurement** (`scripts/fit-adp-curve.ts`): every
  completed trade is a revealed near-indifference between two hauls, so the curve
  making the fewest look lopsided is the one the market is using. Four things
  make that a reading rather than a number off a chart. **Only the
  count-asymmetric trades identify it** — a 1-for-1 balances under *every* curve,
  so the even subset runs to whatever floor the search has, which is the
  degeneracy and not a reading. **The search is wider than the slider**: if the
  answer falls outside the control, that is a finding about the control. **The
  one known bias points the other way**, so the fit is a ceiling — a 3-for-1
  favours the consolidating side because roster spots are scarce and nothing in
  this curve prices one. And **it is scored on trades it was not fitted across**,
  because a curve chosen and graded on one sample is graded on its own noise;
  player-for-player only, since a pick is priced through the rookie ladder and a
  KTC ratio.
- **`avg(pick_no)` is a poor statistic for a convex curve, and the obvious
  correction is *not* the fix — this is the negative result, kept so it is not
  rediscovered.** By Jensen `E[v(P)] > v(E[P])`, so reading at the mean
  undervalues a player the board is split about. That argument is correct and the
  cumulant-series correction built on it was shipped and reverted within the day:
  it is exact for a Gaussian and useful while `λσ` is well under 1, and the
  **dynasty board's median `λσ` is 3.32**, where the series does not converge at
  all — it moved the median player **2.25×** and the 95th percentile **558×**.
  The diagnosis is what to keep: **a dynasty board whose drafts put one player a
  hundred picks apart is not describing a polarising player, it is saying it does
  not know where he goes**, which should cost confidence rather than earn
  convexity value. Whatever replaces the mean wants to move in that direction,
  and wants running through `fit-adp-curve.ts` before it ships. The redraft board
  is nowhere near this problem (median `λσ` 0.41), which is why a change that
  looks fine in the small can be wrong for most of the app.
