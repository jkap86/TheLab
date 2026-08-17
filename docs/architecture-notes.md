# Architecture notes — long-form rationale

Extracted from `CLAUDE.md` for the same reason as `design-notes.md`: the rules
are in `CLAUDE.md`, and this is the reasoning and the measurements behind them.

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
- **One exception: client code may deep-import a designated pure module.**
  A `"use client"` file can't *value*-import a barrel that re-exports
  `pg`-backed code — the bundler would drag the database into the browser — so
  runtime values shared with the client live in modules with zero runtime
  imports, imported directly (`@/shared/projections/slots`). Type-only imports
  are erased and don't need this. The same constraint appears between pure
  modules: a tested module importing another by alias breaks Node's test
  runner, so pure→pure value imports are relative with an explicit `.ts`
  extension (`optimal.ts` → `./slots.ts`), the mechanism the tests already use.
- **The lineup-slot vocabulary lives in `projections/slots.ts`, once.** The
  solver and the client components both read it — which slots exist, which
  start nobody, which are defensive. `DEFENSIVE_SLOTS` is derived from
  `SLOT_POSITIONS` rather than listed, so a new IDP slot gates the
  "projections read low" caveat the moment the solver learns it; before this,
  the set was retyped in two components and a new slot would have silently
  missed the warning. **Two derived sets now, and they are not
  interchangeable** — `IDP_SLOTS` is `DEFENSIVE_SLOTS` without `DEF`, because
  nearly every league starts a team defence (so that set barely distinguishes
  leagues) while starting a linebacker makes it a different game entirely. The
  filters narrow on the narrow set; the projections caveat wants the wide one,
  since Sleeper under-projects the team unit too. Adding a third derivation is
  cheap and correct — deriving is the rule here, and what varies is only which
  positions the predicate accepts.
- A module owns its tables. If you need data from another concern, add a query
  to *that* module and call it — don't write SQL against a table your module
  doesn't own. (`ktc/match` used to query `players` directly; it doesn't now.)
- **A cache-backed route reads and nothing else.** `/api/projections`,
  `/api/league/[leagueId]`, `/api/adp`, `/api/adp/density`, `/api/adp/leagues`
  and the three `/api/trades*` routes answer from what the background syncs have
  stored; a slice that hasn't been synced comes back empty
  rather than fetched on demand. (`/api/user/[username]`, `…/leagues`,
  `/api/picktracker/[leagueId]` and `POST /api/league/[leagueId]/sync` are the
  deliberate exceptions — resolving a
  manager and syncing their leagues is what the user routes are *for*, which is
  why the leagues one streams progress; the pick tracker follows a draft
  *while it happens*, for any league id whether a sync has seen it or not, and a
  cached copy would be behind the room; and the fourth *is* the thing that
  refreshes, so there is nothing else it could read from — see the lineup
  checker's sync key below. Note which of the two `/api/league/[leagueId]` routes
  is which: the read is cache-backed like every other panel read, and only the
  `sync` child under it fetches. **Every other route under that prefix is
  *not* an exception** — `…/players`, `…/leaguemates`, `…/ranks`, `…/ktc` and
  `…/adp-value` today: they read the rosters and membership that stream writes,
  so a manager it has never run for gets an empty answer rather than a second
  sync of their own. That is the rule for a new sibling too, so this list has
  gone stale twice; the prefix is not what makes a route an exception, being
  *the thing that resolves or follows* is.) The traffic runs the other way too:
  `/api/trades` used to sit under that prefix and doesn't now, because it stopped
  asking about a manager at all — a route belongs there when a username is the
  *question*, not when a page that happens to know one is what reads it. `/api/kickoff` is the one route
  that is neither cache-backed nor a resolver: it reads Sleeper's schedule call
  through an in-memory read-through cache (`shared/schedule`) — one small
  request per process per half-day for a value that barely moves, too light to
  earn a table, a migration or an advisory lock, while the cache still keeps
  page views from fanning out to Sleeper. It follows the projection gate's
  lesson in miniature: the cache stamps the *attempt*, so a season answering
  null (not scheduled yet) waits out its own shorter TTL rather than refetching
  per request, and a failed fetch stores nothing and serves stale. Where a read
  needs to know what week it is, derive it from
  stored data too: `projections/queries`
  takes the weeks still ahead from `game_date` rather than `state/nfl`, so it can
  only ever name weeks that are actually here to read.
- A route that needs several independent reads should `Promise.all` them, and
  decide per read whether a failure is fatal. `/api/league/[leagueId]/values`
  catches each of its two lenses and sends an empty map — the rosters are the
  point of that panel and the prices are a bonus on top.
  **And a read that is *only* a bonus should ask a further question: does it
  belong on this response at all?** That one used to answer with the prices, the
  rest-of-season outlook and (on request) a week's projections joined onto the
  rosters, so the first paint of a panel whose subject is rosters-and-standings
  waited on the slowest of four reads — ~305–490ms of database work against ~53ms
  for the structural half, and ~535–600ms once a week was asked for. Catching per
  read made each of them *survivable*; it could not make any of them stop
  blocking. The three are `./values`, `./outlook` and `./week` now, keyed apart on
  the client so a board change re-fetches prices alone and a week change
  projections alone, and the panel renders on the core with the rest filling in.
  Reach for the split when a read is both slow and optional; a fast optional read
  is a field.
  **The question is per read, not per `Promise.all`, and phrasing it around the
  parallel case is how one route missed it.** `/api/user/[username]/ranks` reads
  sequentially on purpose — which rosters to project is the first read's answer —
  so there was no `Promise.all` to prompt the question, and a projections failure
  500'd a payload whose other two ranks were already in hand and never depended
  on it. Dependent reads earn the same judgement: the second one failing is not
  automatically fatal just because it had to wait for the first.
- Aliases: `@/*` → `src/*`, `@thelab/http` → the configured axios instance.

## Anything crossing the network

Response and message shapes go in `shared/contract`, once. Routes annotate what
they send with those types; the client aliases them in
`features/manager/types.ts`. Never redeclare a response shape on the client —
that drift is invisible to the compiler, which is exactly what this prevents.

That module holds **every** route's payloads, not just the league ones —
`/api/adp` and `/api/projections` are both there, and so is `UserInfo` (it used
to live in `shared/sleeper`, which left one payload defined outside the
contract). Adding a second contract file per module is the drift this rule
exists to stop; import the filter type it needs instead. It is its own concern
rather than a file inside `manager` (where it started) because it describes
routes spanning several modules, and a contributor looking for
`ProjectionsPayload` should not need to know the league tool came first. Types
only: everything it pulls from the domain modules comes in with `import type`,
which is what lets client code import it without dragging `pg` into the bundle.

Route *policy* stays out of the upstream clients. `resolveManagerUser` maps a
searched username to the HTTP status the routes answer with (blank → 400,
unknown → 404, unreachable → 502); that is a fact about this app's API, so it
lives in `shared/manager/resolve.ts` — the Sleeper client only knows that
Sleeper answers 200-with-null for an unknown user.

**The HTTP half of that lives one layer out, in
`app/api/user/[username]/manager-request.ts`.** All six routes under that prefix
opened with the same ten lines — await the params, resolve the username, turn a
failure into `NextResponse.json(ApiErrorPayload)`, read `?season` — so
`resolveManagerRequest` is those ten lines, and a route is now three:

```ts
const resolved = await resolveManagerRequest(request, params);
if (!resolved.ok) return resolved.response;
const { userId, season } = resolved;
```

It sits in `src/app` rather than beside `resolveManagerUser` because the only
thing it adds is the `NextResponse`, and domain code has no business
constructing responses. That is also why it doesn't breach "routes only, no
business logic": every decision it makes already belongs to a module it calls,
and what is left is the HTTP adaptation. A non-route file in the app directory is
fine — only `route.ts`/`page.tsx` are special, and the build confirms it.

**Six routes resolve a manager; only two of them may ask Sleeper who it is.**
`resolveManagerRequest` fetches the profile and is for the two routes that need
one — `/api/user/[username]` and `…/leagues`. The other six (`players`,
`leaguemates`, `ranks`, `ktc`, `adp-value`, `matchups`) read Postgres and
nothing else, keyed on a `user_id`, and used to spend a Sleeper request each
purely to arrive at an id the leagues stream had already sent — five lookups per
manager page, on every navigation between the tabs. `resolveManagerIdRequest`
takes it back as `?user_id=`, so a page is **one** lookup and four database
reads. Four rules hold it up. The hint is checked for *shape*
(`isSleeperUserId`: a digit string, bounded) and never trusted as identity —
these are public statistical reads, so the worst a forged id buys is a public
answer about a different public account, and it reaches Postgres as a bound
parameter regardless. Without a hint nothing changes: a bookmark or a direct
navigation resolves the name exactly as before, an unknown manager is still a
404 and a blank one still a 400. The id is **not** in the query key — `searched`
and the id are one manager, and the hooks don't ask until the stream has
produced it, so there is no window where the key would have to change. And
behind all of it `resolve.ts` memoises the lookup for a minute
(`memoizeManagerLookup`), which covers what the hint cannot — a cold navigation,
several tabs, several readers — caching the in-flight promise rather than the
settled answer (so simultaneous reads collapse), remembering a `null` (the answer
an abusive caller can manufacture endlessly) and never remembering a failure (a
502 should be retryable at once). The decision half is pure and takes its lookup
as an argument, which is what lets the request *count* be the assertion.

Two details it carries so callers don't have to. It returns `username` **as
spelled in the URL**, because Sleeper resolves a user id as readily as a name and
that is the string worth putting in a log line (the `ktc` route does). And it
parses `season` for all six including the base route that ignores it — one string
read is cheaper than a second entry point, and the routes that want more of the
query string get `searchParams` itself (`leagues` reads `?refresh=1` off it).

## The server's own read caches

**There is a third cache, and it protects the *dyno* from its own readers.**
Postgres protects Sleeper and KTC; TanStack Query protects Postgres from one
browser. What neither reaches is the case where the same expensive answer is
computed for several readers at once — a second tab, a second person, a reload,
a process that has just restarted — and the two reads where that costs most are
the full ADP board (a ~500ms aggregate over 1.5M picks) and a manager's ranks (a
lineup solve per team per remaining week: ~29,000 solves for a 400-league
account, and *CPU on the web process*, so two readers are two spells of a blocked
event loop rather than two queries a database can interleave).

**There are three of them now, and the third is there for a second reason worth
naming: one open makes four requests.** A league's *core* detail —
`readLeagueDetail`, `LEAGUE_DETAIL_CACHE`, eight minutes, 256 leagues — is not
expensive the way those two are (a handful of small queries), and it is read by
all four of the League Details routes, since the values, the outlook and the week
each need the same rosters, slots and scoring before they can compute anything.
Uncached, splitting one payload into four requests would have turned one league
read into four, which is the tax a split is supposed to avoid paying rather than
introduce. It is also the read a reader re-issues most: the panel mounts on
expand and unmounts on collapse, over a list of a hundred leagues opened
casually.
**It is invalidated on *write* as well as by time, and so are the ranks beside
it.** `persistLeagueGraph` forgets both after its transaction commits — the
league's own detail, which is what makes the lineup checker's sync key honest (a
reader told Sleeper has confirmed their change must not be shown the roster from
before it), and the ranks of every manager holding a roster in that league, which
are read off exactly those rows. After rather than before, since a read starting
between an early invalidation and the commit would cache exactly the rows the
write is replacing. What that buys is not only correctness on the press: it is
what lets both TTLs be set for the *background* writes they are genuinely stale
about, instead of kept short in the hope of covering an interactive one.

`TtlPromiseCache` (`shared/util`) is that layer, and it is `BoundedCache` plus
the one thing that class deliberately refuses: an **in-flight map**, so ten
callers arriving on a cold key run one computation. That refusal was right for
what it was written for (a page of trades resolving player names, where a doubled
miss is one cheap lookup) and wrong the moment the value is seconds of work held
against a pool connection. Six rules hold it up:

- **A rejection is never cached and never lingers**, so one database blip is not
  a TTL-long outage. The compute runs *inside* the promise chain, so a
  synchronous throw rejects rather than escaping past the bookkeeping and
  wedging the key forever.
- **The in-flight entry is retired by identity**, and that identity check guards
  the *store* as well as the delete — otherwise a `clear()` mid-flight lets the
  older computation write its answer over the newer one's.
- **The key names everything the answer varies on, spelled out rather than
  `JSON.stringify(theObject)`** — property order is not a fact about the values.
  `shared/manager/read-cache.ts` holds both keys and both policies, and is pure
  (everything it touches arrives as an erased `import type`) precisely so the
  keys can be tested: a key that is too narrow serves one board under another's
  filters, one that is too wide simply never hits, and *neither* is an error.
  The ADP key's test walks every field of `AdpFilters` and asserts that changing
  it changes the key, which is the agreement no type can carry.
- **List fields are sorted and deduplicated into the key** — `= ANY(…)` is a set
  comparison, so two orderings are one population — but ids go in **verbatim
  rather than digested**, the rule `boardSignature` already keeps: a hash trades
  a silent collision for a shorter key, and a collision here is one reader's
  board served to another.
- **A shared answer is frozen** (`deepFreeze`), because every caller inside the
  TTL holds the same object and an in-place sort would edit what every later
  reader gets — a bug that appears on the second request and never on the first.
  The exception is the per-player board, which carries a `Map`: `Object.freeze`
  on one is a guarantee that cannot be kept, so it is left alone rather than
  given reassurance.
- **Each TTL is *longer* than the browser stale time it stands behind** — and it
  is worth knowing that this read the other way round for a long time, in the
  numbers *and* in the comments justifying them: the board's ten minutes against
  the browser's fifteen, the ranks' five exactly matching
  `MANAGER_STALE_TIMES.ranks`, the league detail's three against the panel's
  five. Each carried a sentence about "a layer's TTL is shorter than the one it
  stands in front of", which is true of the *client* (its stale read costs a
  request this answers from memory) and backwards when applied here.

  The asymmetry is what the sentence lost. A browser entry going stale does not
  discard anything — React Query revalidates, keeping the rows on screen — so
  `staleTime` is not "how long the data is good for", it is **when this app's own
  server is next asked**. The whole job of this layer is to be what that request
  lands on. Shorter, it expires just before the revalidation it exists to absorb,
  so the one request guaranteed to miss is the one the cache was built for; the
  hit rate that remains is whatever a second reader happens to contribute.

  A gap of merely more than zero does not fix it either, which is why the floor
  is a **ratio**. Nothing lines the two clocks up: the client entry is stamped
  when its request resolved, this one when the computation started, and a request
  arriving uniformly inside an entry's life finds `(ttl − stale) / ttl` of it
  left. At equal TTLs — where the ranks sat — that is zero, and the boundary miss
  is not a risk but the normal case. The layers now sit at 1.6× (league detail,
  8m/5m), 2× (both ADP boards, 30m/15m) and 3× (ranks, 15m/5m), each chosen from
  what writes underneath rather than from one rule: the crawler's fastest tier
  bounds a league's detail, the projections sync's hourly slices bound the ranks,
  and an ADP board is an average over ~1.5M picks that a handful of newly crawled
  drafts cannot visibly move.

  **What made the longer numbers affordable is invalidation, not tolerance for
  staleness.** `persistLeagueGraph` already dropped the league's core detail; it
  now drops the ranks of every manager rostered in that league too, which closes
  the gap that made the ranks TTL feel like it had to be short. The browser
  retires its ranks entry the moment a leagues sync reports a new revision
  (`leaguesRevision` → `dependentManagerQueryKeys`), and without the server half
  that refetch was answered from a payload computed *before* the sync — the
  client doing exactly the right thing and being handed back the number it was
  trying to replace. Both invalidations reach one process, so the clock still
  answers for the crawler writing from the worker dyno; every path a reader can
  *press* is exact.

  The seam is asserted in `features/shared/cache-layering.test.ts`, and it has to
  live there: `shared/` may never import `features/`, so the two constants are
  two modules apart with no compiler link, and their relationship is the one
  thing neither file can state about itself. Each side's own test keeps its
  ceiling, because "not excessively stale" is a claim about what writes
  underneath and not about the layer in front.

  Each process holding its own is *correct* rather than merely acceptable:
  Postgres stays the source of truth, so a second instance costs one extra
  computation of an answer that was about to expire. Nothing here wants Redis; it
  would put a network hop on the hot path.

**A cached answer joining several datasets should be cached per dataset, and the
comps pool is the case that made the argument.** Its entry per season used to
hold everything a comparison could weigh: the season's stat lines and the player
profiles behind them, plus a KTC snapshot, a KTC history aggregate, an ADP
average and the NFL draft crosswalk. Six reads per season, and
`collectSeasonPools` builds four seasons at once, so a cold process answering one
request opened more concurrent statements than the pool has connections.

What made that indefensible rather than merely expensive is *who was paying*.
Every market field defaults to weight 0 — deliberately, because a defaulted
market field silently excludes every unpriced player from everyone's first result
set — so the typical request, the one a reader makes by picking a player and
pressing nothing, fetched four aggregates per stored season and read none of
them. The picker's own list was worse: `/api/comps/players` folded the same
pools to print a name, a position and a team, none of which come from any of it.

The split follows the shape of the question. The pool is now the two reads every
board makes; each dataset is its own entry per season; and the catalogue says
which fields come out of which (`CompsField.reads`, required so a new field
cannot forget, and declared rather than inferred from `family` — the market
family spans three different queries and the one profile field that costs a query
is not in it). `requiredCompsEnrichments` reads the **effective** board, so a
field existing in the catalogue is not a dataset being fetched and a field
switched off does not drag one in behind it.

Two decisions inside that are worth keeping. **The merged corpus is not cached**,
which looks like the obvious next step and isn't: it is a fresh row and a fresh
`values` object for every player-season on file, per combination of datasets in
use, to save a `map` over rows already in memory — and it would give
`withCareerValues`'s single memo slot a different corpus per board, so two
readers on different boards would take turns rebuilding the career pass over the
whole archive. So the merge runs per request and *after* that pass, which is safe
because the two commute: career values are arithmetic over games and points, and
no market dataset touches either. It is the same trade `withWindowValues` already
makes, for the same reason. **And what a payload prints is a different question
from what a field compares**: a comps row shows where each player went in the
draft, which is metadata on a dozen rows, where `draft_capital` is a dimension
over the whole corpus. Reading the second to print the first is what put the
draft crosswalk on every default board; the route now reads the picks of the rows
it is about to send.

The bound underneath all of it is `compsReadAdmission`, at
`databaseBudget().fanout`. The per-walk constant beside it
(`COMPS_SEASON_BUILD_CONCURRENCY`) bounds one cold corpus and cannot bound two
readers, which is the arithmetic `sleeper/limiter` already made once: local
bounds do not add up. A slot wraps one query-shaped call and nothing else — the
ADP and draft loaders resolve the season's ids *before* admitting, since awaiting
another admitted read from inside a slot is, with every slot taken, a queue
waiting on itself — and `getDraftAdpForPlayers` is left unwrapped because it
carries `adpComputeAdmission` of its own.

**And the ranks read is split at the work, not at the route.** Its expensive half
is the projections; its cheap half (the standing, the points rank) comes straight
off rosters it has already fetched, and the record ledge on every card needs the
standing whatever the four stat columns say. So `?projections=0` is a parameter
on the same request rather than a second one — a route split would make the cheap
half a round trip for every reader who wants both, which is most of them. Two
rules make it safe: **absent reads as *on***, so a bookmark or an older client
answers exactly as it always did (`booleanFilter`, never `booleanFlag`, whose
absent-is-false is the opposite meaning), and the flag is in **both** cache keys,
because the cheap answer carries no `weeks` and a null `proj` on every league.
`managerDataRequirements` derives it exactly as it derives `ktc` and `adp`, so
the `Value` and `Market` presets — one press each — skip the solves entirely.
Measured against 400 leagues × 12 teams × 6 weeks: 1,284ms with them, 58ms
without, and the standings identical across the two.

## The client cache

**There are two caches and they protect different things.** Postgres protects
Sleeper, KTC and the projections host — a route reads what a background sync
stored and never fetches upstream on demand. TanStack Query protects *that* from
the browser: the three manager tabs are three routes, so every navigation
unmounted the hooks holding the answers and re-asked for all of them. One
`QueryClient`, created in `app/providers/query-provider` and mounted at the root
layout (not around the manager subtree — a trip out to another tool and back
would take the cache with it), is the only browser-side cache of these routes.
Nothing is stored on the device: a reload starts empty, which is the difference
between this and the `local-store` preferences.

Four rules hold it up, and each replaced a specific failure:

- **A key is built in `shared/manager-query`, never at the call site.**
  Everything manager-scoped hangs off `manager(searched)`, lower-cased (Sleeper
  resolves `Jkap` and `jkap` to one account, and two entries for one manager is
  the duplicate request this exists to remove), and the season is always a
  segment with `"default"` spelled out rather than dropped. **The table is in
  `features/shared` rather than in the manager tool because a second tool reads
  these entries**: the lineup checker draws that tool's subject rail and both of
  its shares sheets, so it asks `/api/user/[username]/{players,leaguemates}` —
  and it keys on the stored account's *username*, so the two tools are one cache
  rather than two answers to one question. `features/manager/query-keys.ts`
  re-exports it for the consumers, its own tests among them, that already read it
  from there. The **ADP board is
  deliberately outside that prefix**: it describes every crawled draft, so it is
  the same answer whoever is being looked at, and a manager-wide invalidation has
  no business throwing it away. Its key is the query string *normalised* to
  sorted pairs, which is what makes the Players tab's column and the drawer's own
  board one request instead of two.
- **Staleness is per query (`query-config`), retention is global
  (`features/shared/query-client`, 30 minutes).** A slice's TTL matches how fast
  that slice moves — the background loops' own rule — so ranks are five minutes
  and a KTC scrape refreshed daily is fifteen. They are all shorter than the
  server's TTLs on purpose: a stale client read costs a request the server
  answers from its cache, where a stale server read costs a fetch to somebody
  else. That sentence was written here before it was true of the numbers —
  ranks matched their server TTL exactly and both ADP boards outlived theirs —
  which is why the ordering is now asserted across the seam in
  `features/shared/cache-layering.test.ts` rather than asserted in prose.
- **A refetch follows a revision, never an array identity.** The five manager
  sub-resources read what the leagues sync writes, and they used to re-fetch on
  the identity of the leagues array — five requests per rebuild of a list that
  may not have changed. `leaguesRevision` is the honest signal, and it is two
  halves because one alone is wrong: a content digest (ids, status, records) for
  what the payload carries, plus a **refresh sequence** for what it doesn't —
  rosters are not on this payload at all, so a sync that persisted a waiver claim
  changes nothing visible while making every dependent read stale. A new revision
  invalidates `dependentManagerQueryKeys` and nothing else.

  **The comparison belongs to the *entry*, not to whoever is reading it, and
  that is the correction worth knowing.** It lived in `useFilteredLeagues` as an
  effect over the last revision *that mount* had seen — correct about the
  navigation it was written for (arriving from a sibling tab is a first sighting,
  and the data behind it is what those queries already read) and wrong about the
  entry it watched, which **three** tools write: the manager tabs, the pick
  tracker's picker and the lineup checker's list all stream
  `/api/user/[username]/leagues` under one key. So a refresh either of the other
  two ran while the manager tool was unmounted landed a new revision in the
  cache, the manager page came back and read it as *its* first sighting, and
  nothing was invalidated — stale shares for up to ten minutes, stale KTC and ADP
  valuation for fifteen. `features/shared/leagues-cache` is the fix and it is one
  function: `publishManagerLeagues` reads the cached revision, writes the new
  state, and invalidates the dependents when the two differ. Every reader passes
  it as the stream's `publish`, so the invalidation happens whoever ran the
  refresh and whether or not anything is mounted to notice. Three things hold it
  up. **An absent revision on either side is never a change** — an empty cache is
  a first population with nothing on screen to be stale, and a `progress` state
  from a cold sync carries the empty string by construction. **It cannot loop**,
  because `dependentManagerQueryKeys` excludes the leagues entry itself (it is
  the thing that changed, and it already holds the new data) and the board (a
  fact about the crawled database, not about this manager). And **there is one
  mechanism**, not two: the mount-local effect is gone rather than left running
  beside it.
- **A stream is published into the cache, not resolved at the end.** The leagues
  route sends cached leagues and then refreshed ones over one connection; a query
  that resolved once would sit on a loading screen through a refresh the server
  had already half-answered. `fetchManagerLeagues` writes every state it reaches
  into its own entry and *then* resolves with the last. Its error handling
  follows from that: a failure with a payload already sent is a `refreshError`
  **field**, so the cached leagues stay on screen; only a failure with nothing to
  show throws.

  **An abort is not one of those failures, and treating it as one wrote a lie
  into the cache.** An unmount, a navigation or React Query cancelling the query
  fires the signal the request was given, and the body rejects with an
  `AbortError` — which went straight into `refreshError`, a message the header
  shows and the entry keeps, so a reader who walked away mid-refresh came back to
  "the operation was aborted" written over leagues that had synced perfectly
  well. `isAbortError` (`features/shared/api`, already there for exactly this)
  splits the branch: with a payload in hand the abort costs nothing at all, and
  with nothing in hand it is rethrown as-is, which is what says *cancelled*
  rather than failed — inventing a payload there would file one under an entry
  React Query has just cancelled. Two details ride along. The published state
  still clears `refreshing`/`progress`, because only a message clears those and
  no further message is coming, so a remount inside the stale window would
  otherwise spin forever. And the bail-out cancels the reader, since an aborted
  body is *errored* and `cancel` on an errored stream rejects with that same
  error — swallowed there rather than surfacing as an unhandled rejection.

- **A read is enabled by what is on screen, and on these two lists "on screen"
  means the columns.** Splitting one payload into four routes stopped the League
  Details panel *waiting* on all four; it did not stop it *asking* for them, and
  the two facts look identical in a network waterfall diagram only until you
  notice that the week read a lineup checker was opened *for* is queueing behind
  a season-long lineup solve nothing on that panel draws. Opening the lineup
  checker fired `./week`, `./outlook` and `./values` every time; opening a season
  panel at its defaults fired `./values` against a board neither table was
  pointed at. This is `managerDataRequirements` one grain down — the leagues
  list had already learned it, where a board of four projection columns was
  paying for a KTC valuation and an ADP pricing it drew nothing from — and
  `leagueDetailNeeds` is the same answer over the same mechanism: each metric in
  both catalogues declares what it `reads`, required so a metric added later
  cannot forget, and declared rather than inferred from its display `group`,
  because what a bay is *called* has no business deciding whether a request is
  made.

  What is worth knowing is that the three reads are **not** the same kind of
  thing, and treating them uniformly would have been wrong in two different
  directions. `values` is column-driven and nothing else: no part of the panel's
  structure reads a price, and even the footnote naming the board is drawn only
  while a KTC or ADP column is selected. `week` is not column-driven at all — it
  is the panel's *subject*, so a panel that has one always asks (the lineup each
  half lists, the start/sit marks, the kickoff on every row and the median bar in
  the head are all that payload) and a panel that hasn't has nothing to ask for,
  which is why a `week_proj` column aimed at a season panel makes no request and
  says so in words. `outlook` is both, and that asymmetry is the whole judgement:
  on a season panel it is structural in exactly the way the week payload is on a
  week one — the roster halves list `optimal` as their starters, the bench under
  it is ordered on the season's projected points, the standings rows are ranked
  by `weekly_optimal_points` — so it is required there whatever the columns say,
  and on a week panel every one of those readings comes off the week instead and
  it falls back to being column-driven.

  Two details carry it. **The needs are derived above the loaded panel**, not
  inside it: `Panel` renders only once the core has landed, so deriving them
  there would have put every enrichment *behind* the read it is supposed to run
  beside — a split turned back into the waterfall it replaced, and one that would
  have looked fine in review. The selections come off `localStorage` and need no
  fetch, so there is nothing to wait for. And **an open columns editor widens the
  needs**, on the leagues list's own precedent: the dialog previews every metric
  in the catalogue against the panel's subject, and a bay of em dashes is a
  picker nobody can read. It follows the editor's `mounted` latch rather than
  whether it is open, so a preview that filled in never empties again — and by
  then the reads are cached anyway.

  **What a disabled query does *not* do is forget.** React Query keeps the entry,
  so a column aimed away and back inside `LEAGUE_DETAIL_STALE_TIME` re-enables
  against the same key and is answered from the cache. That is what makes the
  gating safe to have: the cost of being wrong about a column is one request the
  reader's press would have made anyway, not a round trip per press.

  **Two things a week panel used to draw off the outlook it happened to fetch go
  with it, and they are worth writing down rather than discovering.** The
  under-the-tables caveat about a league whose scoring Sleeper doesn't fully
  project reads `unprojected_scoring`, and the "these slots left out" line over a
  roster reads `unknown_slots` — both fields of the outlook payload, and neither
  is on the week one. The caveat is the one that matters, because it fires on
  nearly every league (almost all of them start a team defence and weight events
  Sleeper doesn't project), so the lineup checker loses it. It is not a *wrong*
  answer — an absent outlook is the state that payload failing has always
  produced, and every consumer already draws it correctly — but it is less than
  the panel said before. Restoring it is a contract change and not a client one:
  `unprojected_scoring` is a fact about a league's scoring against a week's
  projection vocabulary, so it could ride on `LeagueWeekViewPayload` and be read
  from whichever of the two landed. That is the fix if the caveat is wanted back;
  computing it on the core read is not, since the core is what the first paint
  waits for. The bye-week arrangement loses a little too — with no outlook the
  standings falls back to the order the server sent, which is the same degradation
  a failed projections read has always produced.

  There is one on the season panel as well: `hasNumbers` gates a table's value
  columns off when nothing could fill them, and it reads the *board* as one of its
  three sources. A league that cannot be projected at all (no scoring on file, or
  a season with no weeks left) opened with projection columns used to draw two
  headed columns of em dashes on the strength of a KTC board it was not showing,
  and now draws no columns. That is the gate's own stated intent — "so a
  `start / bench` label doesn't promise a breakdown that isn't there" — arriving
  where it was previously defeated by data fetched for a column nobody had
  selected.

The fetchers and the keys are pure modules with relative `.ts` imports, so the
cache's behaviour is tested by driving `QueryObserver`s directly
(`query-cache.test.ts`, `league-cache.test.ts`) — the assertions are request
*counts*, which is what the work was for, and the enablement ones drive the real
`leagueDetailNeeds` rather than a mirror of it, so the derivation under test is
the one the panel runs. `query-test-support.ts` is the `fetch` mock and the test
client; it is not a `.test.ts` because the runner globs those.

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

**Skipping and waiting are different locks, and picking the wrong one is how a
loop stacks or a request lies.** `withAdvisoryLock` never waits: a caller that
loses the race returns `null`, meaning "someone else is doing this" — right for
the background loops, where queueing behind another instance would pile ticks up
instead of shedding them. `withBlockingAdvisoryLock` waits in `pg_advisory_lock`,
which is right where the caller needs the *result* and not just the work done —
a manager's league sync, where skipping would hand back an empty page while the
data is being written a connection away. The wait is server-side, so a queued
caller costs one idle pool connection and no polling. Keep it to per-key,
short-lived work; a background loop that blocks is the stacking problem again.

**A bounded wait has a third outcome, and it is not "skipped".** Because the wait
times out (`ADVISORY_LOCK_WAIT_MS`), a blocking caller can come back having done
nothing *while the winner is still writing* — which is the opposite of the other
skip, where the winner finished and left a complete graph. `SyncSummary.locked`
separates them, the field `PlayersSyncSummary.locked` already exists for one
module over: "nothing to do" against "read this again shortly". Both used to
report `skipped: true` and nothing else, so the leagues stream sent whatever the
holder had committed so far — on a first visit a fraction of a manager's
leagues — stamped `stale: false` with a summary, which the client cached, closed
its progress bar on, and counted as a completed refresh (invalidating all five
dependent reads against a list still being filled in). The rule generalises past
this one caller: **whatever a lock-loser hands back, the thing it must never say
is that the data is final.**

**And a lock-loser is only one of the three ways a sync ends short, which is why
"how fresh is this" and "how recently did we try" are two columns.**
`manager_syncs` has carried `synced_at` and `attempt_at` since the crawler
landed, with exactly those meanings, and `syncManagerLeaguesLocked` advanced
both on every run — so a Sleeper timeout that dropped three of a hundred leagues
left a partial graph indistinguishable from a complete one for the whole TTL.
Advancing neither is the opposite failure and the more expensive one: the leagues
route decides to refresh on that timestamp, so a sync that stamps nothing after a
failure is the full ~11-requests-per-league fan-out on *every* request until
Sleeper recovers. `shared/manager/sync-freshness` is the split — `attempt_at`
always, `synced_at` only when no league failed — and four things hold it up.
**The two TTLs are deliberately equal**: an attempt buys exactly the quiet the
old lying `synced_at` bought, so a manager whose leagues keep half-failing never
costs *more* upstream traffic than one whose leagues succeed. **One gate
function answers both askers** — the route before it decides to refresh, the sync
again inside the lock — because a throttle read correctly in one place and not
the other is a throttle that isn't there. **A race is never overridden, not even
by `force`**, and it now covers an *attempt* and not just a completed sync:
re-running the fan-out a millisecond after the lock's winner tried is what the
lock exists to prevent, whether or not that try got every league. And
**`SyncSummary.complete` is the only field that licenses `stale: false`** —
`failed === 0` is not it, since a run that did nothing has no failures to report
and no claim to make either. The client shows the two counts (`97 of 100 leagues
refreshed`) and only where leagues actually failed: a locked sync has its own
note, and a throttled skip is ordinary operation, so warning on either would put
a permanent band on the plate.

**A per-key lock is computed, not listed** — `managerSyncLockKey(userId)` hashes
the id into the object slot under one class id, because you cannot enumerate
every manager in `LOCK_KEYS` ahead of time. The rule above still holds for the
fixed locks; this is the escape hatch for a lock whose identity is data, and it
is why the class id is what's reserved rather than the pair. **There are two such
classes now** (`HASHED_LOCK_CLASSES`), and a second one rather than a shared
namespace is the point: `leagueSyncLockKey(leagueId)` hashes ids from the same
alphabet as the manager keys — Sleeper's are all digit strings — so one class
would let a manager's sync and an unrelated league's refresh take turns on a
collision between two ids that have nothing to do with each other. A third grain
wants a third class, not a longer key. Both helpers drop
the connection when *unlock* fails rather than returning it to the pool: a
session lock outlives `release()`, so a recycled connection would hold the key
until the process dies.

`isFresh` judges a **whole table** by its newest `updated_at`, so it only fits a
cache that is replaced all at once (`players`, `ktc_values`). A table holding
independently-refreshed slices needs its own gate, or writing any slice marks
every slice fresh — `projections` is per `(season, week)`.

**Judge that gate by whether the fetch happened, not by whether it left rows.**
The projections gate used to read the `projections` rows themselves, which is
wrong for the case that matters: a week Sleeper hasn't published yet stores *no*
rows, so it read as never-synced and came due again on every tick — refetched
every 15 minutes for as long as the window before publication lasts, and, because
the horizon budget takes the earliest stale weeks first, able to crowd published
weeks out of the per-tick cap indefinitely. `projection_week_syncs` stamps
`(season, week)` on a **successful** fetch whether or not it returned anything,
so an empty week waits out the same TTL as a full one. A *failed* fetch stamps
nothing and retries next tick, which is the one case that should stay eager. The
general shape: when "nothing came back" is a legitimate answer, freshness is a
fact about the sync and belongs in its own table, not inferred from the data.

The same trap has a second instance worth recognising, because it does not look
like a freshness bug at all. A league Sleeper has deleted answers 200-with-null
forever, so its `updated_at` never advances and it occupies a slot in every
refresh rotation — one wasted request per pass, and live leagues get crowded out
as deletions accumulate. `leagues.gone_at` marks it and the crawler skips it; the
row and its drafts **stay**, because they still feed ADP, and a manager-driven
sync that finds the league alive again clears the marker. Deleting the row would
have thrown away good data to fix a scheduling problem.

Refreshing a slice that can shrink means **upsert then delete what's missing, in
one transaction** — an upsert alone leaves rows that quietly look current
(`shared/projections/sync`). Guard the delete on a non-empty fetch, so an
upstream hiccup returning nothing can't empty the slice.

**Which slices earn that guard is decided by whether one can legitimately be
empty, and the league graph carries both answers.** `manager/persist` replaces
seven collections; users and rosters can never be empty for a live league, so
`[]` there is a failed request wearing a successful answer — `sleeperGet` folds
Sleeper's 200-with-null into the fallback without throwing, so nothing raises
and the transaction commits the wipe. An emptied `rosters` drops the league out
of every member's list, since `FIELDED_A_TEAM_SQL` reads a roster to decide one
was fielded. Traded picks, transactions and matchups *do* empty legitimately — a
redraft league trades no picks, a quiet week has no moves — so guarding those
would leave rows that quietly look current, which is the failure the rule above
is about. The guard is free when the answer is honest: a league that genuinely
has none of a collection has none stored either, so the skipped delete had
nothing to delete. A refusal is logged, because the sync reports the league as
synced either way and the answer that tripped it arrived as a 200.

**A cascading delete is a destructive write in a table you did not name.**
`DELETE FROM drafts` cascades to `draft_picks`, so an empty drafts fetch used to
take the league's ADP corpus with it — permanently for a league Sleeper has
since deleted, since the crawler tombstones it and never fetches its graph
again, and those picks are exactly what `gone_at` keeps the row around to
preserve. Drafts are **upserted** rather than replaced (Sleeper does not drop a
draft from a league, and one it stopped listing is the row worth keeping), and
picks are replaced per draft that actually returned some — scoping that delete
to the drafts present in the payload is what stops one draft's failed fetch from
emptying another's.

`NUMERIC` columns come back from `pg` as **strings**, not numbers. Cast in the
query (`pts_ppr::float8`) rather than converting in TypeScript, so a value is a
number by the time it leaves the query layer.

**`ON CONFLICT DO UPDATE` does not deduplicate a multi-row INSERT.** Postgres
refuses the whole command — "cannot affect row a second time" — when one
statement carries the same key twice, so the clause covers `bulkInsert`'s chunk
boundaries and nothing inside a chunk. A payload whose natural key could repeat
is deduplicated in code first — `dedupeBy` in `manager/dedupe`, which every keyed
collection in the league graph goes through and which `manager/matchups` spells
the roster-week key for — because what a duplicate costs otherwise is the
league's entire sync transaction, every collection in it, and it repeats on every
retry since the payload is what triggers it. Composite keys are joined with `:`,
which is safe only because no part can carry the separator (Sleeper's ids are
digit strings, its seasons four-digit years); a key with a free-text part wants a
different join. **A conflict clause is still worth having where the delete cannot
cover the insert**: `transactions` is replaced by week and keyed by
`transaction_id` alone, so a transaction arriving under a different week from the
copy stored — a null `leg`, or a refresh window that has moved past where it was
filed — meets a row the delete never saw.

Schema: nested Sleeper payloads (settings, scoring, metadata, id arrays) stay
`JSONB`; promote a column only when it gets queried or joined on. Migrations are
plain SQL in `db/migrations`, applied automatically on boot.

Filtering *on* those blobs takes two habits:

- **Regex-guard a numeric cast before making it.** Sleeper omits its defaults
  and doesn't promise types, so a bare `(settings->>'type')::int` fails the
  whole query on the one league holding a junk value. Write
  `CASE WHEN settings->>'type' ~ '^[0-9]+$' THEN (settings->>'type')::int ELSE 0
  END`, and let the fallback match what the client already assumes (a missing
  `type` is redraft — see `features/shared/league-filters`).
- **Parenthesise a SQL fragment you intend to reuse.** Call sites append their
  own comparison, so a fragment ending in `= 1` makes `${FRAG} = $1` a chained
  `=`, which Postgres rejects. `shared/manager/adp` builds its `WHERE` this way.
- **A CTE whose column is one of those fragments must be `AS MATERIALIZED`.**
  Postgres 12+ inlines a CTE referenced once, which is normally the right call
  and is exactly wrong when the column is a JSONB extraction plus a regex plus a
  cast: inlining pushes that expression into every `FILTER` of every aggregate
  above it. `/api/adp`'s board has ten, so a fact about a *draft* — 6,963 of
  them — was recomputed once per pick per aggregate, ~11M jsonb lookups and ~11M
  regex matches that appear nowhere in the query as written. One keyword took
  the read from 2,872ms to 590ms over 1.5M picks, and ~2.2s to ~0.5s end to end.
  The tell is that the cost is invisible in the SQL and only shows up in a plan,
  where the expression is printed out once per aggregate. A subquery in `FROM`
  is not affected (`countMatchedDrafts` evaluates it once per draft either way);
  it is the single-reference CTE that inlines.
  **The covering indexes beside it are a *consequence* of that fix, not an
  independent one** (`draft_picks_adp_board_idx`, `…_player_idx`): on their own
  they make the board *slower* — 2,280ms to 2,900ms — because they move the
  planner to a nested loop that does the expensive per-row work more times.
  Materialized first, then indexed, 597ms. Neither half should be reverted
  without the other.
- **And the planner needs *statistics* on such a fragment, or it estimates the
  same number of rows whatever you asked for.** Postgres keeps none for an
  expression, so `SCORING_SQL = ANY(...)` fell to its default equality guess of
  0.005 and every board came out at **9 rows** — against 1,400 to 3,800 actual,
  because a constant guess cannot vary with the board. What that buys is the
  wrong plan: at 9 rows a nested loop over `draft_picks` looks free, so one board
  of a manager's ADP valuation ran 1,404 loops of an index scan over a
  164-player `= ANY` (719k buffer hits) and a `GroupAggregate` whose sort spilled
  to disk having budgeted 550 rows against 146,139. `CREATE STATISTICS` on that
  expression (`leagues_scoring_bucket_stats`) is the whole fix: the slow board
  1,170ms → 163ms, `/api/user/…/adp-value` 1,803ms → 687ms, and `/api/adp`'s own
  board read 873ms → 287ms. Four things hold it up. **It is the scoring
  expression alone, measured rather than minimal** — statistics on `SUPERFLEX_SQL`
  beside it change nothing (163ms either way), since 3,646 drafts × 0.005 × the
  0.5 a boolean expression is assumed to select is exactly the 9 that came out;
  it could not be added anyway, because it counts slots with a sub-select and
  `CREATE STATISTICS` rejects a sublink (`0A000`). **The expression in the
  migration has to stay textually the one in `adp.ts`**, since the planner
  matches a statistics object by comparing parsed expression trees — change the
  buckets or the regex and this silently stops applying, with no error and no
  warning, just the 0.005 guess and the nested loop back. **The migration runs
  `ANALYZE`**, because creating a statistics object collects nothing and on a
  table that is only ever upserted autovacuum may not come for a long time.
  And **it is not a substitute for `AS MATERIALIZED`** — inlining is still twice
  as slow again (2,252ms on the same board): that keyword stops the expression
  being recomputed per pick per aggregate, this stops the row count above it
  being a fiction.
- **A plan that is wrong for one shape is not wrong for all of them, so measure
  every shape before reaching for a switch.** The obvious reading of the above is
  "the nested loop is the bug", and forcing a hash join does fix the bad board
  (1,135ms → 200ms) — while making the other three *worse* (37→224, 54→232,
  330→612), for no net gain across the four. The nested loop is right whenever
  the estimate is; what was broken was the estimate. Reach for better statistics
  before a different plan preference.

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

**Every loop has a switch, and there is one switch over all of them**
(`shared/util/background-jobs`). Three of the four already had one and KTC had
none, which made "web dyno serves, worker dyno crawls" impossible to express
however the other three were set — so `BACKGROUND_JOBS=off` disables the lot and
the four per-job variables keep the names they had (a rename would quietly turn
a loop somebody had deliberately disabled back on). Four things about it:

- **The deployment it buys is one variable**, not a second entry point: the same
  image runs twice, `BACKGROUND_JOBS=off` on the web dyno and nothing set on the
  worker. Migrations run on boot in both, so their start order doesn't matter.
  Nothing is required locally — unset, every loop runs as it always has.
- **The switch is scheduling; the lock is correctness, and neither substitutes
  for the other.** Turning a loop off on the web dyno is what stops it competing
  for the pool; the advisory lock is what makes a second worker started by
  accident cost a skipped tick instead of a doubled scrape. Removing either
  because the other exists is the mistake to watch for.
- **The master switch is checked first**, so a job added later is off on a web
  process without a second edit — the failure it prevents is a new loop nobody
  remembered to disable there.
- **Only the exact word `off` disables anything.** Absent, empty, `on` and junk
  all run: a typo that stopped the syncs would leave the database quietly
  unfilled for hours with nothing failing, where a typo that leaves them running
  is visible at once.

The crawler is the loop that most wants that separation, and for a reason
`shared/manager/sync-admission` already spells out from the other end: its
advisory lock spans the whole sync, network included, so it holds a pool
connection across a league's entire Sleeper fan-out. That is deliberate and
cannot be shortened (released before the fetch, two instances both decide a
refresh is due), which leaves *where the loop runs* as the only lever.

Two cadences, and the choice matters:

- **Interval equal to the TTL, forcing on scheduled ticks** (`ktc`) — for a
  single cache refreshed as a whole, where jitter would otherwise skip a cycle.
- **Interval a fraction of the TTL, never forcing** (`projections`) — where the
  gate is per-slice and a tick that finds nothing due costs one query. Forcing
  here would re-download megabytes of unchanged data on every tick, all
  offseason.

A slice's TTL should match how fast *that slice* moves, not the table's. The same
projections sync runs two: this week and next are gated at an hour because an
injury designation changes them, and the rest of the season at a day because it
doesn't. One gate for both would have to choose between a stale lineup and 90MB an
hour. Where the slow tier is also large, cap how many slices a tick will fetch
(`HORIZON_WEEKS_PER_TICK`) and report what the cap deferred — a skipped slice that
reads as "fresh" is how a backfill silently stops advancing.

The league crawler is the third instance of that rule, varying on time instead of
slice: every league moves at the same speed *at once*, and what changes is the
season, so `manager/crawl-ttl` picks one TTL per tick from live NFL state — 15
minutes in-season, an hour through the 75-day window before kickoff (draft season
feeds the ADP board, where "the last 30 days" is a real question), six hours in
the deep offseason. Only `"regular"` is matched by name: Sleeper labels most of
the offseason `"off"` and flips to `"pre"` only around the preseason games, so
the window before `season_start_date` decides the rest, and a missing or
unparseable date fails toward the *fresh* tier — extra fetches are the failure
you can see. A TTL is also a capacity claim, not just a freshness one: the
refresh batch retires 15 leagues a minute, so 15 minutes is honorable to 225
leagues and past that silently stops being a promise. That is why the scheduler
warns when the stalest league is past twice the active TTL, heartbeats when idle
(a drained queue and a dead loop used to log identically), and why
`CRAWL_LEAGUE_BATCH` moves on that telemetry rather than on intuition — the tick
interval is execution granularity, not the freshness period, and halving it
doubles cost for nothing a bigger batch wouldn't do better.

**And once the corpus outgrows that capacity claim, *which* league goes first
starts to matter — `manager/crawl-priority` is the ordering, not a bigger
batch.** Strictly oldest-first is fair and stops scaling: at a thousand leagues
a rotation is over an hour, and the league a reader has open waits behind nine
hundred discovered three hops out through a stranger's membership. So the leagues
that are *already due* are ordered by five tiers — starved, demanded, live,
known, cold — and nothing else about the crawl changes: same batch size, same
tick, same TTLs, same upstream cost. Four things are load-bearing. **The
starvation tier is what makes the rest safe**: past four TTLs overdue a league
outranks everything, because pure demand-first fails silently — the leagues that
stop being crawled are exactly the ones nobody is looking at, so nobody notices
they are stale. Four rather than two, since two is where the scheduler already
warns, and a tier every league enters at once is not a tier. **Demand is
observed, never inferred**: `leagues.last_accessed_at` is stamped by a manager's
league sync (someone searched them) and a league detail read (someone opened its
panel), and deliberately *not* by the crawler — within one rotation every league
would look demanded and the ordering would flatten back out. **The tiebreaker
stays `sync_attempt_at`**, so a league whose fetch keeps failing rotates to the
back of its own tier rather than being retried every tick. And **the `CASE` is
generated from the same table the pure comparator reads**, since a five-armed
ordering written twice is two orderings; the tests pin the arms against each
other, which is the agreement no type can carry. "Recent transaction activity" is
folded into the live-status tier rather than given a column of its own — that is
the one part of the priority list deliberately deferred.

## Operating safety

Six rules that are about the app staying correct and unexploited rather than
about how it is laid out. Each replaced something that read as fine and wasn't.

- **A route that spends someone else's budget is an operator route.**
  `/api/players/sync` and `/api/projections/sync` are POST-only and require
  `INTERNAL_SYNC_SECRET` in the `x-internal-sync-secret` header; the decision is
  pure and tested in `shared/internal-auth/policy.ts`, the `NextResponse` half is
  `app/api/internal-auth.ts` — the same split, for the same reason, as
  `resolveManagerUser` / `resolveManagerRequest`. Three details are load-bearing.
  **Unconfigured is 503 in production**, never a pass and never a 403: failing
  open would leave the endpoints exactly as exposed as they were, and a 403 makes
  a missing variable indistinguishable from a wrong secret at 3am. **GET is 405**,
  because a request that pulls tens of megabytes off Sleeper is a state change
  whatever method it wears. And **a lost advisory lock is 409**, not a 200
  describing someone else's run — which is what `PlayersSyncSummary.locked` was
  added for. The public manager routes stay public; what
  `/api/user/[username]/leagues` stops honouring from an anonymous caller is
  `?refresh=1`, the knob, not the read. The blocking lock those routes sit on is
  bounded now too (`ADVISORY_LOCK_WAIT_MS`, enforced by Postgres' own
  `lock_timeout`), because an unbounded wait holds one pool connection per stuck
  key and the keys are per manager.
- **Judge a destructive reconciliation by whether the payload is a payload.**
  Both syncs replace-and-delete, and both used to guard that on `length > 0` —
  which every interesting failure passes. A 17-player KTC "board" nulls the other
  480; a truncated projections week deletes the ~760 players it omits. So
  `ktc/validate` and `projections/validate` are the gate, they run **before the
  transaction opens**, and a refusal writes nothing *and stamps nothing* — no
  `updated_at`, no `projection_week_syncs` row — so the next tick simply tries
  again. Each carries the same three checks: an absolute floor, a maximum shrink
  against what is stored, and a duplicate rule; and each treats **zero stored as a
  first sync**, where only the floor applies, so a cold database still fills. The
  numbers are named constants with the reasoning on them, because a threshold
  without a rationale is a threshold someone will tune to zero.
- **A manager is stamped only once every league discovered for them is in.**
  Stamping suppresses that manager for the six-hour enumeration TTL, so stamping
  alongside a failed league loses the league until some *other* member of it comes
  up. `shared/manager/discovery.ts` holds it: `syncLeagueGraphs` reports
  `loadedIds`/`failedIds` rather than counts, and the stamp is an **intersection
  against ids**. Counts can't answer this, because two managers can share an
  unknown league — attribution is deduplicated nowhere, only the *fetch* is, so a
  shared failure unstamps everyone waiting on it. The same file owns
  `remainingDue`: a tombstoned league leaves the queue as surely as a refreshed
  one, and counting only the refreshed ones overstated the backlog the scheduler
  warns on.

  **That rule needs a bound, because a permanent failure is not a failure to
  retry — and unbounded it wedged the whole pass, not just the manager.** An
  unstamped manager sorts to the *front* of `pendingManagers`, so a league
  Sleeper has deleted — which fails its first sync every time — held its managers
  at the head of the queue forever: the same dead leagues re-fetched every tick,
  discovery finding nothing for anyone, and the corpus stopped growing. So
  `partitionSyncFailures` re-asks for the league itself before deciding, and a
  null answer tombstones it through `persistGoneLeagues`. **The probe is a
  second signal, not a re-read of the first** — a first sync fetches half a dozen
  child collections, so the error it throws cannot tell a deleted league from a
  Sleeper hiccup, and only the league endpoint can. The refresh pass takes the
  same answer through `markLeaguesGone`, which is why `getLeague` folds 404 into
  Sleeper's usual 200-with-null rather than throwing — the two spellings mean one
  thing, and a 404 that threw left the league due forever.

  **The write is the fix, and the tombstone was only ever half of it.** That
  paragraph read as though *deletion* were the wedge, so the bound it describes
  covered exactly one cause: the league is unknown to us, a marker with no row
  has nowhere to live, so `persistGoneLeagues` writes the row and every member
  stops rediscovering it. But nothing about the wedge needs the league to be
  dead — **any** first sync that fails every time holds its managers at the head
  of `pendingManagers` forever, and the crawler duly wedged a second time on
  leagues Sleeper was still serving perfectly well (a 404 from one *child*
  endpoint, which the league endpoint cannot see and the probe therefore
  cleared). So a league Sleeper still serves is now written down too —
  `persistUnsyncedLeagues`, a bare row with no children — and the hold is
  released by the league being **recorded** rather than by its syncing.
  `unrecordedFailures` is that rule, and what is left blocking is the residual
  it names: a failure the tick held no payload to write a row from. Four things
  hold it up:
  - **Discovery finds leagues; the refresh pass retries them.** A parked row is
    known, so discovery never selects it again, and refresh claims in bounded
    batches, stamps `sync_attempt_at` as it claims so a league that keeps failing
    rotates to the back of its own tier, and re-probes `getLeague` first — which
    is where a league that turns out to be deleted gets its tombstone, with a
    fresh answer rather than a guess. Retrying was never discovery's job, and
    doing it there is what had no bound.
  - **The row is written before the manager is stamped**, so a write that throws
    takes the tick with it and nothing is suppressed. Stamping first would retire
    a manager for the enumeration TTL on the strength of a row that may not
    exist, which is the one way a league is lost for good rather than merely
    late — and it is why `unrecordedFailures` takes the ids actually written and
    never the ids intended.
  - **An ambiguous probe now parks instead of staying retryable**, which is a
    straight inversion of what this used to say and is safe only because of what
    it is inverted *into*. A probe that throws had to stay retryable while the
    only other bucket was a permanent tombstone; parking claims nothing about
    whether the league exists, so an unconfirmed league goes there and the
    refresh pass asks again.
  - **A parked row takes `updated_at`'s default**, so the retry is a freshness
    TTL out rather than the next tick. Due immediately, a league that cannot sync
    would be reclaimed every tick and the wedge would simply move to the pass
    that absorbed it.
- **The season is resolved, not compiled in.** `DEFAULT_SEASON` was a release note
  disguised as a string. `shared/season` is an override (`NFL_SEASON_OVERRIDE`),
  then Sleeper's `state/nfl` on a six-hour cache, then that constant as the floor.
  Three rules make it safe in front of every request: an upstream outage falls back
  to the last resolved value (and a failed attempt does **not** re-stamp the cache,
  so recovery is immediate rather than waiting out a TTL nothing earned); a cached
  value outlives its TTL when nothing better exists; and **an explicitly requested
  season never comes here** — `?season=2024` is the caller's answer and historical
  routes stay deterministic. Call it where a season would otherwise be *defaulted*
  — a route with no `?season`, a background tick — and nowhere else. A page that
  reads it must not be prerendered (`/trades` is `force-dynamic`), or the
  resolution is baked into the bundle and it is a hardcoded constant again.

  **That last rule is broken by evaluation order, not by intent, and it takes a
  predicate to keep.** `parseAdpFilters(params, await getActiveSeason())`
  evaluates the argument first, so a historical read waited on a state call whose
  answer the parser would then discard — and the ADP default is subtler than "is
  `season` absent", since a date bound bounds the board too. So the parser's own
  branch is exported as `usesDefaultSeason` and the route gates on it: one
  function, so the two cannot drift, and the argument is `string | null` where
  null means the caller checked. It is refused rather than defaulted on the path
  that does read it, because an unbounded board with no season silently spans
  every season on file — the one wrong answer here that looks like a working one.
  The tests assert the agreement itself: for each shape, whether the predicate
  says the default is read matches whether omitting it changes the answer.

  **And a request never waits on Sleeper for a value this process can already
  answer.** A stale cache is served *now* and refreshed behind the request, so
  the rollover lands on the next caller rather than costing the one that found it
  expired up to four attempts with backoff. A cold process still waits — there is
  nothing to serve, and the compiled-in constant is the release note this exists
  to stop trusting — so what bounds that case is a short failure backoff: a
  failed attempt is remembered for a minute, and only the *cache* stays
  un-re-stamped. That is the "recovery is immediate" promise intact (a minute,
  not six hours) while a down upstream costs one timeout ladder rather than one
  per request.
  The UI's `nfl-calendar` is the *separate* concern: it derives provisional
  markers past its table (Thursday after Labor Day, the Thursday in April 23–29,
  preseason at −35/−12 days) so the ADP strip doesn't expire, bounded by the
  window being drawn rather than by a clock — so server and client renders agree.
- **Encrypted is not verified, and the difference has to be written down.**
  `DATABASE_SSL_MODE` is `disable` / `verify-full` / `insecure-require`, defaulting
  to the first for localhost and the second everywhere else; `DATABASE_CA_CERT`
  supplies a provider's chain (unescaping `\n`, which is how a pasted certificate
  arrives). The old behaviour survives under `insecure-require` — the name is the
  point, since it was previously reached by *default* under an option spelled
  `require`. An unrecognised mode throws. Beside it, a missing `DATABASE_URL` is
  fatal in production: `instrumentation.ts` throws before starting a single loop,
  because "alive but connected to libpq's defaults" is worse than not booting.
- **Every wait is bounded, and bounded shorter than the deadline the request is
  already under.** `shared/db/budget.ts` holds the arithmetic: one platform
  deadline (Heroku's router, 30s) and four shares of it — connect, lock wait,
  statement, and how much of the pool one request may hold. It replaced four
  unbounded waits that each looked local and were one failure between them. A
  route with no `connectionTimeoutMillis` does not fail when the pool is full,
  it *queues*, so the platform answers 503 on its behalf at 30 seconds while the
  dyno keeps working; with no `statement_timeout` the query underneath runs to
  completion holding the connection the next caller is queueing for; and the
  browser, told only that the request failed, asks again. That is the whole
  spiral — the observed end of it is the role's connection limit (`53300`) in a
  background loop that was doing nothing unusual. Four things hold the fix up,
  and each is undone by treating one number as independent of the others:
  - **The shares are ordered connect < lock wait < statement < deadline**, and
    the ordering is load-bearing rather than tidy. `lock_timeout` being the
    shorter of the two bounds on a contended advisory lock is what keeps a
    caller that lost the lock reported as one (`55P03` →
    `AdvisoryLockTimeoutError`) instead of as a cancelled query — the same
    distinction `SyncSummary.locked` exists to draw. `budget.test.ts` asserts
    the ordering, not just the values.
  - **One pool per process, cached on `globalThis` in production too.** The old
    guard was dev-only, on the HMR reasoning; production is the case that cost
    something, because a route bundle carrying its own copy of `pool.ts` gets
    its own `max` and nothing in the process can tell. The ceiling that matters
    belongs to the *role*, not to the pool: a small managed plan caps every
    dyno, review app and `psql` session at 20 between them, which is what
    `DATABASE_POOL_MAX` is for.
  - **A fan-out whose width is data is bounded to a share of the pool**
    (`collectWithConcurrency`, `budget.fanout`). `Promise.all(items.map(…))` is
    the shape that reads as harmless: over a list that grows with the account
    being looked at, and where each unit holds a connection for its whole
    duration, it is one request holding more of the pool than the pool has —
    `/api/user/…/adp-value` priced six ADP boards with two queries each, so two
    readers took every connection on the dyno. A fixed-width fan-out over units
    that are mostly *network* is not this (`LEAGUE_FETCH_CONCURRENCY` stays as
    it is, tuned against Sleeper's budget).
  - **Out of budget is a 503, not a 500** (`isDatabaseBusy` →
    `app/api/read-failure.ts`, the same pure/`NextResponse` split as
    `resolveManagerUser`/`resolveManagerRequest`). The two want opposite things
    from a caller: a 500 says stop asking, and asking again is exactly right
    when the database merely had no room. It is applied at **every** route that
    catches a read rather than at the ones that were seen to be slow — a rule
    held by two routes of fourteen reports the twelfth as a bug in itself.
  - **A read that is only a bonus still fails as a failure**, which is the half
    of that rule the League Details split got wrong for as long as it existed.
    `…/week` and `…/outlook` each caught their read and returned `null`, which
    the route sent with a 200, on reasoning that is *correct*: these are two
    columns on top of a panel whose point is the rosters, so a read that cannot
    answer should cost the columns and not the league. What was wrong was the
    spelling. A 200 says the request worked, and three things follow from that
    which nobody chose. The query client's retry never runs, because there is no
    failure to retry — the one retry the app configures is spent on failures, so
    the read least worth giving up on was the one never asked again. The `null`
    is cached as a *successful* answer for `LEAGUE_DETAIL_STALE_TIME`, so a
    database busy for one second costs the panel its lineups for five minutes,
    and closing the card and reopening it inside that window serves the failure
    back without asking anyone. And nothing at any layer can tell it from a
    league that genuinely cannot be projected, because on the wire it is the
    same byte.

    The failure was invisible in exactly the way the `start_time` one was: every
    layer degraded politely, the em dash it produced is the em dash the real
    empty case produces, and the tests passed throughout because they construct
    payloads rather than failures. **A fallback that fires on a failure and looks
    like the success case is indistinguishable from working.**

    So the rule is the one the em dash already implied and the wire did not
    carry. A **null body means the domain answered "nothing"** — for `…/outlook`,
    a league with no slots on file, no scoring settings to score with, or no
    weeks left on the schedule, which is a fact about the league and stays a 200.
    An **operational failure is a failure status**, through `readResponse`
    (`app/api/read-response.ts`), which is `withReadTiming` +
    `readFailureResponse` and no policy of its own — the point is to have one
    place the next enrichment route falls into rather than a second copy of the
    decision. And **a route whose loader cannot return null has no null on the
    wire at all**: `getLeagueWeekView` is `Promise<LeagueWeekView>`, so every
    null `…/week` ever sent was a caught exception, and `LeagueWeekPayload`
    stopped being nullable so there is nowhere for one to re-enter. The
    serialiser takes the view rather than `view | null` for the same reason —
    that null branch *was* the seam.

    The graceful half is untouched, and it never lived in the route: the
    enrichments are separate queries, so `useLeagueDetail` reads whichever have
    answered and only the core's error is the panel's error. What changed is that
    the query underneath now knows it failed. `read-response.test.ts` asserts the
    response for each outcome (a value, a legitimate null, each of the four busy
    spellings, a broken read, a non-`Error` throw, a synchronous throw);
    `league-routes.test.ts` asserts that the two routes still go through it,
    since a route that quietly went back to catching its own read would pass
    every other test in the repo; and `league-cache.test.ts` asserts the client
    end — a failed enrichment is an errored query with no data, a `200 null` is a
    success, the retry runs on the first and not the second.

## Testing

`npm test` runs Node's built-in runner over `src/**/*.test.ts` through `tsx`.
No framework, no build step — but not bare `node --test` either: Node 22's
TypeScript stripping is behind an experimental flag and is not on across the
22.x range `engines` allows, so that command fails with
`ERR_UNKNOWN_FILE_EXTENSION` before a single test runs.

Two constraints follow from that, and they shape where logic should live:

1. **Test files import with an explicit `.ts` extension** (`./parse.ts`).
2. **A module under test must have no runtime imports it can't resolve** — so a
   tested module uses `import type` only for cross-module dependencies (those
   are erased), and does no network or database work.

That is why `ktc/parse` and `ktc/match` are pure and take their inputs as
arguments. Keep new logic that's worth testing on the same side of that line:
thin I/O wrappers, pure logic underneath.

`shared/manager/adp-filters` is the same shape for a route: it validates the
query string and nothing else, so the SQL beside it only ever sees checked
values. It takes the default season as an argument rather than importing
`DEFAULT_SEASON` — that import is exactly what would make it untestable.

**Three files carry an ADP name and they sit on opposite sides of the wire.**
Check which side you are on before editing one — the two client files were both
called `adp-filters` at one point, which is the collision this table exists to
keep from coming back:

| File | Side | Job |
| --- | --- | --- |
| `shared/manager/adp-filters.ts` | server | validates `/api/adp`'s query string, and the league ids off a POST body |
| `features/shared/adp-controls.ts` | client, pure | *builds* that request, resolves the date range, seeds the league rules from a league |
| `features/shared/ui/adp-drawer.tsx` | client, UI | the drawer that drives the controls |

**The two client files are in `features/shared` and not `features/manager`,
which is the mover's rule and not a filing preference.** The board describes
every crawled draft, so it was never a fact about a manager; what kept it in
that feature was only that the manager tool read it first. The trades page is
the second reader, so `adp-controls`, `adp-controls-context`, `use-adp`,
`use-adp-density`, `adp-query` (the board's own cache key), the drawer, the
window control (`lookback` and its panel), `range-domain` and `nfl-calendar`
all moved out, and
`features/manager` re-exports each under its old name so its own consumers
read one canonical definition under two names. `shared/manager/adp-filters.ts`
did **not** move: it is the server half, and it was already outside the
feature.

The two ends are a matched pair with no compiler link between them — the client
writes the vocabulary the server parses (the auction exclusion, the
`start_after`/`start_before` dates, the two league-id lists), so a value added on
one side and not the other fails as an ignored parameter rather than a type
error. The league type left that vocabulary entirely: every `/api/adp` answer now
carries the redraft and dynasty boards side by side and the display draws both,
so there is no `league_type` parameter for the two ends to disagree on — see the
drawer's two board columns below for the shape of that.

**The board's league filters left it too, and in the other direction.** Scoring,
superflex, best ball and size were four parameters the client wrote and the
server parsed; they are the shared league *rules* now, which are a predicate
engine over Sleeper's blobs and cannot be re-implemented in SQL without drifting
silently. So the browser evaluates them over `/api/adp/leagues` — every league
with a draft the board could average, the trades board's own arrangement for the
same reason — and sends the answer as `league_id`/`xleague_id`. The server's four
parameters survive because `adpBoardFor` still matches `scoring` and `superflex`
*per league*; nothing on the client writes them any more. `adp-controls` still
derives the scoring bucket to mirror `SCORING_SQL`, and it is now what
`seedFromLeague` writes its `rec` rules as: seeding from a league has to land on
the population that league would actually be counted in, or "match a league"
quietly returns a board of a dozen drafts.

`projections/filters` follows it. The `list`/`integer`/`enumList` primitives
both filter modules use live once, in `shared/query` — a pure module they import
relatively with a `.ts` extension, the same mechanism the tests use, so sharing
costs no runtime dependency. (They used to be copied into each filter module to
avoid pulling a barrel's database code into a tested file; the copies had
already drifted, which is how `booleanFlag` and `booleanFilter` came to be two
named functions — absence means "off" for a flag like `?stats=1` and "don't
filter" for a population filter like `?best_ball=`, and one function silently
serving both meanings is the bug the split names.)

**A date primitive earns its place there twice over.** `isIsoDate` does not stop
at the `YYYY-MM-DD` shape, because `2026-02-31` passes a regex *and* parses —
V8 rolls an out-of-range day forward to March 3 rather than failing, so a bad
bound would silently become a different, real date. It formats the parsed date
back and compares, and only a genuine day survives the round trip. And `isoDate`
returns **the string it was given, not a timestamp**: what a bare date *means* is
a zone question, and here the caller that knows the zone is SQL. Converting to
epoch milliseconds in the parser would bake this process's timezone into every
answer — a bug that looks like an off-by-one day and only in some deployments.
An absent bound is `null`, not a default, since a range is two independent halves
and an open end has to be expressible.

**There are two "today"s, and they answer to different people.** `TODAY_ET`
is server-side and Eastern because it decides what the NFL has already played —
a fact about the schedule, not about the reader. `todayIso` in
`features/shared/date-range` is client-side and *local*, because it anchors what
a reader means by "last 30 days". Neither is a candidate to replace the other,
and the seam holds because the client sends the resolved `YYYY-MM-DD` bounds
rather than a relative phrase — the window a reader picked is the window the
query runs. Reach for one because of whose day you are naming, not because it is
the one nearest to hand.

`shared/shares` is that shape on the client: `playerShares` takes the leagues,
the rosters and the players cache as arguments and counts, so the rules that
decide what a share is out of can be read and tested without a fetch behind them.
It sits beside `league-filters` because the two compose — the caller filters the
league list, then counts over what's left. (It was `manager/shares` until the
lineup checker started opening the same browse; `features/manager` re-exports it,
the usual mover's habit.)

`manager/record` is the third module cut to that shape, and it is worth noticing
that it re-encodes **the same two rules** rather than inventing any — which is
the sign they are house rules and not local details:

- *The denominator is what contributed, not what was listed.* `aggregateRecord`
  counts leagues carrying a `record`, because Sleeper keeps a manager in
  `league_users` after they stop holding a team, so a membership-only league
  arrives with `record: null`. Exactly the trap `playerShares` counts around,
  and the reason the count ships **with** the total — as with `outlook.weeks`
  and KTC's `priced` of `rostered`, a population-derived number travels with its
  population.
- *Zero and absent are different answers.* `pct` is null before a game is
  played, never `0`: preseason every record is `0-0-0`, and `.000` there is a
  claim about a season that hasn't happened. The same call as an em dash rather
  than `0.00` for an unprojected week, and no rank rather than "1st of 12" for
  an undrafted league.

A fourth module of this kind should be checked against both before it is written.

`trades` is the same cut on both sides of the wire, and it is worth reading as a
pair. `shared/trades/assemble` turns Sleeper's flat maps — `adds` is player →
roster, `draft_picks` carries its own owners, `waiver_budget` its own sender and
receiver — into one *side* per participating roster holding what that roster
received; `shared/trades/params` and `features/trades/trade-query` are the two
ends of the vocabulary that decides which of those trades a reader is looking at,
and `features/trades/filters` is what is left on the client once the *matching*
moved into SQL — the shape of a selection, the pick token's spelling, and how a
seek resolves against today. `features/trades/pick-display` is the third of
that shape and the smallest: when a pick's origin is worth printing, a rule the
card had neither of. (What a pick is *called* was its other half and lives in
`features/shared/pick-value` now, since the ADP board enumerates picks belonging
to no trade and has to call them what the cards call them; this file re-exports
`pickLabel` so its own callers keep one import.) All are pure and tested, and the thin
I/O around them (`shared/trades/queries`, the routes, the page) has no rules of
its own.

**`shared/trades/sql` belongs to that list and was the last of them to get a
test, which is backwards — it is the one whose regressions are silent.** It is
where a reader's selection becomes a `WHERE`, so a mistake there is not an error
but *the wrong rows*: an `?&` for an `?|`, a pick count that isn't `DISTINCT`, a
window folded into the `OR` it should bound. Being a string builder is what makes
it feel untestable and is exactly why it needs testing, and the tests are written
as properties rather than snapshots — every caller value bound and none spliced,
every `$n` resolving to a value actually pushed, `all` and `any` differing in all
three categories, the window never joining the alternatives. Two of them reach
past the module: `TRADE_SORT_SQL` is checked against the migration that indexes
that very expression (no type can carry that agreement, and breaking it turns an
index walk into a season-wide sort while still answering), and the probe for the
`OR` join is written over players and picks, the two categories that emit no `OR`
of their own, so the one being asserted can only have come from the mode.
**Two more pin agreements that are otherwise invisible.** The managers filter and
the `traders` circle are asserted to be *one* fragment, because two spellings of
"was this manager in this trade" is how the slow one survived unnoticed. And
`tradeScopeSql` + `tradeNarrowingSql` are asserted to concatenate to
`tradeFilterSql` — same string, same `$n` for the same value — since the board
reads the whole and a first page's two denominators read the halves, and halves
that are not exactly the whole leave a count describing rows the list doesn't
show.

`shared/trades/pick-slots` is pure for a second reason — it holds the key
the slots are stored under, and the client deep-imports it the way it reaches
`@/shared/ktc/roster`, so both ends of that map read one definition.
Three decisions live in the pair rather than in the components:

- **A side is what was received, never both halves.** What a roster gave up is
  exactly what the other sides received, and storing both is one edit away from
  them disagreeing. Sides come from `roster_ids` rather than from the assets, so
  a roster that only gave things up — a real case in the three-way trades some
  leagues run — still appears.
- **The filters ask what *moved*, not who ended up with it.** The predicate
  pools the sides — `adds`'s keys are every player who moved whichever way — so
  looking a player up finds his trade without knowing which way he went. A filter
  that only answers when you already know the answer is the trap; which side each
  asset landed on is the trade's own display.
- **`all` and `any` are both real questions** — "did these two managers trade
  with each other" against "anything involving any of these three players" — so
  the selection carries one mode over the whole of it. The date is not one of
  the alternatives: it always narrows, because it is a bound rather than a
  selection — which is as true of the single seek the client sends today as it
  was of the window it replaced, since the wire still takes a `from`/`to` pair
  and the seek is one half of it. And a trade Sleeper filed with no timestamp is
  dropped by *any* bound, for the reason `/api/adp` drops an undated draft —
  there is no honest side of the boundary to put it on.

**The league filters' rule lists are AND-only, and that difference from the
trades selection is deliberate.** Both let a reader build a list rather than pick
from fixed chips, so they look like the same control and invite being unified —
they are not. A trade selection is a set of *subjects* ("any of these three
players"), where `any` is the natural reading as often as `all`. A league rule
narrows on an *attribute* (`QB+SF ≥ 2`, `rec = 0.5`), and the question people
arrive with is "dynasty leagues that start two QBs" — every rule narrowing. An OR
there would additionally need each rule to say which group it joins, which is a
control nobody asked for. Adding a mode to the league rules is not the small
symmetry it looks like — and the AND is load-bearing rather than merely
sufficient: a size *band* is two rules on one key, which is only a band because
they narrow together.

Validation earns its keep when a value reaches SQL as anything but a bound
parameter. `scoring` picks the column `projections/queries` interpolates into
`ORDER BY`, so it is a closed enum that fails the request on an unknown value —
never a silent fallback to a default.

A feature that spans several of those pure modules gets one thin file that does
the I/O and composes them, and no logic of its own: `projections/outlook` reads
the weeks and the players cache, then hands off to `aggregate` → `score` →
`weekly` → `optimal`. The composition is what stays untested, and it is small
enough that that costs nothing.

That bar is worth policing, because logic drifts into the composition file a
line at a time. The rule that a player unprojected for a week is *omitted* from
that week's candidates — not passed as a zero — once lived inline in `outlook`,
where nothing tested it; it is the rule the benched-weeks counts rest on, so it
was moved to `projections/weekly` and pinned with a test. If a loop in the
composition file starts making a decision, that decision wants a pure module.

**A second and third entry point is how that drift arrives at scale.** Once
`outlook` grew `getWeeklyTeamPoints` and `getOptimalLineups` beside
`getLeagueOutlook`, four rules were retyped once per entry point — which players
are lineup candidates, the projectable-league guard, the player-id union, and
which slots the solver recognises — and none of the three copies was tested,
because the composition file deliberately has no test. They live once now:
`projections/candidates` owns `lineupCandidates`, `isProjectable` and
`rosterPlayerIds`, and `optimal` owns `recognisedSlots` (which `compareLineup`
had also spelled out inline, and which can't live in `candidates` without a
cycle). What that buys is not lines — the extraction is roughly line-neutral —
but that `getWeeklyTeamPoints` can no longer disagree with `getLeagueOutlook`
about who is allowed to start, and that a change to who counts as a candidate —
the whole roster today, IR and taxi included as bench depth — is one edit with a
test over it rather than three edits and a hope.

Two details worth keeping. `lineupCandidates` takes the scorer as a callback,
because the three callers want different numbers off the same roster — a season
aggregate, a per-league score of it, or nothing at all where the weekly solve
re-scores every candidate itself — and that difference is the only thing that
varied between the copies. And `isProjectable` is a **type predicate**, so
`leagues.filter(isProjectable)` narrows: the three `scoringSettings!` /
`rosterPositions!` assertions that used to re-assert what the filter had just
checked are gone, which is the compiler agreeing that the guard and the use are
now the same fact.

The shared *reads* behind those batch entry points sit in `readBatchInputs`,
still inside the composition file and private to it. That is the right side of
the line: it is I/O and nothing else, so there is nothing in it to test.

**A fourth entry point, `getWeekLineups`, is what that extraction was for.** The
lineup checker asks the same question of *one* week that the other three ask of
the rest of the season — what a roster is starting against what it could be —
and adding it cost a loop that hands each team to `compareLineup`. Nothing about
candidacy, projectability or slots was retyped, which is the whole of the claim
above: the gap a lineup row prints and the gap the expanded league panel prints
are one rule, including the one that matters most as advice — a starter with no
projection scores zero rather than being quietly dropped from the lineup he is
actually in. It solves **every team it is handed**, `getOptimalLineups`' own
contract, which is why `/api/user/[username]/matchups` hands it the two rosters
in each game and not the league, turning a hundred-league account's ~1,200 solves
into ~200.

**One league in that route is handed over whole, and it is the exception that
shows what the narrowing was actually resting on.** A league playing Sleeper's
`league_average_match` scores every team against the week's *median* as well as
against their opponent, so its manager takes two results out of the week — and a
median is the middle of the whole field, which no pair of rosters can answer. So
`median_match` (a guarded read off the settings blob, `BEST_BALL_SQL`'s own
spelling) decides per league whether the two rosters or all twelve go to the
solve, and `medianScore` folds the answer. The narrowing above was never "solve
two"; it was **solve exactly the teams this payload speaks for**, and on a median
league that is every team. The cost is per league carrying the setting rather
than across the account, and a league with the setting but nobody in a game this
week is still skipped, because a median nothing compares against is a solve
nobody reads.

Three things follow, and each is a rule the client half keeps:
`medianScore` **averages the two middle scores** on an even population — take
either middle instead and a twelve-team league hands out seven wins and five
losses in perpetuity, which is a bug nothing on screen would show. A median
league is **one league and two games**, so `projectedRecord` counts `games` and
`leagues` apart rather than assigning one from the other, and it sums through the
same `projectedOutcomes` the card's marks are drawn from — a plate counting for
itself could disagree with the rows under it without either number looking wrong.
And a **bye is still a game** there: an odd-sized median league byes somebody
every week and that manager still has the field to beat, which is why the ledge
reads its marks off the matchup rather than off `matchupState`.

**It does not go through `readBatchInputs`, and the reason is the one decision
this entry point makes for itself: a played game is kept, not dropped.** The
horizon reads filter `game_date >= TODAY_ET` because those points cannot be
scored again — right for a rest-of-season total, and the exact wrong reading of a
lineup. Dropped, a Thursday starter is absent from the candidates, so he scores
zero in the current lineup *and* his slot reads empty for the solver, which
seats a Sunday player in it and reports a gap for a swap Sleeper will refuse. It
is not a Sunday-night edge case: `game_date` is a `DATE`, so the row disappears
the moment the *date* rolls over, and the tool spends every Friday, Saturday and
Sunday morning telling a manager to fill a slot that is already settled.
`listLineupWeekStats` therefore reads the week whole and marks each row `locked`,
and `compareLineup` takes that set — holding those slots as they stand *and*
keeping those players out of the pool for every other slot, since either half
alone still produces an impossible move. What is left is the best lineup
reachable *from here*, which is the only version of "points left" a manager can
act on. Two limits worth knowing, one of them since closed: the lock is
kickoff-accurate now, but only as far as the schedule answers — `lockedPlayers`
(`projections/locks`, pure and tested) folds the week's `start_time`s (the
kickoff ordering's own read) over the day-accurate `game_date` flag, locking at
the minute and **only ever earlier**, so a schedule that can't be read degrades
to the old midnight-ET fallback rather than unlocking a played game, and a
postponed game stays settled once its original date passes (trusting a future
`start_time` to *unlock* would let one stale schedule row recommend a move on a
game already played). And an empty lock set is asserted to be exactly the
unlocked answer, so the three horizon callers are unaffected by construction.

Test the property the code rests on, not just its outputs. The rest-of-season
totals are only correct because scoring is linear, so `aggregate.test` asserts
`score(w1) + score(w2) === score(w1 + w2)` against real stat lines — if that ever
stops holding, a comment saying it does would not have caught it.

## External API gotchas

- **Every request to Sleeper passes one process-wide limiter, and that is the
  only bound that adds up.** `sleeperGet` is the choke point, so the cap lives
  there (`sleeper/limiter`, `SLEEPER_MAX_CONCURRENCY`, default 24 — above the
  largest single fan-out any one path takes, so nothing that used to run in
  parallel is serialised by arithmetic). Every *other* concurrency constant here
  is local — the crawler's four leagues, a manager sync's six, eight weeks within
  each — and local bounds do not sum: two manager syncs plus a crawl tick was
  three times the fan-out anyone chose, and the advisory locks cannot help
  because they are per manager and those are different managers. Two properties
  are what a test asserts: the slot is released in a `finally` (a slot leaked on
  a thrown request is a limiter that tightens by one per Sleeper timeout and
  eventually admits nobody), and the queue is FIFO (a busy page must not defer a
  background tick that has been waiting since before it started).
- **The other half of that problem is *admission*, and it took two goes because
  the first one bounded the cheaper shape.** `shared/manager/sync-admission` is
  the process's whole manager-sync budget — `MANAGER_SYNC_LIMIT`, defaulting to
  `databaseBudget().fanout` (3 at the default pool size) — and `/api/user/…/leagues`
  reserves from it for **every** sync it runs. It used to cap *cold* syncs only,
  on the reasoning that a cold caller has nothing to serve and is the expensive
  case. Half of that is true: a stale refresh is the *same*
  ~11-requests-per-league fan-out holding the same advisory-lock connection for
  its whole duration, and it skipped the counter entirely — so any number of
  stale managers could refresh at once, take a ten-connection pool between them,
  and then stall the persistence they were themselves queued to do. Four things
  hold the fix up. **The cap is a share of the pool rather than a number of its
  own**, for the reason `ADVISORY_LOCK_WAIT_MS` is a share of the request
  deadline: a manager sync is a held Postgres session *plus* the reads and writes
  each league needs, so what bounds it honestly is how much of the pool one
  request may hold. **It is three layers and not one** — the semaphore bounds
  total activity on this instance, the per-manager in-flight map dedupes the same
  manager in this process, and the advisory lock is the only one of the three that
  survives a second dyno; reading any one of them alone makes the other two look
  redundant. **Acquisition never queues** (`Limiter.tryAcquire`, whose release is
  idempotent because a doubled release widens a bound permanently where a leaked
  one only tightens it): every caller here holds a streaming response open, so a
  queued one would hold it through a wait the platform's deadline may end first —
  a refused caller serves what is stored instead, stamps nothing, and the next
  request is the retry. **Only the cold caller sheds with a 503**, since it is the
  one with no cache to fall back on and an empty league list would read as "this
  manager has none".

  **A browser that disconnects mid-stream stops being written to and nothing
  else, and the "nothing else" is a decision rather than an omission.** Nothing
  in the sync stack takes an `AbortSignal` — `sleeperGet` has no parameter for
  one, so neither do `fetchLeagueGraph`, `syncLeagueGraphs`,
  `persistLeagueGraph`'s per-league transactions or the session lock held across
  all of it — so honouring `request.signal` would mean threading a signal through
  every Sleeper call site *and* answering what a half-run sync stamps, which
  `attempt_at`/`synced_at` have no spelling for: a run cancelled between two
  leagues is neither "we tried" nor "this graph is current", so a partial
  implementation puts a lie into the column the whole throttle is read off. It is
  also not the behaviour you want — a cold sync is filling *shared* Postgres
  state rather than this request's answer, the same reason a background refresh
  deliberately outlives its caller, so cancelling would throw away the Sleeper
  budget already spent and leave the next visitor to start over. What it costs is
  one admission permit for the rest of the run, bounded by `managerSyncAdmission`
  and never leaked: the route's `finally` releases on every path out and
  `release` is idempotent. The stream's own `cancel` sets the `closed` flag, so
  the disconnect is noticed there rather than at whichever later `enqueue` throws.
- **The advisory lock still spans the whole sync, network included, and that is
  deliberate.** It is the one thing the limiter's own note warns against — a pool
  connection held across an upstream wait — and shortening it is not available:
  released before the fetch, two instances both decide a refresh is due and both
  run the fan-out, which is the duplicate work the lock exists to prevent. So the
  connection lifetime is unchanged and the *number* of them is what got bounded.
- **Sleeper spells "no such thing" two ways, and which one you get is a fact
  about the endpoint rather than about the request.** Usually it is 200 with a
  `null` body (unknown user, deleted league); several endpoints answer 404 for
  the same thing. `sleeperGet` folds the null body; `sleeperGetOptional` folds
  both. Use one of them rather than calling axios directly, and pick by whether a
  missing resource is an *answer*: the league graph's seven child collections
  take the second, because folding one spelling and throwing on the other is
  deciding by spelling — a 404 from one child used to fail a whole league whose
  own endpoint said it was alive, which is invisible to the tombstone mechanism
  (that asks the league endpoint) and wedged discovery until
  `persistUnsyncedLeagues` existed. The projections sync takes the first, and
  that split is the point of two names: its freshness gate stamps on a *successful
  fetch*, so a folded 404 there would stamp an empty week fresh and never come
  back for it. `isMissingResource` is pure and tested because both ways of
  getting it wrong are silent — a 429 folded into a fallback is a rate-limited
  crawl writing empty collections over good rows, and a timeout learned nothing
  about whether the resource exists.
- **Sleeper's players map is ~5MB** and they ask for at most one fetch per day.
  It's cached in `players`; go through `@/shared/players`.
- **KTC serves bot clients a page with no data**, so requests need browser
  headers. Player pages are 3–6MB, which is why the history backfill does a
  handful per tick.
- **KTC publishes two boards and they move in opposite directions.** Superflex
  and 1QB pricing are not one scale factor apart: over the players stored here a
  quarterback averages 3,219 superflex against 2,554 1QB, while a receiver
  averages 2,569 against 3,027. A roster read off the wrong board is therefore
  wrong at *every* position, not just at quarterback. Which board a league reads
  is simply whether it starts more than one QB — derived from `SLOT_POSITIONS`
  rather than testing for `SUPER_FLEX` by name, the way `DEFENSIVE_SLOTS` is
  derived, so a new QB-eligible flex counts the moment the solver learns it
  (`ktc/roster.ts`). It travels with the number in the payload instead of being
  assumed by whoever renders it. It matters for few leagues and matters a lot to
  them: 118 of the 122 stored here are superflex, so the four that aren't are
  exactly the ones a default would silently misprice.
- **Two KTC rows can legitimately name one Sleeper player, so the read resolves
  the two boards *independently*.** The match is by name (`ktc/match`), so an
  alias, a suffix spelled differently or a retired entry beside a current one all
  land on one `sleeper_id` — which is why the column carries no unique constraint
  and why cleaning the table up would not stop the next scrape producing another
  pair. The read used to be `DISTINCT ON (sleeper_id) … ORDER BY sf_value DESC`,
  which takes *both* numbers off whichever row won on **superflex**: a player
  carrying `(sf 9000, 1QB 5000)` and `(sf 8000, 1QB 7000)` was priced at 5000 on
  the 1QB board with 7000 on file. Silent by construction — the number is a real
  number from a real row — and wrong only on the 1QB board, which is the four
  leagues in a hundred that a default already misprices. `ktc/values` is the fold
  (`foldKtcValues`, order-independent, highest per board, treating null as "this
  row says nothing" rather than as zero — the same semantics SQL's own `max()`
  has, so the two spellings cannot disagree). It is a **pure fold rather than a
  `GROUP BY` in the query** for the reason `ktc/parse` and `ktc/match` are pure:
  a duplicate-resolution rule nothing can test is a rule that regresses, and the
  rows a duplicate adds to the wire are a handful out of a board of ~500.
- **KTC prices ~500 dynasty skill players, so a roster total is never the whole
  roster.** 93.7% of the players on rosters here carry a price; the shortfall is
  IDP (LB, DB, DL, DE) plus the deep end of every skill position, and kickers and
  defences are off the board entirely. A total therefore ships with the count
  behind it — `priced` of `rostered` — rather than passing as complete, the same
  habit as sending `outlook.weeks` alongside a projection. It is also a *dynasty*
  board and the only one this app scrapes, which is the wrong lens on the redraft
  leagues sitting in the same list, so anything showing the number says
  "dynasty" rather than leaving it to be inferred.
- **The same board carries rookie draft picks, as `position` "RDP", and they are
  named rather than identified.** `"2027 Mid 1st"`, `"2029 1st"` — a season, a
  round and (sometimes) a third of the round, in a string. There is no id to join
  on: the name matcher resolves KTC entries to Sleeper *players*, and a pick is
  not one, so every pick row's `sleeper_id` is null. Read them through
  `getKtcPickBoard`, parse the name with `parseKtcPickName` (never a bespoke
  regex — the format is a scraped string KTC has promised nothing about), and
  place a traded pick against them with `pickTier`/`ktcPickPrice`. Which seasons
  get the three tiers and which get one untiered row moves through the year, so
  a lookup states a preference and reports which row it landed on.
- Transactions are keyed by week with no all-at-once endpoint; a league's full
  history is the union of each week.
- **Matchups are the second collection keyed that way, and the two are gated
  separately.** `league/<id>/matchups/<week>` returns a *side* per roster, not a
  game — the two sides share a `matchup_id`, null for a bye or an unscheduled
  week — so `matchups` is keyed `(league_id, week, roster_id)` and a sync
  replaces only the weeks it re-fetched, exactly as transactions do. What must
  not be shared is the **stored-max-week gate**: the two collections fill up
  independently, and every league stored before matchups existed has
  transactions to the current week and no matchups at all, so reading the
  transaction gate for both would open the refresh window past a whole
  unfetched season. `fetchLeagueGraph` therefore takes a range per collection
  and runs both through one bounded per-league pool — adding a second request
  per week doubles the burst otherwise, and the crawler's discovery budget
  (`CRAWL_DISCOVERY_CAP`) is written against that arithmetic.
- **Projections live on a different host and aren't documented or versioned.**
  `api.sleeper.com/projections/nfl/<season>/<week>`, not `api.sleeper.app/v1` —
  and the v1 host answers that path with 200 and an object of empty objects, so a
  wrong base looks like working code with no data. Build the URL with
  `sleeperDataUrl`, not `sleeperUrl`.
- **Kickoff instants come from the *scoreboard*, never the schedule, and that
  is the correction to make if anything ever reaches for the obvious endpoint
  again.** `schedule/nfl/regular/<season>` looks like the source and cannot be:
  it carries `status, date, home, week, game_id, away` and **no `start_time` at
  all** — not for an upcoming season and not for a finished one, checked against
  2024, 2025 and 2026. Everything needing an hour reads
  `scores/nfl/regular/<season>/<week>` (`getNflWeekScores`), which publishes a
  believable ms `start_time` on all sixteen games of a week, months ahead
  (`status: pre_game`), plus the two teams on **`metadata.home_team` /
  `metadata.away_team`** rather than at the top level — the one shape difference,
  and the one a port back to the schedule shape would silently fail on, since
  reading the wrong keys yields no teams rather than an error.

  **What that mistake cost is the lesson, because nothing failed.** Three
  readers — the lineup checker's kickoff ordering, the minute-accurate game lock
  and the season countdown — were built on the schedule call and each degraded
  politely, exactly as designed: `weekKickoffs` answered an empty map, so
  `kickoffInputs` answered null, so `kickoff_order` was null in every league of
  every week of every season and the Kickoff column was a permanent em dash;
  the lock fell back to day accuracy; the countdown fell back to the NFL
  calendar's provisional instant — which for 2026 is the Thursday after Labor
  Day and the real opener is a **Wednesday**, so it was a day out and looked
  right. Tests passed throughout, because they construct rows *with* a
  `start_time`. **A fallback that fires always is indistinguishable from a
  feature that works**, so a field a whole feature rests on gets one assertion
  against the live payload before the feature is built on it.

  The plausibility window stays and stays a *rejection*: a believable
  `start_time` is epoch milliseconds inside 2000–2100, and a seconds epoch reads
  as January 1970 and would count down to fifty years ago, so the parse refuses
  the wrong unit rather than converting it — this drives lineup advice and game
  locking, where believing a wrong instant is worse than having none. What it
  must never be asked to absorb is a *missing* field, which is what made the
  above invisible: an absent `start_time` and a rejected one produce the same
  empty answer. A week with no believable instant answers null and the client
  falls back to the calendar table rather than the server inventing an hour, and
  an unscheduled season (or a week past the regular season) answers `[]`, which
  is the ordinary shape of "no answer" here rather than an error.
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
- **Every key the league pays for and the line carries scores, and there is one
  scorer for projections and played weeks alike.** `scoreStatLine` is that dot
  product, and the only exclusion in it is `NOT_SCORABLE` — `pts_std`,
  `pts_half_ppr`, `pts_ppr` and the ADP keys, which restate the answer rather
  than naming an event, so scoring one would add the whole line to itself.
  Nothing else is filtered.

  **This bullet used to say the opposite, and the correction is worth keeping
  because the observation behind it was true and the conclusion wasn't.** In the
  projections feed `pass_fd`/`rush_fd`/`rec_fd` really are the matching yardage
  over ten (Burrow: 228.30 passing yards, 22.83 "first downs", on 18.97
  completions) and the reception splits really are a fixed 20/20/30/20/10/10
  carve-up of `rec` — both hold to the cent on every row of both stored seasons.
  How Sleeper populates a category is Sleeper's business: it is a scoring
  category like any other, points are `settings[key] × stats[key]`, and a
  `scoreProjection` that dropped those keys was handing back a total the league's
  own settings do not produce. So the split scorer, the `DERIVED` set,
  `derivedScoring` and the `derived_scoring` field on `LeagueOutlook` are all
  gone rather than inverted. `unprojectedScoring` is unaffected and still names
  what a league scores and the feed genuinely does not publish — a `_fd` key is
  in every stat line, so it was never one of those.
- **A week is five days long, so filter the horizon by game, not by week.**
  `getRemainingWeeks` keeps a week until its *last* game, which is right for
  labelling the horizon and wrong for summing it: on the Sunday of 2025 week 1
  that's 105 of 835 rows whose game is already over. `listPlayerWeekStats` filters
  on the row's own `game_date` against the same `TODAY_ET` expression, so the two
  can't drift.
- **Ask what Sleeper projects, not what this roster happens to have.**
  `unprojectedScoring` measures a league's scoring against the week's whole
  vocabulary (`getProjectedStatKeys`). Fed the roster subset instead, a league
  with no kicker or defence slot reports `xpm`, `sack` and `int` as unsupplied and
  the real gaps — `fgm_50p` is never projected and 89 of the 120 leagues score it
  — are lost in 28 lines of noise.
- **That dot product is linear, so aggregate the stat lines, not the points.**
  `score(w1) + score(w2)` is exactly `score(w1 + w2)`, and summing first is one
  dot product per player instead of one per player-week, rounding once instead
  of once a week (`projections/aggregate`). It is also the only way to tell a bye
  from a zero: a summed total needs the *count of weeks that contributed*
  alongside it, or a player Sleeper hasn't projected is indistinguishable from
  one projected to score nothing. Carry that distinction all the way to the
  screen — an em dash, not `0.00`.
- **The horizon is whatever is stored, so send it with the number.** Sleeper
  publishes all 18 weeks months ahead and the sync now keeps them, but
  `getRemainingWeeks` still reports the weeks actually on disk rather than
  assuming a full season — a failed backfill shortens the answer without
  invalidating it. Send the horizon with the total (`outlook.weeks`) and show it
  wherever the number surfaces, the same way `/api/adp` has to say which drafts it
  averaged.
- **Over a season horizon, one missing week is a bye — it is not a caveat.**
  Every team has exactly one, so a marker on any shortfall fires on 974 of 981
  players and says nothing; the threshold is two (`roster-detail`). The same trap
  as `unprojectedScoring` below: a warning that fires on everything hides the one
  case that mattered.
- **Keep the weekly lineups, don't just sum them.** `weeklyLineupSplit` solves each
  remaining week and returns both the total *and* who filled the slots, because the
  attribution is the only thing that separates a bench player who is occasionally
  the better start from one who is never startable — and the solve had it in hand
  before it threw it away. Two consequences worth knowing:
  - The halves belong to `weekly_optimal_points`, not to `optimal_points`. Summing
    every player's `starting_points` reproduces the former exactly (checked against
    a real 32-team league); it will never reproduce the aggregate lineup's total,
    and the two are deliberately different numbers.
  - A week a player has no projection for is left out of that week's candidates
    rather than passed as a zero. The lineup is unchanged — a zero can only fill a
    slot nobody else wanted — but it keeps the bye out of his benched-weeks count,
    which otherwise makes all 981 players read as part-time starters. Same trap as
    the bullet above: `starting_weeks + bench_weeks` is the player's *projected*
    weeks, not the horizon.
  - It hangs off `TeamOutlook`, not the league-wide `players` map, because being
    stuck behind someone is a fact about a roster: the same projection makes one
    team's lineup and not another's.
  - The team-level total, `weekly_bench_points`, is summed from the raw weeks
    alongside the per-player halves rather than by adding those halves up — one
    rounding off the source instead of a cent of drift per player. `standings`
    shows it next to `Proj`, dimmer, because it is context for that number and not
    a rival to it: two teams projecting 3.5k are not the same team when one carries
    883 behind its starters and the other 2,119. It is not a number to minimise —
    a bye has to be covered by somebody, so a zero bench means no depth at all.
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
- **A priced board is cached in-process, and the reason is the *curve* rather
  than the query** (`getDraftAdpForPlayers`, `BOARD_TTL_MS`). Steepness is
  applied by the caller, per league, *after* that read returns — so every notch
  of the ADP drawer's slider re-asked for a board byte-identical to the one just
  read, at a second of aggregate over 1.9M picks a time. A reload, a second tab
  and the 15-minute boundary where the browser's own entry goes stale are the
  same case: none of them changes the population, and the population is all this
  reads. Two decisions in it. **The key is the statement, not
  `boardSignature`** — that exists for grouping leagues onto shared fetches and
  names the axes a *board* varies on, where a cache key has to name everything
  the *answer* varies on, which is strictly more (`min_picks` gates which players
  come back, `draft_types` and `draft_statuses` decide which drafts match, and
  none of the three is in it); keying on the generated `where`, its bound params,
  the gate and the sorted ids is exact by construction. And **the ids go in
  verbatim rather than digested**, for the reason `boardSignature` spells its
  league scope out: a hash trades a silent collision for a shorter key, and a
  collision here is one manager's roster priced off another's board with nothing
  to say so. It flips which half of `/api/user/…/adp-value` is the critical path
  — warm, the ADP read is 0ms and the ~1,400 lineup solves are the whole 169ms.
- **A season and a date range are different cuts of the same drafts, and
  `/api/adp` takes both.** `season` is what a draft is *for*; `start_after` /
  `start_before` (`YYYY-MM-DD`, read in ET against `drafts.start_time`) is when it
  *happened*. Every dynasty league runs a rookie draft in May and a startup in
  August under one season label, so "the last 30 days" is a question a season
  cannot express — and the 2026 rookie class is not in a 2025 draft at all, which
  is the question a range cannot express. **The drawer sends both**, and the
  season leads: it is the board's population, the range a cut inside it.
  It briefly sent only the range, on the reasoning that the range was the finer
  tool. It is, and it is the wrong axis to be finest on: pooled across seasons
  the top of a twelve-month board is taken in ~46% of the drafts averaged,
  because half of them were drafted from a different player pool. Four
  consequences worth keeping:
  - **An omitted `season` is not a season default — it is a default that
    switches itself off.** `DEFAULT_SEASON` applies only when the caller bounded
    the board *neither* way, so a client that leaves the season out and narrows a
    window silently goes back to spanning every season. `adpBoardRead` sends it
    every time, `"all"` included.
  - A date bound drops drafts Sleeper never gave a `start_time`, because there is
    no honest side of the boundary for them. An unbounded board still counts them,
    so **"all time" can match more drafts than a range covering every date on
    file** — say it in the caption rather than leaving it to be discovered.
  - The two never intersect by accident: `DEFAULT_SEASON` applies only when the
    caller bounded *neither* way. A request asking for "drafts since June" that
    silently came back as "June drafts of this season" is the bug that rule
    prevents; bounding nothing at all is still the expensive case, so that one
    keeps its default.
  - The date→timestamp conversion lives in SQL, not the parser, because what a
    bare date *means* is a zone question and the parser has no business baking the
    Node process's zone into it. The end bound is exclusive against the next ET
    midnight so the named day is included whole.
- **A draft's `pick_no` is not always a draft position.** In auction drafts it
  is nomination order, which is why `/api/adp` excludes them by default.
- **When a draft *ended* is only knowable from `last_picked`.** It rides at the
  top level of Sleeper's draft object (not inside `metadata` or `settings`), and
  `draft_picks` carries no timestamp of its own, so nothing else in the graph can
  close the window `start_time` opens. On a complete draft it is the end; on one
  still running it is only the running edge, **which is not the same question and
  is why it is read with `status` and never alone.** A boundary that advances with
  the draft admits everything that happens inside the draft: each trade in the
  room lands after the pick before it, so it clears the edge as it stands. The
  cutoff is a fact about a *finished* draft; on an unfinished one the honest
  answer is "the startup hasn't ended", not a date. It is absent for a draft
  nobody has picked in — read the null as "unknown", never as a date.
- **A placeholder pick's number is its place in the kicker sequence, not its
  draft slot.** Leagues trading next year's rookie picks during a startup draft
  can't draft players who aren't in Sleeper's pool yet, so they draft kickers as
  stand-ins: the Nth kicker off the board is rookie pick N. A kicker taken at
  startup slot 7.11 can be rookie pick 1.03, which is why `shared/picktracker`
  sorts by `pick_no`, filters to `metadata.position === "K"` and numbers from
  the *filtered* index — the pick's own `round`/`pick_no` are the wrong numbers
  on purpose. Two adjacent traps: slots-per-round is `settings.teams`, because
  `draft_order` only maps users who claimed a slot and is null before an order
  is set; and "next pick" must gate on the draft's `status`, because after the
  last pick the arithmetic still names a plausible slot that will never exist.
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
  recommending a lineup Sleeper would reject. IR and taxi players *are* candidates,
  though — this tool treats a stashed player as bench depth that could be started
  rather than as unavailable, a deliberate choice (Sleeper needs a roster move to
  seat one, so the lineup is "best available once activated").
- **An optimal lineup that is arbitrary about interchangeable slots reads as a
  mistake.** The matching is free to seat the worse of two backs at RB1, or a
  15-point back in FLEX with a 14-point back at RB — same total, but as advice it
  looks wrong and diffs against a sane current lineup as pointless moves. So the
  answer is canonicalised: better player to the stricter slot, and among equally
  strict slots to the earlier one.
