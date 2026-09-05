@AGENTS.md

## Layering

```
src/app/       Routes only — pages and API handlers. No business logic.
src/features/  Client UI, one folder per tool. `features/shared/` holds
               cross-feature client pieces.
src/shared/    Domain logic and the API contract, one folder per concern.
               Never UI.
```

Two rules are easy to get wrong, and both are load-bearing:

- **`shared/` must never import from `features/`.** The reverse is fine. The
  direction is what keeps server-side domain code out of the client bundle.
- **Import from a folder's barrel `index.ts`, not its internals**
  (`@/features/shared`, not `@/features/shared/account`). Add new exports to the
  barrel. A module that only the barrel's own siblings build on stays out of it —
  `local-store.ts` is the current example.

`src/shared/contract/` is the seam between the two: types only, zero runtime
imports, so a `"use client"` module can import from it without pulling a database
client into the browser.

Path aliases: `@/*` → `src/*`, plus `@thelab/http` → `src/shared/http`. The second
exists only so a file ported from TheLabX needs no edit to that import; new code
here should write `@/shared/http`.

`allowImportingTsExtensions` is on, for the same reason it is in TheLabX: tests
run under Node's own runner (`npm test`), which resolves the file it is given.
Extensions therefore follow a rule rather than a habit:

- Alias imports (`@/…`, `@thelab/http`) — **never** carry `.ts`.
- Ordinary relative imports in a runtime module — **no** extension.
- A test importing the module under test — **explicit `.ts`**.

`npm test` needs Node ≥ 22.6 for `--experimental-strip-types`; on 23.6+ the flag
is redundant but harmless.

## Reaching Sleeper

Four `shared/` concerns stack, and the order is the whole design:

```
shared/http     fetch + bounded retry. Knows nothing about Sleeper.
shared/sleeper  the client, the process-wide concurrency bound, the 404 rule.
shared/season   which season "now" means, resolved rather than compiled in.
shared/user     a typed name -> a Sleeper user, memoized.
shared/manager  a manager's league graph: fetch it, persist it, read it back.
shared/db       the pool, the transaction, the bulk insert, the advisory lock.
```

**`shared/http` is native `fetch`, where TheLabX uses axios + axios-retry behind
a `@thelab/http` alias.** The runtime dependencies here are React, Next and `pg`
— that last one deliberately, because the league graph is the app's own data
rather than a cache of Sleeper's and a hand-rolled wire protocol is not a thing
to own. Nothing else earns one. axios-retry's ladder — three retries on top of a
30s timeout each,
`shouldResetTimeout` and all — is up to ~141s of a request's life re-dialling an
upstream, which `shared/season` documents as the thing that made a cold season
resolve unacceptable in front of a request. The *contract* is kept identical so a
port back would touch no caller: `http.get<T>(url)` resolves to a `{ data }`
envelope, and a non-2xx throws with `response.status` — which is all
`sleeper/missing` reads. The KTC scrape added `responseType: "text"` and
per-call `headers` to the options, spelled exactly as axios spells them, so
that rule still holds.

The retry ladder is the part of it to distrust: hand-rolled, where axios-retry
has been wrong in production and fixed. `http.test.ts` pins the decisions that
are silent when wrong — a 404 and a 429 are final, a 5xx and a timeout are not,
and a caller's abort ends the ladder even when it fires *during* a backoff rather
than during an attempt.

**Every Sleeper call goes through `sleeperGet`, and that is why the concurrency
bound can.** Local per-caller bounds do not add up; the one in
`sleeper/limiter.ts` is per process. Two functions rather than a flag:
`sleeperGet` throws on a 404, `sleeperGetOptional` folds it — reach for the
second only where an absent resource is an answer the caller can act on.

**Never default a season from `DEFAULT_SEASON`.** It is a release note disguised
as a string; call `getActiveSeason()`. An *explicitly requested* season
(`?season=2024`) must never go through the resolver — it is the caller's answer,
and routes reading it stay deterministic. `parseRequestedSeason` in
`shared/season` is where that rule lives: it validates with `isPlausibleSeason`,
the same predicate the resolver accepts Sleeper's answer with, so "looks like a
season" has one spelling. It returns **three** states, not two — `null` means
"not asked" and is the only one the caller fills from `getActiveSeason()`.
Collapsing absent and invalid is how `?season=abc` quietly becomes the current
season.

It lives in `shared/` rather than beside a route because it used to live beside
one, in `app/api/user/[username]/manager-request.ts`, where `npm test` could not
reach it — and where a helper returning six fields for a caller that read one
cost every request an `await getActiveSeason()` it discarded. A route that needs
no season should not pay a Sleeper round-trip for one.

### Known drift

`sleeper/limiter.ts` is now the whole file, admission half included — the
streaming leagues route is the caller that was being waited for, and
`manager/sync-admission.ts` is built on `tryAcquire`. `limiter.test.ts` came
with it and is what pins the two properties that are silent when wrong: the slot
*transfer* in `release()` that keeps the bound from widening across the
microtask gap, and a cancelled waiter leaving the queue rather than being handed
a permit it has stopped waiting for. One thing is still trimmed:
`ADMISSION_REFUSALS` names two errors where TheLabX names three — the third is
its request budget's, and joins when that ports.

`sleeper/types/sleeper.types.ts` doc comments still cite `SLEEPER_DATA_BASE` and
`manager/crawl-ttl`, which arrive with the projections and crawler ports. Most
of its fourteen types still have no reader, and that is deliberate: it is the
ported schema-of-record, and re-transcribing an API by hand is the expensive
half. `SleeperScoreGame` is the case that argued for keeping them — typed and
unread for as long as it existed, then the whole of what the lineup checker's
kickoff ordering needed, warning included. `Tool` was trimmed the other way, to the five fields anything consumes —
`icon`, `pattern`, `group` and `browses` were set and never read, and re-adding
a field is cheap.

`peekActiveSeason` and `resetActiveSeason` likewise have no caller. Both are
kept: the first carries the argument for why it is *not* a cheaper
`getActiveSeason`, which is the part a reader would otherwise get wrong.

**Untested, and the two worth knowing about.** `season/resolve.ts` and
`user/memoize-manager-lookup.ts` both hold decisions that are silent when wrong
— the failure backoff that deliberately does not re-stamp the cache, the
rejection eviction that makes a 502 immediately retryable — and both take their
clock and their upstream as arguments specifically so they can be tested without
either. `http.test.ts` is the shape to copy.

## The league graph

`shared/manager` is a manager's leagues and everything hanging off them —
rosters, members, traded picks, drafts and their picks, transactions, matchups —
fetched from Sleeper and mirrored into Postgres. The route that drives it is
`GET /api/user/[username]/leagues`.

**It answers NDJSON, and the shape is the feature.** Postgres is read first and
sent immediately; if what is stored is stale, a sync runs behind it and streams
a progress line per league before a second, final `result`. A first visit has no
cache, so it gets the same stream with the progress lines in front. One
consequence to keep: **the cold path sends no opening `result`**, so a client
reading "a sync is running" off that message alone is wrong for exactly the case
the progress bar exists for — a `progress` event is itself that news.

**Fetch the whole graph, then persist it.** Never hold a transaction or a pooled
connection while queued on the Sleeper limiter: the queue can be long, and a
connection held across it is how a bounded upstream becomes an unbounded
database problem. `fetchLeagueGraph` reads Sleeper whole and `persistLeagueGraph`
opens the transaction afterwards. The per-manager advisory lock *is* held across
Sleeper work, deliberately — `sync-admission` is what bounds how many such
sessions exist at once, and it is `tryAcquire` rather than `run` because every
caller is holding a response open.

**Two columns, two questions, at both grains.** `manager_syncs.synced_at` and
`leagues.updated_at` mean "this was last written *whole*"; `attempt_at` and
`sync_attempt_at` mean "somebody last *tried*". Freshness is read off the first
pair and the retry throttle off the second, and collapsing them is how a partial
graph buys itself a full TTL of quiet — or, in the other direction, how a
failing upstream turns every request into a fresh fan-out. A row that has never
had a graph written takes `NEVER_REFRESHED_SQL` rather than `DEFAULT now()`: a
default is a claim.

**Which leagues are a manager's is one predicate, and a roster row is not a
team.** `FIELDED_A_TEAM_SQL` in `manager/queries.ts` is the whole rule — it
holds where the manager holds a rostered team now (`HOLDS_A_ROSTER_SQL`), or was
chopped out of a chopped league, which is that format's ending rather than an
exit. Membership is not the test: Sleeper leaves a departed manager in
`league_users`. Neither is a bare roster row, which is why the roster half reads
`players` and requires it non-empty — Sleeper keeps the row after the players
are gone, and ships every roster of an undrafted league empty, so an existence
test lists leagues with nothing in them to seat, rank or price. **The deliberate
cost is that a pre-draft league is absent from the page until its draft fills a
roster**; against the current database that is exactly what the rule removes,
every empty owned roster stored being a `pre_draft` one. `jsonb_typeof` guards
the `jsonb_array_length`, since null is Sleeper's own spelling of an empty
roster and the column is untyped.

**An empty answer from Sleeper is indistinguishable from a failure**, because
`sleeperGetOptional` folds a 404 and a 200-with-null into the same `[]`. So the
guards are load-bearing and must not be simplified away:
`MANDATORY_GRAPH_COLLECTIONS` refuses to delete stored users or rosters on an
empty fetch and leaves the league due; `replaceManagerLeagueOrder` and
`reconcileUnlistedLeagues` return early on an empty enumeration. Drafts are
upserted and *never* deleted — the cascade would take `draft_picks` with them.

Migrations are `db/migrations/*.sql` under node-pg-migrate, applied by
`npm run migrate:up` **and** on boot from `src/instrumentation.ts`, which
rethrows: a server must not serve requests against a schema it cannot vouch for.

**To reset the database, run the migrations down — never a `DROP TABLE` sweep.**
`npm run migrate:down -- 2` (the numeric argument is a count) drops all ten
tables in dependency order and deletes the `pgmigrations` rows as it goes;
`npm run migrate:up` then rebuilds. Dropping the tables directly leaves that
history populated, and a populated history is a claim in the same way a
`DEFAULT now()` is: `migrate:up` and the boot hook both report "up to date" and
recreate nothing, so the server comes up healthy against no schema at all. The
down blocks were folded in from TheLabX's eight live migrations and are only
ever exercised by this path, so `--dry-run` first is worth the second it costs.

The numbers TheLabX derives from a request-deadline budget are constants here —
`DEFAULT_POOL_MAX` and the pool's three timeouts, `ADVISORY_LOCK_WAIT_MS`,
`DEFAULT_MANAGER_SYNC_LIMIT` (a third of the pool). They are the numbers that
budget produced; the crawler port is what makes a derivation earn its place
again, and the call sites do not move when it does.

**What is deliberately not ported**, each with the route it arrives with: the
in-process read caches and
therefore `persistLeagueGraph`'s `affectedOwnerIds`; the request budget and its
503 taxonomy; and projections *storage* — the pure projections core (solver,
scorer, aggregation) arrived with the lineups route below, but the Postgres
tables, the weekly sync and its background loops stay with the loops that need
them. **Trades and the players map have since arrived**, with the trades board:
a trade was always these `transactions` rows and is now read
(`shared/trades`), and `shared/players` mirrors Sleeper's map because a board of
past trades names players the projections feed no longer carries. **The
background crawler has since arrived too** — see The league crawler below; the
freshness columns the schema was carrying for it now have their reader.

## The league crawler

Until this landed, nothing refreshed a league except in front of a request: the
leagues route read Postgres, and if the manager's graph was stale it ran the
Sleeper fan-out with the response held open. A league nobody visited went stale
forever and the corpus only ever grew by someone typing a username.
`shared/manager/crawl.ts` is a 60-second tick that does both jobs on its own —
TheLabX's crawler ported, minus the worker split and the trade-stats piggyback.

**It needed no migration, and that is the schema's doing rather than luck.**
`leagues.sync_attempt_at`, `gone_at`, `last_accessed_at`, the two partial
indexes and `manager_syncs.attempt_at` were all put in by the league-graph
migration *for* this port, and `crawl-queue.ts` already held the writing half —
`markLeaguesAccessed`, `stampLeagueSyncAttempts`, `markLeaguesGone` — with a
header promising the reading half would extend that file. It did.

**There is no queue table; the queue is the tables.** The refresh queue is
`leagues`; the discovery queue is `league_users ⋈ leagues ⟕ manager_syncs`. A
separate table would be a second claim about when a league was last read, and
the two would disagree the first time a manager-driven sync wrote one and not
the other — which is the same argument `manager_syncs` and `leagues` already
settle between themselves with two columns apiece.

**The claim is one statement, and it claims and stamps together.**
`staleLeagueClaimSql()` is an `UPDATE … RETURNING` that sets `sync_attempt_at`
on the rows it selects, so two ticks — or two app instances behind the advisory
lock — can never pick the same batch, and a tick that dies mid-flight rotates
its batch to the back rather than retrying it immediately. **Two conditions on
the same `$2` interval, and they are two different questions**: `updated_at`
says whether work is needed, `sync_attempt_at` says how often it may be asked
for. A healthy league carries both at the same instant and turns them over
together; a league that cannot sync stops occupying a slot every minute.
Collapsing them is how a failing upstream turns every tick into the same doomed
batch.

**Five tiers, ordered, then longest-untried first.** `crawl-priority.ts`:
`starved` (past `STARVATION_MULTIPLE` × TTL — the bound that stops a database
with something always hot in it from deferring a cold league forever),
`demanded` (`last_accessed_at` inside `DEMAND_WINDOW_MS`), `active` (a live
`status`; `pre_draft` is deliberately out), `known`, `cold`. **The SQL and the
pure mirror are generated from the same `CRAWL_PRIORITY` table**, which is the
whole reason the mirror exists: the statement itself cannot be unit-tested here,
so `leagueRefreshPriority` / `isLeagueRefreshDue` / `compareLeagueRefresh` are
what the tests drive, and a tier that changed in one spelling and not the other
would be a queue that silently orders itself differently from the one described.

**The crawler must never stamp `last_accessed_at`.** Demand is *observed*, not
inferred — within one rotation every league would look demanded and the five
tiers would flatten back to the round-robin they replace. `crawl-writes.test.ts`
pins that there is exactly one writer of that column in the queue module.

**The TTL is seasonal and read from Sleeper each tick** (`crawl-ttl.ts`): 15
minutes in the regular season, an hour inside the 75-day window before kickoff,
six hours in the deep offseason. Only `season_type === "regular"` is matched by
name — Sleeper labels most of the offseason `"off"` and flips to `"pre"` only
near the preseason, so a gate on either spelling silently reclassifies the weeks
between — and everything else is decided by distance from `season_start_date`.
**An unparseable date falls toward the freshest tier**, the rule
`sync-freshness.ts` and `graph-weeks.ts` were already citing this module for
before it existed: extra fetches are the failure you can see.

**Discovery's invariant is that a manager is stamped only once every league
attributable to them is written down** — and the hold is released by the league
being *written*, not by it succeeding. A tombstone (`persistGoneLeagues`) and a
parked row (`persistUnsyncedLeagues`) both count. That distinction is the whole
of `discovery.ts`: unstamped managers sort to the front of `pendingManagers`, so
a league that fails its first sync *every* time would hold its managers at the
head of the queue forever and discovery would stop finding anything for anyone,
while the summary line still reported a healthy refresh pass beside
`discovered 0`. What still blocks is `unrecordedFailures` — a failure with no
payload to write a row from — because there is genuinely nothing to record.
`selectDiscoveryLeagues` takes a manager whole or not at all, except that one
with more unknowns than the cap takes a capful and is marked *deferred* so they
still converge; on the first live run every manager was deferred for several
ticks, which is that arm working rather than a stall.

**`stampManagers` moves `attempt_at` and never names `synced_at`**, which is a
stronger protection than copying `MANAGER_SYNC_STAMP_SQL`'s conditional: there
is no branch for a later edit to flatten. The consequence worth knowing is that
a stamped manager is also suppressed from the leagues route's own retry for
`SYNC_ATTEMPT_TTL_MS` — correct, since Sleeper *was* just asked about them — and
bounded, since a manager is enumerated at most once per `CRAWL_MANAGER_TTL_MS`.
Their leagues still report `stale`, so nothing presents the wait as a completed
refresh.

**`persistUnsyncedLeagues` is the row that proves the two columns had to be
two.** A discovered league whose first sync fails outright takes
`NEVER_REFRESHED_SQL` for `updated_at` and `now()` for `sync_attempt_at` — never
the column's `DEFAULT now()`, which would have a row nothing has ever read claim
it was refreshed this second, and which is the same claim `writeLeagueGraph`
already refuses to make for a *partial* sync (strictly more successful than
this one). Both writers' `ON CONFLICT` moves only their own marker: a row
already stored came from a sync that actually saw the league, and that beats the
enumeration payload these hold.

**Sizing is `batch × TTL / interval`, and the scheduler warns when it is
missed.** 15 leagues a minute at the 15-minute tier is 225 leagues held current;
900 at an hour, 5,400 at six. Discovery enumerates 5 managers a tick against a
`league_users` frontier that was already 846 distinct ids on the day this
landed, so **the corpus outgrows the refresh capacity long before the frontier
drains** — that is expected, and what happens is a throttled
`freshness target missed` line naming the tier, the TTL, the corpus, the backlog
and the computed capacity. It warns rather than throttling because which knob to
turn is a judgement: raise `CRAWL_LEAGUE_BATCH`, lower `CRAWL_MANAGER_BATCH`, or
lengthen `CRAWL_MANAGER_TTL_MS`. Read the telemetry before touching any of them.

**The lock is `withAdvisoryLock` (try/skip), never the blocking form**, and it
wraps the whole tick including the NFL state read — `lock.ts` states the rule: a
loop that queued behind another instance instead of skipping would stack ticks.
A tick that loses it carries `locked: true` and null tier fields, discriminated
so `if (s.locked)` is also the type guard, and the scheduler counts the skips
and reports them once per heartbeat rather than once a minute.

**Deliberately not ported**, each with what it arrives with: the `BACKGROUND_JOBS`
mode gate, `src/worker.ts` and the Procfile — one instance, so `LEAGUE_CRAWLER=off`
is the switch, on `KTC_SYNC`'s exact terms; the advisory lock already makes a
second instance correct, and what a mode gate adds is *which process*, which
arrives with a second one. TheLabX's `refreshStaleTradeStats` piggyback (no
`trade_market_stats` here — `countTradeTotals` always counts).
And the request budget: CLAUDE.md said the crawler port was what would make
deriving `DEFAULT_POOL_MAX`, the pool timeouts, `ADVISORY_LOCK_WAIT_MS` and
`DEFAULT_MANAGER_SYNC_LIMIT` from a budget earn its place again. **It did not** —
the crawl bounds itself with `CRAWL_CONCURRENCY` and one lock, and those five
call sites are unchanged.

### Verified

Run against the live database on the day it landed. `npm run migrate:up`
reported "No migrations to run", which is the claim above and the reason this
port is code only. The first tick refreshed exactly the five leagues a hand-run
of the claim's inner `SELECT` had predicted, in tier order, and the
missed-target warning fired on them correctly (`oldest=5.2h` against a 15-minute
tier) and then stopped once they were current. Over five ticks the corpus went
132 → 207 with `gone` and `updated_at = 'epoch'` both staying zero — every
discovered league synced whole. The first four ticks stamped **no** managers and
deferred all five, which is `selectDiscoveryLeagues`' cap arm rather than a
stall: the queue head is stable across calls, so one manager's unknowns drain 15
a tick, and on the fifth tick two managers fitted and were stamped —
`manager_syncs` 2 → 4 with both new rows carrying `attempt_at` and a **null**
`synced_at`, which is the discovery invariant end to end. Editing source under
the running server added no second `Loop started` line, and `LEAGUE_CRAWLER=off`
printed `[crawl] Loop disabled (LEAGUE_CRAWLER=off)` while KTC and players
started and skipped as fresh — the retrofit keeping their unforced boot tick.

### One loop helper, and a reversed decision

`players/scheduler.ts` used to argue *against* sharing timer code with KTC: "two
loops with different clocks and different failure stories are two loops, and the
shared part is four lines of timer bookkeeping." That was true of a daily loop
and a 15-minute one. It stopped being true here, and the note in that file now
records why rather than being deleted: **a 60-second tick over a Sleeper fan-out
can outrun its own interval**, so `util/background-loop.ts` carries a re-entry
guard — behaviour, not bookkeeping — and a guard living in one loop of three is
the one that gets forgotten in the fourth. All three schedulers are
`startBackgroundLoop` now; the clocks, the log lines and the failure stories are
still each loop's own, which is everything else in those files.

The helper's four guarantees are Node-only (`isNodeRuntime` reads an *absent*
`NEXT_RUNTIME` as Node, so a loop's own test can start it — the opposite reading
from `instrumentation.ts`'s guard, which is right because `register()` only ever
runs inside Next), idempotent on a `globalThis` key, non-overlapping, and
unkillable. `stop()` releases the guard key, which is what makes any of it
testable. `tick(firstRun)` is what preserves the rule all three loops share and
none may lose: **the boot tick does not force and interval ticks do**, because
the interval equals the TTL and an unforced interval tick would find the rows a
moment short of stale and skip forever.

## Valuing a roster off ADP

`shared/manager/adp-value.ts` turns an average draft pick into a number that can
be summed. **ADP is ordinal**, so it cannot be added as it stands — a deeper
roster would only pile up a larger (worse) number and a stud would *lower* the
total. `adpValue` inverts it onto a cardinal scale and `rosterAdpValue` sums
that across a roster.

Three decisions carry the module, and all three are in its doc comments:

- **The curve, not a plain inversion.** `maxPick − adp` would make the gap from
  pick 1 to 2 worth the same as 100 to 101, which overvalues bench depth and
  undervalues the players a season is won with. It is exponential decay:
  `ADP_PEAK · 2^(−halvings · (adp − 1) / pool)`.
- **Anchored to the startable pool, not to a pick count.** `pool` is
  `leagueAdpPool` — teams × starting slots — so the same ADP means the same
  thing in a 10- and a 14-team league, and a deeper-starting league (superflex,
  extra flex, IDP) extends value further down the board because it starts more
  players. `TYPICAL_STARTING_SLOTS` is the fallback, and it lives in that one
  function so two lenses on the same league cannot anchor differently.
- **`DEFAULT_STEEPNESS` is measured, not chosen.** 2.75, fit against 14,082
  two-sided trades — a completed trade is a revealed near-indifference, so the
  curve making the fewest look lopsided is the one the market uses. The comment
  carries why only count-asymmetric trades can answer it and why the figure is a
  ceiling; re-running TheLabX's `scripts/fit-adp-curve.ts` is how to challenge
  it.

`rosterAdpValue` takes `bench` as `total − starters` so the three numbers always
reconcile and a lineup naming someone the roster doesn't hold cannot overdraw
the bench; an id with no ADP is skipped rather than counted as zero, which is
what makes `priced` worth reporting beside `rostered`.

The module is pure — its one import is the slot vocabulary — which is the point:
it unit-tests without a fetch or a database, and `adp-value.test.ts` pins the
curve's shape (monotonic, peak-capped, pool- and steepness-responsive) rather
than its literal outputs.

**Ported as the curve half only.** TheLabX's file continues into the *board* —
`adpBoardFor`, `parseAdpBoardChoices`, `boardSignature`, `ADP_VALUE_PARAMS` —
which decides *which crawled drafts* a roster is priced against, and pooling ADP
across different games is meaningless, so that half is load-bearing wherever
real ADP is involved. It is absent because nothing crawls drafts here yet, and
it arrives with `/api/adp` and its filters. The only ADP in the repo is the
lineups route's fallback board — see Rest-of-season lineups.

**One board question is answered here anyway, because it is not a preference.**
`AdpEntry` names the draft board a player's average came off, and `adpEntryValue`
is what prices either: a **rookie** entry is mapped onto the overall board and
then run through the same `adpValue`, so one curve and one `pool` anchoring sit
behind every number a roster sums. A rookie draft runs three to five rounds over
the incoming class alone, so its 1.01 is `pick_no` 1 — the number a startup gives
the best player in the game — and until the boards were split the read `AVG`'d
the two together and priced that 1.01 at the full `ADP_PEAK`, with a whole third
round of rookies landing above the sixtieth player off a startup board. That is
not a lens a reader chooses between: pooled, the total is *wrong* rather than
differently weighted.

**The map is affine and its two constants are chosen, not measured** —
`ROOKIE_TOP_OVERALL_PICK` (12) and `ROOKIE_PICK_STRIDE` (3.5), so
`overall = 12 + (k − 1) · 3.5`. That is exactly the state `DEFAULT_STEEPNESS` was
in before the fit replaced it, and both are written down so the same thing can
happen to them. **The measurement is available in this data**: a first-year
rookie appears on *both* boards in the same season — the rookie drafts of the
dynasty leagues and the full drafts of the redraft ones — so that overlap is a
two-column fit of this very line. It wants a corpus rather than one manager's
leagues, which is why it is `/api/adp`'s work rather than something done inline.

One thing the map deliberately does **not** do is scale with league size. A
rookie's position on a rookie board is his rank in the incoming class, not a
depth into a board, and a class rank means the same thing in a 10- and a 14-team
league; size enters where it does for every other player, through `pool`. The
consequence is that the same rookie pick is worth the same in a three-round and
a five-round rookie draft, which normalising by board width would have broken.

`shared/projections/slots.ts` is the zero-runtime-import slot vocabulary,
copied verbatim. `IDP_SLOTS` has the reader its doc comment always named — the
league filters' `IDP` slot group — and `DEFENSIVE_SLOTS` still has none, which
is now the *point* of keeping the two apart rather than an accident: the filter
narrows on the individual defenders and the projections caveat wants the wider
set. Modules that must resolve under Node's test runner (`adp-value.ts`,
`optimal.ts`, `ktc/roster.ts`, `league-filters/defaults.ts`) import it
relatively with `.ts` rather than through the folder's barrel, which reaches the
network via `ros-read` and is therefore server-only.

## Rest-of-season lineups

`GET /api/user/[username]/lineups` solves **every stored roster** in every
league into optimal starters and bench and ranks the manager's among them —
one request for the whole page, because the projections span is shared across
every league and per-card requests would refetch nothing but re-enter
everything. The client (`use-manager-lineups`) fetches it after the leagues
stream settles; `!refreshing` flipping true is also the refetch after a cold
sync, which is exactly when the rosters it solves from were written.

**Every team ships, solved.** Each league's payload entry is
`{ teams, ranks }` (`LeagueLineupEntry`), one `LeagueTeam` per stored roster —
lineup, all nine metric totals, pick portfolio, label, `is_manager` — because
the expanded card is a team browser, not a mirror of the manager's roster.
(It used to ship the manager's lineup alone and reduce everyone else to a
rank; the team picker is what reversed that, and the ~50KB a twelve-team
league costs is the price of never refetching per click.) `totals` ships
rather than being re-summed on the client because the sums carry edge rules
(`lineupMetricTotals`) and a second spelling is how the teams column would
drift from the ranks beside it. `manager/league-teams.ts` composes the entry
— `solveLeagueEntry` = ranks + picks + the `leagueTeamName` label rule
(team name → owner's display name → "Roster N", blanks folding in with null)
— so the route stays a handler; `manager/league-ranks.ts` remains the pure
solve-and-rank underneath: one `solveLeagueLineup` per roster, eight of the
nine metric totals read off that one solve (the solver prices `points`,
`adp_value` *and* `ktc_value` onto every player, so there is no second
valuation pass to drift from the first). The ninth, `ktc_picks`, is the one
thing not on a player — which is why **the picks are now resolved *before* the
ranks** in `solveLeagueEntry`. Resolving them afterwards, as it did until the
KTC columns landed, would mean either a second reconstruction of the same pick
grid or a rank computed without the picks beside a card showing them, and the
two would disagree with nothing on screen saying so. Ranks are standard competition ranking — ties share the better rank,
the next distinct total skips — and `of` counts the rosters actually ranked,
orphans and empty rosters included, not `total_rosters`. **A metric ranks
`null` when every roster in the league totals zero on it**: one rule that
covers `from_week: null` (no projections → both ROS metrics), an empty ADP
board (all three capital metrics), an unreadable KTC board (all four KTC
metrics) and a league read on the **redraft** market, whose board carries no
rookie-pick rows so `ktc_picks` is zero for everyone — correctly, since a
redraft pick is not an asset anybody holds into next year. "1st of 12" among
all-zero totals is a claim. One subtlety the tests pin: player *identity* (positions)
rides the projections feed, so a wholly absent feed nulls the capital
starters/bench **split** too — nobody can be seated, the roster's capital all
lands on the bench — while `capital_total` keeps ranking. Capital ranks are
invariant to *points*, not to the feed's existence. The query behind it, `getManagerLeagueRosters`, aggregates
the rosters per league row in one round trip and gates on `HOLDS_A_ROSTER_SQL`
— the roster half of `FIELDED_A_TEAM_SQL`, extracted so the two spellings
cannot drift; a league where the manager holds no rostered team — left, chopped
out, or not yet drafted — has nothing to rank, where `getManagerLeagues` still
lists the chopped case.

**The ranks are keyed by *column*, not by metric.** `LineupRanks` is still the
exhaustive nine and is still what every league answers on the boards it reads
for itself; `ColumnRanks` is that record widened with an index signature, and a
column that has forced a KeepTradeCut market or QB board carries an extra key
beside them (`ktc_total:dynasty:sf`). `lineupColumnKey` in `shared/ktc/columns`
is the only spelling of it — the client stores columns, the request names the
variants, the route ranks them and the tile reads them back, and a key spelled
twice is a dynasty superflex figure printed under a 1QB label with nothing on
screen saying so. A column on `auto` keys by its bare metric id, which is what
lets the nine base ranks answer it without the client knowing what the server
resolved.

The metric ids are a type-only union in the contract (`LineupMetricId`), and
the runtime lists live as exhaustive `Record<LineupMetricId, …>`s on each side
of the seam — the server's ranks literal, the client's `METRIC_ORDER` in
`features/shared/lineup-columns.ts` — so adding an id breaks both compiles
until it is placed. A value export from `contract/` would break that folder's
zero-runtime character, and the client cannot read a list out of
`shared/manager` without dragging `pg` into the bundle. **Adding the four KTC
ids is what that seam is for**: it broke four compiles — the ranks literal,
`lineupMetricTotals`, `METRIC_ORDER` and `LINEUP_METRIC_LABELS` — and nothing
else.

### The KeepTradeCut columns

`ktc_starters`, `ktc_bench`, `ktc_picks` and `ktc_total` price a roster on
KeepTradeCut. Four decisions carry them.

**KTC never enters the solver.** The seat order is projections first and draft
capital second — the `ADP_TIEBREAK` epsilon — and `ktc_value` is hung on an
already-seated player and read back for the totals. The two terms in `score`
are a projection of what a player will *do* and, failing that, of what a draft
room thought of him: both statements about production. A trade market is a
statement about what a player is worth to *acquire*, and letting it decide a
seat would bench a productive veteran under a rookie nobody can start. The KTC
columns report a roster's worth; they do not set its lineup.

**`ktc_total` is the only metric that includes the picks, and it includes all
three parts** — `ktc_starters + ktc_bench + ktc_picks`, so the four reconcile
exactly and a reader can see where a roster's worth sits. Capital is
deliberately not arranged that way: `capital_total` is the players alone,
because ADP prices a *player* and there is no pick ladder here to add. The
starters/bench split is exact by construction rather than by a guard —
`solveLeagueLineup` builds both out of one deduplicated roster — which is why
TheLabX's `rosterKtcValue`, whose whole job is to keep a lineup naming an
unheld player from handing back a negative bench, is not ported.

**A pick is priced by a third of its round, and most picks have no third.**
KTC names a pick "2027 Mid 1st"; Sleeper holds one by a roster, and
`leagueRosterPicks` has already turned that into the slot it falls on — snake
reversal included, because that flip is what decides which third. `pickTier`
places the slot against the league's own size, and answers null both for a pick
whose draft does not exist yet (most of them) and for a league too small for
"early" to mean anything; `ktcPickPrice` reads that as "the untiered row, then
the middle one", the convention every trade calculator uses. The pricing is a
**callback** into `leagueRosterPicks` rather than two more arguments, so
`draft-picks.ts` keeps knowing only which picks a roster owns.

**Unpriced is not zero, and the gap is real.** KTC prices three seasons of four
rounds, so every 2029 pick and every round past the fourth comes back null and
falls out of the total rather than dragging it toward zero. TheLabX's
`ktcPickDiscount` is what could extrapolate past that horizon, and it is
deliberately unported: it exists to carry KTC's season-over-season opinion onto
an *ADP* scale as a dimensionless ratio, and there is no ADP pick ladder here
to scale. It arrives with `/api/adp`. The same rule covers players: KTC's
boards are a churning top few hundred skill players, so an unpriced bench stash
is the ordinary case rather than a fault.

On the card, the four are ordinary rank tiles and the expanded browser gained a
third **lens** beside Points and Capital — three figures on three scales never
share a column, because they would read as the same unit — plus the price on
each pick pill. The pills are the one place the app's three-way grammar gives
way: an unpriced pick shows *nothing* rather than an em dash, because a dozen
pills three words wide would otherwise be more dash than pick, and the claim a
dash prevents is not available to make when there is no zero on screen to
mistake it for. `ktc_picks` is the number that *is* summed, and it is the one
that owes the reader that distinction.

On the page, each league card is the league name plus up to four rank columns
("2nd" — the field size moved to the config window's `Teams`; see The rank is
the reading, below), with the season line, team/record and the team browser
behind a
`<details>` disclosure — the browser standing under a history rail that redraws
it over the rosters of any past moment, priced at today's values (The league's
history, below). `league-card.tsx` stays hook-free on purpose, and the state a
card does need lives in `ui/league-teams.tsx` and `ui/timeline` below it. The browser is
two panes: the league's standings on the left, the selected team — the
manager's by default — solved out on the right *against the manager's own
roster*, then `DraftPicks` under both panes (all three in `features/shared/ui`
since the rail became a second reader of them) (see the console section: the
picks grid wants the full width, and they are the roster's, not the lineup's).
See The detail is a comparison, below, for the standings table and the
seat-level gaps. The panes sit side by side at
*every* width, phones included — stacking put the roster below twelve teams —
so truncation, not wrapping, is what carries a narrow card. The column's metric is a per-card
`<select>` (default ROS starters) and the list is *sorted* by it, because it
is the standings behind the card's "2nd" — the order and the number must
agree — and when every team totals zero on the metric the column shows dashes,
the same all-zero rule the server ranks `null` by. Selection is *resolved*,
not synced (`chosen ?? manager's team`), so a payload refresh under an open
card falls back rather than pointing at a ghost. The breakdown's number column
is one lens at a time, points or capital, flipped by
a per-card toggle (`useState`, deliberately unpersisted, like the metric
select): the two figures never
share a column because they would read as the same unit, and the headline total
follows the lens so it always agrees with the rows beneath it. **The lens is
owned by `LeagueTeams`, not by `LineupBreakdown`** — the redesign put both
controls on one row above both panes, because at 390px neither pane can spare
a header's width, so the state has to be visible to the keys and to the list
at once. `lineup-breakdown.tsx` exports `Lens`, `LineupLensKeys` and
`lineupTotal` for that row and renders rows only. The
column choice is a *set*, rendered in canonical order and persisted under
`thelab:lineup-columns` by `lineup-columns.ts`, a wrapper over the internal
`local-store.ts` on the same terms as `account.ts` — a set of **triples** since
the market moved into the column; see Four bays, and a column that names its
own board. The picker is a native `<dialog>`/`showModal()` (focus trap, Esc and
backdrop for free — no dependency), and it enforces its bounds by disabling
rather than correcting: the keys that would open a fifth bay grey out at four,
the last bay's clear key does too, and a switch greys the board the other bay
already holds — so an invalid selection cannot be made rather than being
repaired after.

### Four bays, and a column that names its own board

The picker was nine checkbox rows over a page-wide KeepTradeCut key at its foot.
It is four numbered bays, always four, with the market and the QB board set
*inside* a bay — so a column is a `(metric, market, lineup)` triple and the same
metric can sit in two of them. Applied from a design handoff.

**The panel has since been rewritten around those bays** — the nine keys and
their nine sentences are gone, a bay is *selected* and edited in place, and the
metrics are composed from a value and a scope rather than listed; see The Card
columns dialog, rewritten. Everything in this section about what a *column* is
still holds, and is what that rewrite is built on: the triple, the bay, the
`taken` rule, the variants on the request, and the four ranks on the server.
What it supersedes is the panel's shape, which is why the height below is a
figure the rewrite quotes as the thing it fixed.

**It needed no migration and no schema change.** `format` is a `ktc_values`
row's identity and `sf`/`oneqb` are two columns of that row, so a forced board
is a second read of a table already in hand — which is why the whole thing is
code.

**The budget is the UI.** Four is what the card's tile row holds, and a panel
shaped like the thing it configures does not have to state its own rule: an
empty bay is what says a column is free to take, and a full rack is what says
none is. The checkbox-and-lamp markup went entirely — every control is a
`<button>` now, which the two-axis bays need anyway.

**A global board key is contradicted by a column that names its own**, which is
why the old foot is deleted rather than moved. The market is not a property of
the page; it is what one of these four columns *means*. Putting it in the bay is
what makes the comparison a dynasty reader opens the panel for — one metric on
two boards at once — expressible at all, and the second axis arrives with it for
the same reason. What survives of the foot is the scrape line, per market
(`KTC scraped · dynasty 6m ago · redraft 6m ago`), because these are someone
else's numbers on a fifteen-minute cache.

**`ManagerLineupsPayload.ktc` became a list for exactly that reason.** It used
to echo the one market the page resolved, with `"mixed"` as the honest name for
an account holding both kinds. There is no page-wide answer to give any more, so
what ships is what was *read*, per market — which is also the only thing the
foot could print.

**A KTC key keeps its `+` while a bay is free, and that press is the feature.**
Pressing `KTC total` a second time opens a second bay on the same metric, so it
must not be a no-op — `nextColumn` opens the first pricing the metric is not
already held on, scanning both axes in control order, so the first press always
lands on `Auto · Auto` (which is what the empty bay's caption promises) and only
a later one lands elsewhere. The five metrics with no market have exactly one
pricing by construction, so a chosen one disables rather than pressing to no
effect.

**Two switches, and the boards the other bay holds are greyed.** `normalize`
dedupes on the whole triple, so a press that landed on the other bay's pricing
would have to either lose a column or exchange the two — one silent, the other a
key that appears dead once the canonical order puts them back. Disabling is the
rule the budget is already enforced by, and it is the one that says *why*.

**The switch tracks are `KtcBoardKeys` with a `size` arm, never a second copy.**
`SwitchTrack` is generic over the option type so the two axes share the grammar
without sharing the vocabulary — a market is `dynasty`/`redraft` and a lineup is
`oneqb`/`sf`, and a parser handed the wrong list would reject nothing. Two rows
of three rather than one row of six is the same argument at the layout grain:
six keys across a 144px bay is 24px each and "1QB" stops being a word.

**The panel scrolls, where it used to clip.** A rack of four bays over a
nine-key list is 1,192px at 390 against a `<dialog>`'s UA `max-height` of the
viewport less a little — so the `overflow: hidden` it inherited put the Done key
somewhere no scroll could reach. `overflow-y-auto` still clips to the radius,
which is what the hidden was doing the rest of its work for, and the grain
overlay moved inside the content so it does not end at the fold.

**The request carries the variants, not the columns**, and the difference is a
round trip. The ranks a column reads are its variant's four, and the nine base
ranks always ship — so `ktcVariantsOf` reduces the selection to the distinct
non-`auto` pricings, `?ktc_boards=dynasty:sf,redraft:auto` carries them, and
that string is what joins `useManagerLineups`' subject key. Adding a ROS tile,
or a KTC tile on the league's own board, therefore costs nothing; forcing a
market costs the one round trip it always cost. Sending the columns themselves
would have made every press blank the page.

**On the server it is four more ranks, not a second solve.** KTC never enters
the seating, so a forced board changes what a roster is worth and not who is in
it: `ktcMetricTotals` re-totals the lineups already solved against a second
price table, and `variantPickValues` re-prices the cells `leaguePickBoard`
resolved once — never a second grid, which is the reconstruction `draft-picks`
is arranged to avoid and the one way a forced board's `ktc_picks` could disagree
with the pills on the card. `LeagueTeam.totals`, the expanded card's lens and
the timeline all stay on the league's own board, which is why the card passes
the rail `board="auto"` rather than a stored preference: a past stop priced on a
different board from the present table beside it is two numbers on two rulers.

**`storeKtcBoard` / `useKtcBoard` stay**, for the trades board's control rail
and for the shares drawer's Value column — one figure for a player held across a
dozen leagues, where there is no league for `auto` to resolve against. Only the
manager page's *rank columns* stopped reading a page-wide board.

### The detail is a comparison

The expanded card's right pane used to be one roster read on its own, which
made picking a team on the left read as "a different roster" rather than as
"how do I stand against them". Two changes turn it into the second, and
**nothing on the wire moved for either** — no field, no route, no query. Both
are derived from the `LeagueLineupEntry` the page already holds, which is what
makes them affordable at all: a rank across a league's rosters is something
only the server can compute, but a *gap* between two of them is arithmetic.

**The standings pane is a table with a gap column** — place, team, the gap to
the reader's own total, that total, and a meter on the rank ramp. The place is
the row's own index, so it cannot disagree with the order the metric select
sorted by, and the meter and the hue both come off `rankPercentile` so the bar
and the colour cannot disagree either. Under the all-zero rule the totals go to
dashes as before, and **the meters and the ramp go with them**: a full red bar
under a table nobody has scored in claims a last place nobody finished in,
which is the distinction `rankPercentile` exists to draw.

**The sign describes the row and the colour describes the reader**, which looks
like an inconsistency and is the whole grammar. A team above you carries `+12.4`
because that is their total less yours; it is drawn red because being behind is
not a result you wanted. The seat rows opposite read the same way, and the one
place the two orientations are actually separate values is `SeatCompare`, which
carries `delta` (spatial, printed) and `standing` (the reader's side, coloured)
as two fields rather than one signed number that means different things in
different modes.

**Each seat carries the reader's own figure and the gap between the two, drawn
on the side of whoever leads.** Two tracks, only ever one of them filled: the
left sits under the figure on screen, the right under the ghost. Its length is
`|gap| / span × 1.4` clamped at 100, where `span` is the largest figure *any*
team has at that seat — seat-level gaps are small beside the seat's own scale,
and without the multiplier every bar is a sliver. Seats are matched **by index,
not by slot name**: `roster_positions` is the league's own starting lineup and
is identical across every roster in it, which is also what makes a league with
two `RB` slots compare RB1 to RB1.

**A seat where either side is null has no gap at all**, and this is the rule
most likely to be got wrong. Scoring an unpriced player as zero hands the other
side a maximal, full-length lead on a row whose own figures say there is
nothing to compare — and, being the largest number in the column, it would set
the span and squeeze every real gap in the pane into a sliver. `points`,
`adp_value` and `ktc_value` are each documented "null is not zero"; this is that
rule at seat level, and `seat-compare.test.ts` is what pins it.

**The reader's own team has nothing to compare against, so the ghost becomes
the league's best at each seat** and the pane's header says `Best in league`
rather than naming a team. Holding that best is **level, not a lead** — no bar,
no colour — which is the one reading a uniform "greater than" would have got
wrong, since the best figure includes the reader's own.

**The bench summary gained its total and its league place**, and the place is
computed client-side because it moves with the lens rather than with the
payload — `placeAmong` in `lineup-metrics.ts`, standard competition ranking,
null where there is nothing to rank. The total is read off `LeagueTeam.totals`
and never re-summed, per the contract's own note.

**The arithmetic is a pure module under Node's runner** (`helpers/seat-compare.ts`),
for the reason `league-filters/predicates.ts` is: a gap drawn on the wrong side,
a bar scaled against the wrong span and a null scored as a zero all render
perfectly and say something untrue. `Lens` and `lensValue` moved there with it,
so "which field does this lens read" has one spelling; `lineup-breakdown.tsx`
re-exports `Lens` and every existing caller is unchanged.

**Two breakpoints on one component, and both are measured.** The column layout
turns at **`lg`** and the control row above it at `sm`. The handoff specifies
`sm` for both; a render at 640 is what refused it, and the failure is the
layout at its most confident and least true — the left pane is 252px, of which
the four figure columns take 212, so every team name renders as **one
character** and the roster's names disappear altogether. Under `lg` the
two-line rows carry it, as they already do at 390, and they give a name *more*
room at 768 than the columns would. The rack made the same measurement and
moved to the same breakpoint for it. The control row is a different question:
three controls fit one line from `sm` up, so they take it — with the "Rank by"
recess at design 3a's own smaller sizes below that, which is what stops it
wrapping to a third line at 390.

**Every row is one node with two layouts**, through `lg:contents` on the second
line's wrapper — the trick the app rack's brand row already turns. Rendering
both shapes and hiding one would put every seat in the DOM twice and read each
of them twice to anything listening.

**The colours are the ramp, not the mock's literals.** The handoff transcribes
`oklch(0.9 0.1 150)` and `oklch(0.9 0.1 25)` for the gap column and then says
to use `rankColor()` for the seat bars; the ramp is right for both, because it
reads its ends from `--rank-l` and `--rank-c` and those are what invert for
light mode. `rankColor(100)` and `rankColor(0)` are the same two hues the
literals name.

**Verified without a database**, the method the console-card and shares passes
established: a temporary `/preview` route rendering the real `LeagueTeams` and
`LineupBreakdown` against a fixture entry — twelve teams, a missing seat, an
unprojected stash, and a second entry whose every total is zero — driven over
CDP at 390, 640, 900, 1024 and 1280 in both schemes, then deleted. Every arm
landed: an opponent selected drew red bars pointing left and green pointing
right with the lit names on the seats the reader wins; the reader's own team
drew `VS BEST IN LEAGUE` with no bar on the seats they hold the best of; the
KTC lens drew em dashes and **no bars** on the two seats with no price on either
side; the all-zero entry drew dashes, empty meters and neutral ramp throughout.
At every width and in both schemes: `documentElement.scrollWidth` equal to the
viewport, nothing painted outside the card's own box, one `<h1>`, one
`aria-pressed` row, the metric select labelled, and **no console output of any
kind**. The numbers are fixtures; what they check is the rules and the layout
rather than Sleeper.

**Every team's future draft picks ride its `LeagueTeam`**, the way Sleeper's
own team page lists them, and the reconstruction is the part that is easy
to get wrong: Sleeper's `traded_picks` lists only picks that have *changed
hands*, so a portfolio is the whole enumerated grid — every roster owning its
own pick per (season, round) — with the traded rows overriding cells.
`shared/manager/draft-picks.ts` is TheLabX's module ported whole with its
tests: `dynastyPickGrid` fixes the three-season horizon a dynasty league's
pick market actually runs (a startup never counts as this year's rookie class,
and only `complete` rolls the window — both readings fail toward showing a
pick that exists), while every other format derives its grid from the trades
because it has no standing horizon to read. A dynasty grid's **depth** is the
league's own `settings.draft_rounds`, exact — future drafts are created from
that setting, so a traded pick deeper than it is a relic of a since-shrunk
draft and falls off the board — with the last rookie draft's rounds and the
deepest traded round as the two floor readings only where settings say
nothing. `leagueRosterPicks` is this
repo's addition to the file (born `managerRosterPicks`; the team browser is
what made it per-roster): it composes in TypeScript what TheLabX's
`getDraftSlots` does in SQL-plus-cache (one manager's leagues per request
don't need a tier), keeping its four decisions — the season's latest draft
wins and is chosen *before* its order is read, an auction's order is not a
pick order, and the slot comes off `draft_order` through the **original**
roster's owner, because that slot is where the pick actually falls — and
adding a fifth: the shipped `slot` is the *pick-in-round*, so a snake draft
flips it on reversed rounds (`snakePickInRound`, third-round reversal
included, where round 3 repeats round 2's direction). The flip pivots on the
board's width — `settings.teams`, else the deepest slot in the raw
`draft_order` blob, scanned whole because a departed user's slot still proves
the board runs that wide — and a snake draft with no width evidence names no
slot rather than an unflipped guess. `from` is
relative to the owning roster — the same asset is "from Slim" in one portfolio
and origin-less in the one it came out of — and it names the *person*
(display name), where the teams pane prefers the team name: "from" points at
who traded it away. The card's
naming rule is Sleeper's: "1.05" once the order is set, "2nd" before, and the
origin printed only where there is no slot to say which
pick this is — the payload ships both facts (`slot`, `from` on `RosterPick`)
and the rule lives in `draft-picks.tsx`. The pick context rides the same
`getManagerLeagueRosters` row the ranks are solved from (`ManagerLeagueRow`),
so the two answers cannot come off different league sets.

**The ordering is projections first, draft capital second — as arithmetic, not
as a second code path.** `manager/ros-lineups.ts` hands the solver one number
per player: rest-of-season points plus `adpValue · 1e-7`, the scale chosen so
the largest possible ADP contribution (10,000 · 1e-7 = 0.001) sits below the
0.01 that points are rounded to. A projected point can never be outbid by
draft capital; capital only decides among players whose projections say
nothing — unprojected stashes, and whole leagues when no projections were read
(a past season, a failed feed). The payload carries the real pair (`points`
null when unprojected — never zero — and `adp_value`), so the epsilon cannot
leak into a total.

The solve itself is TheLabX's, ported whole with its tests: `optimal.ts` (the
matroid-greedy lineup solver — overlapping flexes are why it isn't a sort),
`score.ts` (a league's own scoring as a dot product — Sleeper's `pts_ppr` is
its *default* scoring, and TE-premium or 6-pt-pass leagues differ by exactly
the margin that misseats a bench), and `aggregate.ts` (sum stat lines, then
score once — scoring is linear, so that is exact).

**Projections are fetched on request, not stored — deliberately.** TheLabX
syncs them to Postgres because its background loops read them every tick; here
the lineups route is the only reader, so `projections/ros-read.ts` pulls the
remaining weeks from Sleeper's data host (`api.sleeper.com`, undocumented — the
type doc on `SleeperProjection` is the contract) through the same limiter as
everything else, folds them (`ros.ts`), and keeps the folded board in process
for 30 minutes. A failed span is evicted, never cached — the
`memoize-manager-lookup` rule — and degrades to `from_week: null` plus the
fallback rather than failing the route. Rows with a null `game_id` are the
feed's "no game this week" and carry ADP placeholders in `stats`; folding them
in would sum draft metadata into a season total. The identity half of a row
(name, positions) is read from *any* row, though — an unprojected player still
needs positions to be seated by the fallback at all.

The fallback's ADP comes from the drafts already synced with the manager's own
league graph (`getManagerDraftAdp`), split superflex/standard by counting
`QB_ELIGIBLE_STARTING_SLOTS` in SQL — the same derived list `isSuperflexLineup`
reads, bound as a parameter so the two spellings cannot drift. Coverage follows
that data: a dynasty league's synced draft is its rookie draft, so vets there
have no number and an unprojected vet sorts to the bench bottom with nothing to
say. That is the fallback degrading honestly, not a bug; the real boards arrive
with `/api/adp`.

**It is split a second way, and that split is not cosmetic.** Rookie drafts are
aggregated apart from full ones and shipped as `AdpEntry`s naming their board,
because a rookie draft's `pick_no` and a startup's are not the same unit — see
Valuing a roster off ADP for the map that makes them summable again, and for
what the pooled read was doing to every rookie on the page. **A rookie draft is
exactly a dynasty league's non-startup draft**, the same rule `dynastyPickGrid`
reads and spelled from the same two facts: only dynasty drafts a class rather
than a pool, and only an *inaugural* league holds a startup of its own — its
earliest draft, since it runs a startup and a rookie draft under one season
label. A keeper league's draft is a full draft with some picks pre-spent, and a
continuing redraft league's is a full draft too; neither is a rookie board.
`DYNASTY_LEAGUE_SQL` and `INAUGURAL_LEAGUE_SQL` are the fragments, and the
sequencing runs over the league's drafts **whole**, before the two exclusions
below — the startup is the earliest draft that exists, not the earliest one that
survived a filter.

**Where a player sits on both boards the full one wins.** It prices him against
the whole pool, which is the scale `leagueAdpPool` anchors to and the map only
approximates; the rookie board is there to answer where there is no full-draft
number at all, which on a dynasty-only account is every rookie.

**Two drafts are excluded outright.** An auction's `pick_no` is nomination order,
which is not a pick order — the rule `leagueRosterPicks` already lives by, and
averaging it in was pricing players off the order they happened to be called in
(a nomination-1 player read as the best in the game). And a draft that is not
`complete` has only its earliest picks stored, so everyone taken so far reads as
a first-rounder while the rest of the board has nothing; a half-finished rookie
draft is the case that makes it worst. The cost is that a rookie class has no
number until its drafts finish, which is the same "coverage follows the data"
the paragraph above already trades on.

`DYNASTY_LEAGUE_TYPE`'s doc predicted this fragment and said the constant would
move back beside it. It stayed in `draft-picks` and the fragment came to the
constant instead: `draft-picks` is pure and unit-tested under Node's runner, so
it must not import a module that pulls in `pg`.

**Verified against a throwaway cluster rather than the live database**, since
the classification is a statement the unit tests cannot reach: `migrate:up` onto
an empty Postgres 16, then one fixture league per arm — continuing dynasty,
inaugural dynasty carrying both its startup and its rookie draft, continuing
redraft, keeper, auction, mid-draft, and a tombstoned league — driven through
the real `getManagerDraftAdp`. Every arm landed where it should: the inaugural
startup and the continuing redraft on `full`, the inaugural league's *later*
draft on `rookie`, keeper on `full`, and the auction, the unfinished draft, the
tombstoned league and a null `player_id` all absent. Running the pre-split query
over the same rows is the contrast worth keeping — at a 108 pool a rookie 1.01
went 10,000 (the peak itself) to 8,235 and a rookie pick 24 went 6,663 to 1,989,
while the auction's nomination-1 and the half-drafted board's pick 1 were both
reading 10,000 and are now gone. **Every player priced off a full draft is
unchanged to the point**, which is the check that the split moved only what was
contaminated.

`shared/ktc/roster.ts` is the superflex predicate, trimmed from TheLabX's KTC
pricing the way `adp-value.ts` was from its board half — ADP boards and lineup
pricing both split on it and a second spelling is the drift it prevents. The
folder's sync half arrived since; see the KeepTradeCut section below.

## The league's history

An open league card carries a rail over every move the league has on file, and
dragging it redraws the card's own team browser over the rosters of that
moment — **priced at today's values**, so a reader can see what a team would be
worth now if it had stayed as it was. `GET /api/league/[leagueId]/timeline`
backs it. TheLabX's feature ported, minus its trade anchor, redrawn in this
app's console vocabulary, and answering a question that repo's version does not.

**It needed no migration**, and that is the schema's doing rather than luck:
`transactions`, `rosters`, `traded_picks` and `drafts` are exactly what the
league-graph migration put in and what the crawler and the manager sync have
been filling since. Nothing here writes.

**Sleeper stores no history, so the rail is a reconstruction.** `rosters` is
only ever *now* and there is no endpoint that answers "what did this team look
like in October" — what there is, is the whole transaction log. So the state at
any past moment is today's roster with everything since undone, walked
newest-first. `shared/timeline/rewind.ts` is that walk, ported whole with its
tests.

**The log crosses the wire, not the answer**, which is the whole design. A stop
is the current rosters with the moves since it reversed, and there is a stop per
move — so an answer per stop would be the league's rosters times its
transactions, where the log is the transactions alone and the reversal is
arithmetic a browser does thousands of times a second. One request buys every
stop, so scrubbing costs nothing after the first.

### The metrics are kept, and they are today's

The first cut of this dropped the card's nine metrics at a past stop, on the
reasoning that a rest-of-season projection is for the season that is *left* and
a KTC price is this morning's, so attributing either to a roster that stopped
existing in October is a wrong number rather than an old one. **That reasoning
is intact and the conclusion was wrong**, because it answers a question nobody
was asking. Nothing here keeps a history of a projection, an ADP or a market —
all three boards are only ever *now* — so "what was that team worth then" is not
answerable at all. What *is* answerable is the thing a reader scrubbing back
actually wants: **what would that team be worth today**, which is what makes a
trade or a drop legible after the fact. `features/shared/timeline-entry.ts` is
that counterfactual, and `timelineCaveat` is where it is said out loud, because
a table of ordinary-looking figures is exactly the place a reader would assume
the opposite.

**The past is the card's own browser over different rosters**, not a second
view of the same league. `LeagueTeams` draws both — the same metric column, the
same Points/Capital/KTC lens, the same seat breakdown, the same pick pills —
and `rankLeagueLineups` prices both, reached directly from the browser because
**every module in that solve chain is pure**, which is what those files have
said all along and what this is the first caller to depend on. So a past total
and a present one cannot be computed two ways, and the seat order, the nine
totals' edge rules and the all-zero rule are the ones already documented.

**One element at one position, and that is a behaviour rather than a tidiness.**
`TimelineView` renders the browser itself rather than swapping the card's for a
second component, so React keeps the instance across a scrub: the reader's
metric, lens and selected team all survive crossing "now". Two elements would
reset all three on every move, which on a control whose whole purpose is to be
dragged is the difference between a comparison and a nuisance.

**The pricing inputs cross the wire, not the prices.** The payload carries
today's projections, ADP and KTC for the union of players the timeline can name,
plus every cell of the pick grid; the browser solves each stop. That is the same
trade the log makes one paragraph up, for the same reason — the alternative is a
priced answer per notch.

**Three narrowing parameters, and they are the lineups route's own.**
`?season=`, `?user=` and `?ktc_board=` decide which boards answer, and a past
roster priced on a different board from the card in front of the rail is not a
comparison — it is two numbers on two rulers. `?user=` is the one that looks out
of place on a league-scoped read and is the one that matters most: the ADP
fallback board is built from *that manager's* synced drafts, so without it the
three capital metrics have nothing to price against and rank null. A malformed
`?season=` is a 400 and an unreadable `?ktc_board=` falls back to `auto`, which
is the opposite call for the opposite reason (see `parseKtcBoardChoice`); an
unknown `?user=` is neither, because the manager is not this route's subject —
it costs those three columns and nothing else.

**Every read degrades rather than failing**, on the lineups route's exact terms:
a missing projections span, an unreadable market and an account with no synced
drafts each leave their own half empty, and the all-zero rule turns a wholly
unpriced metric into dashes. A payload with **no pricing at all** still draws
the table, every column dashed — the rosters are the answer a reader came for,
and the numbers are the enhancement.

### What the pieces are, and why they moved

- **`rewind.ts` is pure and a browser is its second reader.** Its one import is
  `shared/trades/jsonb`, which is equally pure, so it unit-tests under Node's own
  runner and `features/shared/timeline.ts` imports it directly — the deep-import
  exception `@/shared/ktc/roster` and `shared/projections/slots` already earn, and
  the reason `shared/timeline`'s barrel (which drags `pg` in) is server-only.
- **`leaguePickBoard` reads one grid three ways.** `leagueRosterPicks` is its
  `byRoster` and nothing else now; the split exists because a rewind needs the
  **cells** — a pick's slot comes off the draft order through the *original*
  roster's owner and its price comes off that slot, so both are facts about the
  cell rather than about whoever holds it. A stop moves cells between rosters and
  changes nothing about a cell, which makes a rewound portfolio a lookup rather
  than a second resolution of a draft order. `owned` is the third reading, and it
  is there so the rewind starts from the *same* enumeration the price table is
  keyed by: a dynasty league's grid is `dynastyPickGrid`'s horizon and every
  other format's is derived from its trades, so a second call with a different
  grid argument would rewind cells the card cannot price.
- **`getLeagueLineupRow` is `getManagerLeagueRosters` for one league**, over the
  extracted `LINEUP_LEAGUE_COLUMNS_SQL` so the two cannot drift.
  `HOLDS_A_ROSTER_SQL` is deliberately absent — that predicate answers *which
  leagues are a manager's*, and there is no manager in this question — while
  `LIVE_LEAGUE_SQL` stays.
- **`restOfSeasonStart` moved to `shared/projections/weeks.ts`** and takes its
  state reader as an argument. Two routes now ask which weeks are the rest of the
  season, and they must agree; the argument is what keeps that module free of the
  network.
- **`pickValue` is exported from `manager/league-teams`**, so the two pick
  vocabularies meet in exactly one place. A second meeting is a past pick priced
  off a different third of its round from the one the card shows.
- **`LeagueTeams`, `LineupBreakdown` and `DraftPicks` moved to
  `features/shared/ui`** on the line `CONSOLE_KEY`, `ManagerPlate`,
  `LeagueFiltersDialog` and `LeagueConfigWindow` all moved on: a second reader.
  **The timeline subtree itself deliberately stays *out* of
  `features/shared/index.ts`** and the card names its module path — that barrel
  is imported by every page, and from it the rail, the rewind, the solve and the
  fetch hook would join the graph of the four that draw none. It is
  `local-store.ts`'s exception argued from the other side.

### The rest of the reconstruction

**The read is behind a press, and that is a bound rather than a nicety.** A
`<details>` hides its body rather than unmounting it, so on a 113-league account
every card's rail is mounted at once; this is also the heaviest read the manager
page makes — a season of one league's transactions, its whole pick grid and a
projections board. So the seat is a `History` key and `useTimeline` is disabled
until it is pressed. Nothing caches in front of it and nothing needs to while the
page stands: the hook keeps its answer for as long as the card is on screen, and
the route's own `private, max-age=60` covers a card that goes and comes back.
**Every field of the subject is in its key**, so a season or a market flip blanks
the payload for one round trip rather than leaving the old board's prices under
the new board's name — the cost `useManagerLineups` already pays for the same
flip and for the same reason.

**The far end is this league id's log and no further, which is a real limit
rather than a shortcut.** A Sleeper league id *is* one season and a dynasty
chain links seasons through `previous_league_id`, so the obvious extension is to
keep walking into last year. It is not sound: rosters carry over between seasons
through no transaction at all, so there is nothing to reverse across the
boundary and a walk that crossed it would report last season's league as though
this season's roster had always been on it. The honest far end is the first move
this league recorded, which is roughly the post-draft roster.

**Two limits ride along and only one of them is stated to the reader**, which is
a judgement rather than an omission. A draft is not a transaction, so a stop
reaching back across a rookie draft leaves that class on the rosters that took
it — visible on screen. The pick horizon is today's, so a pick in a season
already drafted is absent unless a reversed trade names it — which shows up as
picks quietly missing, and no wording on a note is going to make it legible. The
caveat's four sentences already carry the moment, the date, the reconstruction
and the pricing; a caveat that lists everything is one nobody finishes.

**The order is the league's own at every stop and never the moment's** —
`timelineRosters` returns roster-id order and `LeagueTeams` sorts by whichever
metric its column shows, exactly as it does at "now". **The manager naming a
block is today's**, which is the honest limit rather than an oversight: Sleeper
stores no past ownership, so the block says "roster 4, which so-and-so holds
today", and naming it after somebody who has since taken it over is a smaller
error than not naming it at all. The reader's own team is marked **by roster
id**, which the card knows and the payload does not — `user_id` is on the wire
only as the join the solve's own manager lookup needs.

**`back` rather than a stop index is the state the view holds**, and that is a
decision rather than a spelling: the payload arrives after the card opens, so an
index into a list that does not exist yet has to be reconciled when it does,
where a count back from now is 0 before the request lands and 0 after it. That
is exactly the "it opens as it always did" promise — at `back` of 0 the view
renders the card's own entry, untouched.

### What changed against TheLabX

- **The past pane is priced, where theirs is not.** That repo draws a second
  two-pane view and gates its columns per metric, allowing only board prices
  through and dashing the rest with a note telling the reader to press `Now`.
  Here there is no second view and no gate: the card's table is redrawn over the
  rewound rosters with every metric answered on today's boards, and the caveat
  says so. Its version answers "who held what"; this one also answers "and what
  would that have been worth".
- **No anchor.** That repo's rail has two hosts: a trades-board sheet opened
  *from* a trade, which stops there, and a leagues card, which runs the whole
  log. There is no such sheet here, so `RosterTimelinePayload` carries no
  `anchor`, `timelineOrigin` collapses into the one wording the far end can
  have, and `tradeRosterIds` — which marks the rosters that dealt so they sort
  first — has nothing to mark. The field arrives with the sheet.
- **No `managers` map.** That payload ships one because its view resolves a
  pick's origin to a holder its card may never have heard of. This one carries
  *every* roster in the league, so an origin is always a row on the list already
  in hand — the name is resolved server-side by `leagueTeamName`, the same
  spelling the teams pane calls the team by, so "now" and "then" cannot disagree
  about whose roster this is.
- **No react-query.** `use-timeline.ts` is the house idiom instead: one abort
  controller lineage, a reset *during render* on a subject change, `loading`
  derived rather than stored. It **reports** its failure where
  `useManagerLineups` swallows one — that hook is an enhancement beside a list
  that stands on its own, where this is the only thing behind the rail and a rail
  that opened onto nothing with no word saying why is indistinguishable from a
  league with no moves.
- **`rewindTradeRosters` is not ported.** It emits a snapshot every time the
  walk crosses a trade so a `trade_rosters` table can store what each side
  brought to it. There is no such table here; it arrives with one.

### The rail is the console's, not the original's

TheLabX draws two rows of chips. Here it is one row of instruments, and the
difference is where the moving line went: there the stop's own summary rides the
rail beside the date, here it leads the caveat under the table — the line
already explaining how those rosters are known. That leaves three fixed parts
and lets **the seat be the same height in all five of its states**, so pressing
`History` moves nothing under it. The 50px floor is measured, not chosen: the
key's row is 36px and the rail's is 35.

The grammar is the card's own. The slider sits in a labelled recess — the shape
the `Rank by` control one row down already wears, and the only thing that says
what the rail *is* once the key it replaced is gone — running in a cut channel
with the rank tiles' meter fill behind it. The moment is a lit readout, `Now` as
a **word** rather than today's date, because the present is not a date anybody
scrubbed to. The two ends are one lit key in a track, which is
`LineupLensKeys`' switch grammar: at a stop in between, neither is lit, which is
the honest position for a switch standing off its detents. `.lab-rail` in
`globals.css` is the one thing not expressible as utilities — a range input's
track and thumb are pseudo-elements — and it does nothing but clear the UA track
and make the thumb a key, both from tokens so one rule reads in both themes.

**`formatInstantDate` / `formatInstantTime` moved into `features/shared/format`**
and the trade card's plate now reads them. Its two-span responsive rule stayed
where it is — dropping the year below `sm` is that plate's own width argument —
but the punctuation is one spelling now, which is what stops two parts of one
console from writing a date differently.

### Verified

Rendered through a temporary `/preview` route against the real components,
tokens and Tailwind build — the method the console-card, shares and rack passes
established, since no database is reachable from where this was built — then
screenshotted over CDP at 1280 and 390 in both schemes and deleted. The two
mechanics that method needs are unchanged and worth restating: Chrome must be
launched with `--no-proxy-server`, and a phone-width viewport has to come from
`Emulation.setDeviceMetricsOverride` rather than `--window-size`, which headless
Chrome clamps to ~485px.

**The counterfactual was driven end to end**, which is the check this pass exists
for. Over a fixture league whose two teams swapped quarterbacks, the far stop
read `Slim's Squad 216.0 / Dynasty Warriors 198.0` against `342.0 / 204.0` at
"now" — the rosters from before the trade, on today's projections — and the same
scrub on the KTC column read `45,006` then against `43,859` now, which is the
whole point stated in one number: that team *was* worth more. The pick pills
rewound with them, Slim's 1.09 appearing in the other portfolio still priced at
4,870 off its own cell.

**The state survives a scrub**, which is the one-element claim: switching the
column to KTC at "now" and pressing `Start` left the select on `ktc_total` and
the selected team on Dynasty Warriors. All five seat states were driven, four of
them for real: the `History` key, a press producing `Reading history…` at 120ms
and — with no database behind the route — `Failed to load the league's history`,
which is the failure arm end to end. Both seats measured **exactly 50px**. At 390
the rail wraps to two lines and `document.documentElement.scrollWidth === 390`,
with one `<h1>` and `aria-pressed` on every end key and team row.

`timeline-entry.test.ts` is where the arithmetic is pinned rather than rendered:
that a stop back prices the roster they *had*, that every metric moves with it
rather than only points, that `ktc_total` still reconciles at a past stop, that a
rewound pick returns to its sender priced from its cell, that a manager the card
has not named yet marks nothing and ranks nothing while every roster still
solves, and that a payload with no pricing is a table of dashes rather than no
table.

**Not verified against real data**, which is the gap to close first: every number
above is a fixture, and what the fixtures cannot check is the shape of a real
league's log — how long a season's rail actually is, how heavy the trimmed
projections board is on a full union, and whether the pick grid a stop
reconstructs matches the one the card draws beside it at `Now`.

## Choosing a KeepTradeCut market

KTC publishes two markets, and which one a league should read is *usually*
obvious from its type and not always — a deep keeper league trades like a
dynasty, and somebody comparing a keeper league against a dynasty one wants
both on one scale. So the board is a **reader's choice** with three states:
`auto` (the default), `dynasty` and `redraft`.

**`auto` is a rule, not a third market.** A dynasty league reads the dynasty
board and everything else reads redraft — keeper, chopped and redraft alike.
Keeper is the arguable one and it falls that way deliberately: KTC has no
keeper market, the two it has differ by how much a rookie stash is worth, and a
keeper league carrying one or two players is far closer to a redraft than to a
dynasty. A reader who disagrees has the forcing states, which is what they are
for. Verified live: `auto` sent exactly the 79 dynasty leagues of a 113-league
account to the dynasty board, which is the only board with pick rows, and
`ktc_picks` ranked in exactly those 79.

**The rule lives in `shared/ktc/board-choice.ts` and nowhere else**, because it
has four readers — the lineups route, the trades route, the manager page's
Columns dialog and the trade card — two of which cannot see that folder's
server-only barrel and deep-import it the way they already reach
`@/shared/ktc/roster`. `DYNASTY_LEAGUE_TYPE` comes from `manager/draft-picks`
rather than being spelled `2`, so the pick grid and this cannot come to
disagree about what "dynasty" means.

**An unreadable value becomes `auto` rather than 400ing**, which is the
opposite call from `parseRequestedSeason` and right for the opposite reason. A
season names *which data* a page is about, so `?season=abc` has to fail or a
reader is shown one year under another's heading. A board names which of two
prices to print for data already chosen, and `auto` is the neutral form of that
question — the reading `/api/trades` gives every one of its narrowing
parameters.

**One stored preference, read by both pages** (`thelab:ktc-board`, on
`account.ts`'s and `lineup-columns.ts`'s terms). It sits inside `/trades`'
**Value** panel — the board says which of KeepTradeCut's two markets answers,
and KTC is one of three bases there, so out on the control rail beside Filters
and Search it read as a control over every number on the page rather than over
one basis of three; it is disabled on the other two, which is argued where the
panel is. The manager page's **shares drawer** reads the same key for the Value
column — one figure for a player held across a dozen leagues, so there is no
league for `auto` to resolve against and the stored answer is the only one there
is.

**It used to sit at the foot of the Columns dialog too, and that is gone.** The
argument for putting it there — it is not a view of the leagues, it is what four
of those nine columns *mean* — is exactly the argument that has since moved it
one grain further in, into the bay: a column names its own market now, so a
page-wide key would be a second answer to a question four columns each give
their own, and it could not express the comparison the bays exist for. See Four
bays, and a column that names its own board.

**So the two remaining readers are two different questions**, which is why one
key still serves both: on `/trades` it picks a market for a basis, and on the
shares drawer it stands in for a league that cannot be resolved against. Neither
is a column naming its own board, which is the one reading that no longer comes
from here.

### The one asymmetry, and why

**The manager page sends the choice; the trades board does not.** The
difference is what the number is *for*.

On `/manager` the four KTC columns are **ranked**, and a rank across a league's
twelve rosters is something only the server can compute — so the market rides
the request and joins `useManagerLineups`' subject key, which blanks the ranks
for one round trip rather than painting the old market's numbers under the new
label. That is the cost a season change already pays, for one request covering
the whole page.

**What rides it is no longer one choice**, since the market moved into the
column: `?ktc_boards=` names the distinct pricings the reader's bays have
*forced* (`dynasty:sf,redraft:auto`), the nine ranks on each league's own boards
always ship, and the payload echoes what was **read**, per market, rather than
the one board that answered. See Four bays, and a column that names its own
board — including why a page-wide `"mixed"` had no honest reading left once two
columns could sit on two markets deliberately.

On `/trades` the number is only **printed**. Putting the flip in `TradeRequest`
would reset a scrolled keyset walk to page one to change a display unit — the
documented cost of that board having no `keepPreviousData` — so the payload
carries **both** markets per asset (`assetValues`) and the card picks. What is
*not* left to the browser is the superflex axis: which of KTC's two QB columns
a league reads is a fact about the league, not a preference, so it is resolved
server-side and one number per market crosses the wire. Verified live: flipping
to Redraft changed every figure on screen with **zero** fetches and all 100
loaded rows held, while the same flip on `/manager` issued exactly one request.

`assetKey` is **league-scoped**, for the reason `pickSlotKey` is: a pick's own
identity (`k:2027:1:5`) describes a different asset in every league on the
board, so an unscoped key would have one league's first quietly priced as
another's. It is declared in `shared/trades/asset-keys.ts` rather than beside
the card, because the route writes these keys and `shared/` must never import
from `features/`.

### Verified

Run against the live database on the day it landed. `npm run migrate:up`
reported "No migrations to run", which is the claim the KTC section makes about
`sleeper_id` being a backfill rather than a migration, and the reason this is
code only.

A forced sync resolved **463 of 492** dynasty skill players and **369 of 371**
redraft entries (300 before the `PK`/`DST` rename), with every `RDP` row still
null — a pick is not a Sleeper player — and no id whose position disagreed with
its KTC row. The 29 dynasty misses are the matcher refusing an ambiguous pair,
which is the behaviour rather than the shortfall.

`/api/user/jkap86/lineups` answered 200 on all four board values.
`ktc_total === ktc_starters + ktc_bench + ktc_picks` held for **every team in
every one of 113 leagues**; `?ktc_board=auto` priced all 113 and ranked
`ktc_picks` in exactly 79 — the account's dynasty count — where `=redraft`
ranked it in **none** and `=dynasty` in 80 (the extra being a non-dynasty
league whose picks have been traded, so its derived grid has rows). A superflex
dynasty league priced Jayden Daniels at 7123 and its unplaced 2027 first at
5592, both `sf_value` to the digit, with rounds 5+ null — KTC prices four.
`?ktc_board=nonsense` answered as `auto`; `?season=abc` still 400s.

`/api/trades` shipped 380 asset values for a 100-trade page: 114 picks, all
dynasty-only, and 143 assets priced on the dynasty board alone. Every figure
matched the stored row for its league's own QB column.

Over CDP at 1280 and 390 in both schemes: nine options in the Columns dialog
with the fifth greying out at four, the board keys reading `AUTO`/`DYNASTY`/
`REDRAFT` with the readout `mixed · 11m ago`, four rank tiles on a card, three
lens keys, and pick pills reading `1st 5,592` / `2nd 3,444`. Exactly one `<h1>`
per page and `document.scrollWidth === 390` at phone width with a card open.

## Filtering the league list

`features/shared/league-filters` narrows the manager page's leagues on five
dimensions, and the split between them is the design: **two are fixed segments
over what a league *is*** (Type — Sleeper's `settings.type` 0/1/2/3 — and
Format, which is `best_ball`), and **three are lists of rules the reader
builds** (Settings, Roster slots, Scoring), each rule a key, a comparison and a
number. The four questions worth one press survive as quick-adds that write the
equivalent rule: `QB+SF ≥ 2` *is* `isSuperflexLineup`, spelled in a vocabulary
the reader can then edit into `QB+SF = 3`.

Ported from TheLabX minus its `season` and `status` fields. Season is gone
because this route answers one season by construction, so the control would have
a single option — a fact rather than a choice, which is what its own
`SeasonBand` self-hides for. Status was out of scope. Both removals are enforced
by the compiler: `FIXED_FILTERS`, the `ActiveFilter` union and `clearFilter`'s
switch are walked generically, so a field added or dropped breaks every reader.

**The leagues payload carries Sleeper's `settings`, `scoring_settings` and
`roster_positions` whole, and that is what the rule builder costs.**
`ManagerLeague` was trimmed to what the card renders; these three came back
because the Settings and Scoring menus are built from *the keys the leagues in
hand actually carry* — what a league pays for and how it is configured are house
rules, and a fixed list of derived flags would offer keys nobody sets while
hiding the one someone wants. Measured on a 113-league account: 519KB of NDJSON,
33KB gzipped, and the two `result` messages on a refresh stream each carry the
list. The compression is why this is affordable; the menus it buys are 54
settings keys and 152 scoring keys rather than a handful of booleans.

**Null is not zero, in three places, and each is a filter that would otherwise
return the wrong rows silently.** An unsynced `roster_positions` makes
`slotCount` null so `K = 0` — "leagues without a kicker" — cannot sweep in every
league whose lineup was never read. A `total_rosters` of 0 is a row stored
before the league answered, not a real size. And `SettingKey.absent` is read
*per key*, because Sleeper omits what a league doesn't set: `taxi_slots` missing
is no taxi squad, but a week has no zero on its scale, so `trade_deadline`
missing is unknown. An absent *scoring* key is a real 0 for the same reason —
which is exactly why TE premium is asked as `bonus_rec_te > 0`.

**Three value kinds, and the third is the one that bites.** A quantity gets a
number field and all six comparisons. A *named* key (`disable_trades` 0/1) gets
a menu and narrows to is / is not, because `>` on an enum is a question with no
meaning and `disable_trades = 1` is a filter a reader cannot check. A
*sentinel* — Sleeper spells "no trade deadline" as `trade_deadline: 99` — reads
as **null for comparison** and is reachable **by name** instead: read as a week,
`99 ≤ 12` is false so "an early deadline" works by luck while `99 ≥ 13` answers
"leagues that trade late" with every league that never stops trading. It keeps
its number field and gets a key beside it; leaving that key returns the field to
the bay's opening number, never to 99. `waiver_type` deliberately stays a
quantity: its 0/1/2 is an ordering nobody has verified, and a quantity is only
terse where a wrong name is a filter that lies.

Comparisons carry an epsilon, because rates are floats and an exact `===` is one
binary representation away from denying that a half-PPR league pays 0.5. The
lists are **AND**, ordered cheapest-first — a league rejected on its type never
walks its lineup.

`type` and `best_ball` are excluded from the Settings menu (`NON_SETTING_KEYS`):
they are the Type and Format rails four inches higher, and two controls over one
axis is an empty list with nothing on screen saying which emptied it.

**`LeagueFiltersDialog` lives in `features/shared/league-filters-dialog/`**, and
moved there from `features/manager/components/` when the trades board became a
second reader — the line `CONSOLE_KEY` and `ManagerPlate` moved on. Only the
dialog is exported: the rails, bays and rows are its own parts. Its modules
import the engine beside them as `../league-filters` rather than through the
`features/shared` barrel, which is that barrel's own contents.

**The dialog edits a draft and commits on Apply** — the one place it diverges
from `LineupColumnsDialog`, which writes live. Every number in it is a count
(per option, per rule, and the rail's total), and a count is only readable if
the population behind it holds still while you read it; a rule's number field
would otherwise re-filter on every keystroke. The per-option counts are a
*cross-tab*, not a tally: each probes the whole draft with one field
substituted, so lighting Dynasty moves the Format row's numbers underneath it.
The per-rule count is what that rule *alone* leaves — the answer to "is this the
rule that emptied my list", which a running total cannot give once there are
three.

**The selection is per-manager and unpersisted**, on `LeagueTeams`' terms: it is
a way of reading this list, not a device preference, so it is `useState` rather
than a `local-store` wrapper. The reset when the manager changes happens
*during render*, the idiom `useManagerLeagues` documents — an effect would paint
one frame of the new manager's leagues under the old manager's filters.

Two things on the page must keep reading the **unfiltered** array: `cold`, which
decides whether the page is a progress bar, and the gate on `useManagerLineups`.
Taken off the filtered list, a selection matching nothing would put the cold
sync bar back on screen and suppress the solve for every league on the account.
The empty states are two, because they are two claims: "No leagues found" is
about the manager, "No leagues match these filters" is about the selection and
carries the button that undoes it.

The theme rule bit here and is worth restating: **no alpha on the accent as
text.** TheLabX draws an already-added quick-add dimmed at `text-active/40`,
which is ~2:1 on light mode's teal. Here an added preset is drawn *lit* instead
— the same treatment the rails give a chosen option, which is also a no-op to
press again, and which has the advantage of being true.

## Shares and leaguemates

Two drawers on the manager page answer the question the league grid cannot:
across a whole account, **which players does this manager roster in how many
leagues**, and **who do they keep running into**. `GET /api/user/[username]/players`
and `.../leaguemates` back them. TheLabX's feature ported, minus its metric
catalogue and its virtualizer.

**It needed no migration**, and that is the schema's doing rather than luck:
`rosters.players` and the `rosters_owner_league_idx` on `(owner_id, league_id)`
have carried the first question since the league-graph migration, and
`league_users` with its `user_id` index has carried the second. `npm run migrate:up`
reported "No migrations to run" on the day this landed.

**The routes ship raw membership and count nothing, which is the whole design.**
`/players` answers `Record<league_id, player_id[]>` and `/leaguemates`
`Record<league_id, user_id[]>`; `manager/helpers/shares.ts` and
`leaguemates.ts` fold them on the client. The reason is that this page already
narrows its league list five ways, and **a share has to be counted over the
leagues left** — a reader who has narrowed to dynasty wants dynasty shares. A
`GROUP BY` on the server would answer a different question and could not be
re-asked without a round trip per filter press. The maps are what make that
affordable: 66KB and 150KB uncompressed on the 113-league account, against
471 distinct players and 719 leaguemates.

**Two populations, and confusing them is the bug that has no symptom.** The fold
is handed `leagueFiltered` — the league-filtered list, **before** any subject
selection — and never `visible`. Counted over the selection, every row would
collapse to the row you just picked the moment you picked it, and could not be
widened again without clearing first. It is the rule `facetsQuery` already
enforces for the trades board's own menus, one page over. Verified live: with
Dynasty selected the drawer's denominator falls 113 → 79 and its rows 471 → 449,
and then picking a subject leaves both figures exactly where they are while the
grid falls to 32.

**A league that contributed no roster is skipped, not counted as one holding
nobody.** `league_count` is the leagues that *answered*, so a partly-synced
account reports its shares over fewer leagues than the count beside it. Zeroing
it would deflate every share on the page, silently. The same rule runs on the
member lists.

**The manager's own id rides `members` on purpose, and the fold drops it.** It
is the sentinel that separates "this league is stored and they share it with
nobody" from "this league has no member rows at all" — the distinction the
denominator above is built on. `getLeaguemateIds` excludes them instead, and the
asymmetry is right for the reason its doc gives: there the id list *is* the
answer, so a manager listed as their own leaguemate would be a claim. Here it is
a population. Checked live: self appears in 113 of 113 member lists, and 720
distinct users minus self is the 719 the drawer lists.

**`getManagerRosters` applies `LIVE_LEAGUE_SQL` and not `FIELDED_A_TEAM_SQL`**,
which looks backwards until the two are taken separately. The `owner_id`
predicate *is* that fragment's roster half, so applying it too would only
restate the join. The tombstone is implied by nothing: a deleted league's roster
rows are frozen rather than cleared, so without the guard a league nobody can
open would keep contributing shares forever. It answers 124 rows against the
page's 113 leagues, and the 11 extra are all `pre_draft`/`drafting` rows with a
null or empty `players` — never looked up, because the fold only ever indexes
the leagues it was handed.

### The subjects are a second narrowing

Picking a row narrows the grid behind the glass. `helpers/league-subjects.ts` is
that predicate, and it composes with the league filters as a second pass:
`leagues → matchesFilters → matchesSubjects`, cheapest first, so a league
rejected on its type never has its roster walked.

**`cold` and the `useManagerLineups` gate still read the unfiltered `leagues`**,
as they always have — a subject matching nothing would otherwise put the cold
sync bar back on screen and suppress the solve for the whole account.
`SeasonSummary` no longer does: it reads `visible`, which composes both
narrowings, since the header pass made it the page's one set of figures. Its
`Leagues` field is where the unfiltered total survives — see The header became
one plate.

**A subject whose map has not arrived is ignored rather than failed.** Both
alternatives lie: failing it closed empties the grid while a payload is in
flight, and failing the whole predicate open leaves a lit token above a list it
did not narrow. It is reachable for a frame at most anyway — the drawer that
picks a subject is what fetches the map, and all four pieces of state reset
*during render* when the manager changes, the idiom `useManagerLeagues`
documents.

**`all` and `any` are two questions, and the toggle only appears above one
subject** — with one picked they agree, and a control with no effect is worse
than no control. Verified live, and the arithmetic is the check worth keeping:
18 leagues ∩ 45 leagues = 8 under `all` and 55 under `any`, with 18 + 45 − 8 = 55.

**The token tray under the rule exists because a closed drawer says nothing.**
That is the same problem the plate's `Leagues` figure solves for the two
dialogs — it was `ViewHousing`'s `matched / total` readout when this was
written, and the housing has since moved into the rack while the figure moved
onto the plate — and a subject narrowing needs more room than a figure has,
because it names people rather than a count. The figure picks the subject half
up for free, since `visible` composes both.

**`opened` is a latch, not the open flag.** A picked subject keeps narrowing the
grid after its drawer closes and the predicate still needs the map, so the read
stays enabled once a drawer has been opened. An unopened drawer costs no request
at all — `/api/trades/facets`' bargain, one page over.

### The drawer

A native `<dialog>` + `showModal()`, which is why there is no dependency: focus
trap, Esc and `::backdrop` come free, and `:modal` confirms it. What makes it a
drawer is the margins and a full-height box.

**It is a machined unit now rather than a page pinned to an edge**: a raised
control deck (`--plate-raised-*`) over a recessed list tray, in a `--housing-bg`
frame with a 12px gap on its three free sides and none on the docked one — which
is what makes it read as a rack slid out rather than welded to the viewport. The
frame is the housing and **not `--panel-bg`**, because the panel gradient is the
ground a page stands on and this is an instrument standing on it. The tray's
recess is `bg-black/[0.16]`: a recess has to be darker than its surround in
*both* themes, which a black alpha is and a `--foreground` alpha is not.

**Write the margins as explicit sides, never `m-0` plus an `auto`.** A `<dialog>`
is centred by the UA's own `margin: auto`, and Tailwind emits the `m-*` shorthand
before the `ml-*`/`mr-*` longhands — so `m-0 ml-auto` is a coin flip decided by
emit order, exactly the trap `CONSOLE_KEY_PILL` exists to keep a lit key out of.
The same goes for the padding now that there is any. Players open left,
leaguemates right.

**A row is one button, and it used to be two.** The chevron that expanded a row
into the leagues holding it is gone: pressing the row narrows the league grid
behind the drawer to exactly those leagues, and the grid is the better answer —
the same leagues, with their cards, one press earlier. The constraint that
shaped the old row is kept written down rather than deleted, because it is *why*
the row is a `<button>` and not a `<details>`: a `<summary>` maps to a leaf
`button`, so a control nested inside one is unreliably reachable, and a row with
two jobs could not have been a disclosure. With one job it could be — and it
still is not, because there is nothing left to disclose. The row's leagues are
still **data**: the record column and the share are both folded out of them.

**The rows are raised keys, and they are still flat.** The lift on hover is a
`translateY` and a box-shadow — one composited layer at a time — and nothing
here spends a `perspective`, a `preserve-3d`, a per-row `translateZ` or a
`drop-shadow` filter. That is a budget rather than a style: the league grid pays
~6 composited planes and a filter buffer per card and gates all of it behind
`pointer-fine:` because iOS Safari's per-tab GPU budget dies on 113 of them, and
this list is an order of magnitude longer — 471 players on that same account,
719 leaguemates. Do not promote it to `preserve-3d` to match the cards. The lift
rides `motion-safe:` **as well as** `.lab-anim`, because that rule clears
`transition` and `animation` and a lift written without the variant would still
jump instantly under reduced motion, which is the thing the preference is about.

**The share meter is deliberately not the rank ramp, and neither is anything
else in a cell.** `rankColor` says how *good* a position is; a share has no good
— nine leagues is not a better result than one, it is a different fact — and the
same holds for a price, an age and a class. So every cell is the readout's own
ink and the meaning is in the number. A held row is never drawn empty, because
at 1 of 113 a true-width bar reads as "none" rather than as "one". **A missing
value is an em dash, never a zero**, in all five.

**A closed dialog says nothing, which is what the title-bar readout is for.**
The league filters already narrowed these shares — `LeaguesHome` hands both
drawers `leagueFiltered` and the folds count over exactly that list, which is
today's behaviour rather than a change — but nothing in the panel said so. It
names the counted leagues, the account total and the filter summary. The
denominator stays **leagues that contributed a roster or a member list**, not
the count on the page. It is the *league* filters only and never the subject
selection: the subjects are picked in these drawers, so naming them here would
have the panel describe a narrowing it is itself the source of.

**Focus on open follows the pointer**: the search field on a fine one, the
`tabIndex={-1}` panel on a coarse one, so opening the drawer on a phone does not
raise the software keyboard over the list it just showed. Both branches verified.

**`loading` is derived, not stored.** Writing it from inside the effect is a
synchronous `setState` in an effect body — the cascading render the lint rule
exists to stop — and it is redundant: a read that has been asked for and has
neither answered nor failed *is* loading. Derived, it cannot be left true by a
path that forgot to clear it. The hooks otherwise copy `useManagerLineups`, with
one deliberate divergence: they **report** their failures, because lineups is an
enhancement beside a list where a drawer is only this data, and a silent failure
there is a panel that opens empty with nothing saying why.

### Four facets, behind one key

The players panel narrows by **position, NFL team, age and draft class**, all
four multi-select, behind a `Filters` key in the search row. It narrowed by
position alone until this landed, which left the two things a dynasty reader
opens the list for — how old a player is, and which class he came out of —
visible as columns and unreachable as questions. Every facet was already on the
wire: `PlayerShare` carries all four, and the last two are the Age and Class
columns. Nothing on the server changed and there was no migration.

**The rules live in `helpers/player-filters.ts`**, pure and under Node's own
runner, for the reason `league-filters/predicates.ts` is: each of them is silent
when it goes wrong.

- **Empty is "not asked", not "everything chosen".** A facet with nothing
  selected excludes nobody. Read the other way, a player carrying a value that
  appeared after the reader last touched the facet would silently drop off the
  list.
- **A full-width span is not a filter.** `spanActive` compares a span against
  the *bounds* rather than against null, so a reader who drags a handle out and
  back has no filter: the key goes unlit, the summary empties, and — the part
  that matters — absent ages stop being excluded.
- **A null age or draft class is outside every span.** An absent answer is not a
  young player, and folding nulls in would make `22–25` quietly mean "22–25, and
  everyone we know nothing about". It is the rule the cells already draw an em
  dash by and the sort already puts absent rows last by.
- **Counts ride the unfiltered population**, which is the rule the position
  chips already lived by, now extended to teams: every chip and every menu
  option says how many players it *would leave*, so a chip that reads zero once
  pressed cannot happen and a reader can widen without clearing first.
- **The badge counts facets, not values.** "3" beside the key means three
  questions are answered, which is what survives the tray being shut.
- **Bounds are read off the population.** A board with no rookies offers no
  rookie handle, next year's class arrives without an edit, and a facet with
  fewer than two distinct values draws no row at all — a slider whose handles
  cannot be apart answers nothing.

**Team is a `<select>` that adds rather than selects.** A native `multiple`
select is a scrolling list box on every platform and 32 chips is the tray's
whole height; chosen teams come back as removable chips, so what is narrowed is
readable without opening the menu. Options are ordered by count, because the
codes worth reaching for are the ones the manager actually rosters.

**Age and Class are two stacked `<input type="range">`s** — `.lab-range`, the
one new stylesheet rule, because a thumb is a pseudo-element and cannot be a
utility, the argument `.lab-scroll` already makes. Native, so arrow keys,
Home/End and the platform touch target come free; the inputs are
`pointer-events: none` with the thumbs re-enabled, which is what lets the two
overlap without the upper swallowing the lower's handle. The readout carries the
*state* in its ink — `--readout-label` on both bounds, lit once it narrows —
rather than in a prefix, since "Any · 2012–2024" is 99px of a 66px window.

**Three things about the tray are load-bearing and all three are silent when
wrong.** Its open height is a **measured pixel value** re-read by a
`ResizeObserver`, not a `0fr`→`1fr` grid row, whose interpolation stalls in
Chrome whenever the subtree is written to in the same frame — and not a
`max-height`, which either clips a wrapped row of team chips or eases against a
number nothing on screen matches. Its **transition list is identical in both
states**, because rewriting `transition` in the same frame as the animated
property cancels it. And it carries **`inert`** while shut:
`pointer-events: none` stops the mouse and nothing else, so without it a
keyboard reader tabs out of the search field into an invisible panel of
fourteen controls.

**The key rides the search row and the tray wraps onto the line under it**,
which is one flex row rather than two: `PlayerFilters` is one component, so its
key and the tray it controls are one node and one `useId` and arrive in one
slot, and a fragment cannot put half of itself in a row and half in the column
outside it. The `Pos` well the drawer used to draw is gone — four facets are a
panel, and a panel that owns its own grooves and labels cannot be laid out from
the drawer.

**Emptying the list became reachable, and the empty state had to learn it.** One
position chip could never empty the panel — every chip counts over the
unfiltered population, so pressing one leaves at least its own count — but four
facets are an AND, and `RB ∧ BAL ∧ 22–24` is empty while all three read a
number. `rows.length === 0` alone would report that as "No players rostered in
these leagues yet.": a claim about the account, made by a narrowing the reader
could undo, with no key offered to undo it. It is `rows.length === 0 &&
!filtersActive` now, and the filtered case gets "No players match these
filters." and the Clear key.

### The columns are chosen, ordered, and shared between the panels

Five metrics — Value, Age, Class, Rec · Win, Share — of which a row carries at
most three, **in the reader's own order**. `features/shared/shares-columns.ts`
holds the table and the persistence (`thelab:shares-columns`), on
`lineup-columns.ts`'s terms.

**A sequence, not a set, and that is the one thing it does not share with the
lineup columns.** Those are stored as a set and rendered in canonical metric
order, because a card's tile row is a strip of equals; these are stored *as
ordered*, because the strip is three keys wide and the reader drags them. So
`normalize` dedupes and validates but never sorts.

**It does not cap on write.** `MAX_SHARES_COLUMNS` bounds what a *panel shows*,
not what a reader has chosen across both — the leaguemate panel offers two of
the five, so a sequence carrying three player metrics and two of its own is a
valid record of one reader's choices. The cap is applied in `sharesColumns`,
where it means something, and enforced in the strip by **disabling rather than
correcting**, which is `lineup-columns-dialog.tsx`'s rule.

**`mergeSharesColumns` is the reason the two panels can share one key**, and the
bug it exists to stop has no symptom: storing what the leaguemate panel shows
would store two ids, and the player panel would come back with Value, Age and
Class gone with nobody having edited them. So the ids a panel cannot offer are
kept, and kept *where they sat* — the new order is spliced in at the position of
the first offered id. That, the cap and the fallback are what
`shares-columns.test.ts` pins.

**The Sort track offers exactly the columns on screen, plus Name.** Not a fixed
list: the order and the number a reader is comparing must come off one list, or
the sort can name a column that is not being shown. There is deliberately **no
sort by position** — position is the `Pos` facet above, which filters, and a
control that both filters and orders on one axis is two answers to one question.
Directions are fixed per metric (Age ascends, the rest descend), ties break on
name, and **a row with no value for the sorted metric sorts last in either
direction**: an unpriced player is not the cheapest one. If the sorted column is
dropped, the fallback is the reader's own **rightmost** column, not a fixed one.

**The strip is a well and slabs where the Sort track is a track and pills**,
which is the console's own rule rather than a style choice: a track holds one
travelling key and a well holds a panel of controls, and that shape difference
is what stops the two adjacent control groups from reading as one row of eight
buttons. **Reordering is tap-to-lift, tap-to-drop**: a slab's `⣿` handle arms
it, accent slots appear between the remaining slabs, and one names where it
goes. The insert index is read from the **pre-move** positions, because removing
the lifted slab shifts every slab after it down one and one moved rightward
would otherwise land on the index it just vacated and appear to do nothing. The
two slots either side of the lifted slab are **omitted, not disabled** —
dropping a slab back where it started is not a move, and a target that does
nothing has to be explained.

**It was a drag, and this file recorded the order as mouse-only** — deliberately,
on the argument that the *set* stays keyboard-reachable (every slab's label
drops it and every spare key appends it, so any order is reachable by dropping
and re-adding) and that a `◀ ▶` pair per slab is four more controls in a strip
that already holds eight. **Touch is what broke that trade**: HTML5
`dragstart`/`dragenter` do not fire on a phone at all, so the order was not
reachable there by any means — not slowly, not awkwardly. Arming costs nothing
at rest, since the slots exist only while a slab is lifted, and it lands the
keyboard order for free, which the drag never had.

### What Value, Age and Class cost on the server

Three of the five columns are not computable from what the client already has,
so `/api/user/[username]/players` grew them. **It needed no migration** —
`players.data` is Sleeper's raw blob and has carried both dated fields since the
map first synced; `npm run migrate:up` reported "No migrations to run".

**A sibling type rather than three more fields on `PlayerSummary`.** The trades
board is that type's other reader and asks for none of the three — a trade names
players who have since retired, and shipping an age and a price for each would
be wire weight nothing on that page renders. `PlayerShareSummary` extends it and
`ManagerPlayersPayload` is the one payload that carries it; `getPlayerShareRows`
is a second statement beside `getPlayersByIds` for the same reason, with both
blob reads regex-guarded before their cast on `getMatchablePlayers`' house rule.

**The draft class is `metadata.rookie_year` and nothing else.** The obvious
fallback — `activeSeason - years_exp` — covers many more players and is wrong
for anyone who went undrafted or missed a season, and the handoff asks that it
be measured against the stored map before it is trusted. It has not been, so it
is not shipped: a wrong year on a dynasty page is worse than an absent one, the
same call `resolveSleeperIds` makes when it leaves an ambiguous KTC row
unmatched. The derivation is written down rather than done, on
`ROOKIE_PICK_STRIDE`'s terms — so the same thing can happen to it.

**One board for the whole panel, and it is stated rather than assumed.** A KTC
price is per market, and a shares row *spans* leagues, so there is no league for
`auto` to resolve against — `resolveKtcCrossLeagueFormat` is a second rule
beside `resolveKtcFormat` rather than a degenerate case of it, and under `auto`
it reads **dynasty**: the board with pick rows, and the one a cross-league
comparison implies. The payload echoes which board answered and when it was
scraped, the way the lineups payload does. What it can never do is average the
two: three figures on three scales never share a column, and a pooled read is
*wrong* rather than differently weighted — the ADP board split is the same bug
with the same shape.

**The 1QB column, always.** Which of KTC's two QB numbers a league reads is a
fact about *that league*, and a row held in a dozen of them is not one.
Resolving it from the leagues in the counted pool was the alternative and is
worse than it looks: the pool moves with the reader's filters, so a player's
price would change when they narrowed to dynasty. `superflex: false` rides the
payload so the panel can say so.

**A failed board is a column of em dashes, not a failed panel.** `ktc: null` and
every price with it — the degradation the lineups route already makes, and the
reason the other four columns have nothing to do with KTC.

**The board joins the players hook's subject key**, which blanks the map for one
round trip rather than leaving the old market's prices under the new market's
name. That is the cost `useManagerLineups` already pays for the same flip, and
for the same reason: a price on the wrong board is a wrong number, not a stale
one. It costs nothing until a drawer has been opened.

### Deliberately not ported

- **TheLabX's metric catalogue** — `ColumnsBar`, `MetricColumns`, `SubjectRail`,
  four pickable columns from ten with presets and a persistence key. **Half of
  this arrived**: the five metrics above are pickable, orderable and persisted,
  which is that catalogue's whole idea at this list's scale. What is still
  absent is the rest of its ten — four are ADP, which has no source in this
  repo — and its presets, which are a second vocabulary over a set of three.
- **The windowing** — `@tanstack/react-virtual` and the `SharesScrollProvider`
  seating that switches between plain and virtual rows. See the flat-rows note
  above for why the budget does not call for it.
- **`draft_classes` and the draft-class chips.** There is no `getNflDraftClasses`
  here, and the Class *column* is not one: a chip is a facet that narrows the
  list, where the column states a fact about a row. `players.years_exp` is
  stored and still unread, for the reason the section above gives.
  The position chips did port — they are read off `PlayerSummary`, which is
  already on the wire, and 471 rows want them — and they are a facet in the
  tray above rather than a well of their own since.
- **The tab pages** (`/manager/[searched]/players` and `/leaguemates`). The same
  lists behind two doors; the drawers are the door this app has.

### Verified

**The original port** was run against the live database on the day it landed.
`npm run migrate:up` reported "No migrations to run", which is the claim above
and why that port was code only. Both routes answered 200 with the numbers a
hand-run of their SQL predicted — 124 roster rows over 113 listed leagues, 471
distinct players all 471 named, 113 member lists, 719 leaguemates, avatars
resolved on 710 of 720. `?season=abc` 400s on both, an unknown user 404s,
`?season=2024` answers empty and deterministically without a resolver round trip.

End to end at 1280 and 390 in both schemes, over CDP: picking a player held in 6
leagues left exactly 6 cards and `6 / 113`, the drawer's own 471 rows unmoved;
Esc closed the drawer and the narrowing survived under a token naming him; Clear
restored 113. A leaguemate in 18 leagues narrowed to 18 and expanded to exactly
18 league rows. Two subjects gave 8 under `all` and 55 under `any` against 18 and
45.

**The redesign** was verified without a database, because there is none reachable
from where it was built — the method the console-card pass established: a
temporary `/preview` route rendering the *real* components against fixture
props, screenshotted over CDP at 1280 and 390 in both schemes, then deleted. A
phone-width viewport has to come from the context's own `viewport`, and the dev
server's chunks need `allowedDevOrigins` plus a proxy bypass for loopback or the
page serves 200 and never hydrates. **Nothing about the payload change was
verified against real data**, which is the gap to close first: the numbers below
are fixtures, and what they check is arithmetic and layout rather than Sleeper.

The columns machinery was driven end to end and every rule held. Dropping a
slab, adding a spare, dragging the first slab onto the third and reloading gave
`["share","class","record"]` stored and rendered, with the header labels and the
row cells in that same order at every step. The cross-panel case is the one
worth keeping: with `["share","class","record"]` stored, the leaguemates panel
showed `Share, Rec · Win`, dropping Share there stored `["record","class"]`, and
the players panel came back with **Class intact** — which is `mergeSharesColumns`
doing the only thing it exists for. The sort key fell back to the reader's
rightmost column both times a column was dropped.

Layout at 390 is where three things changed against the handoff, each because a
render showed it, and all three are in the code's own comments: the cells wrap
onto a line of their own below `@md` (three of them left the name eighteen
pixels — every player read as an initial and a full stop); the population
readout takes its own line there (inline it read "ACRO…", so the one thing on
screen that says what the panel counts over said nothing); and the Columns well
wraps, because at 390 its last spare key was clipped by the panel and
unreachable. `.lab-scroll` also gained `scrollbar-gutter: stable` — the tray's
column headers sit outside the scroller and are padded by its width, and with an
overlay scrollbar the gutter is 0, so every label landed 11px left of the readout
it names. Measured after: header and cell rects identical to the pixel.

In the DOM, at both widths and in both schemes: `:modal` true, the dialog's
accessible name "PLAYER SHARES" (the extrusion copy `aria-hidden`, so it is not
doubled), `aria-pressed` on every row, one `role="status"`, the search field
labelled, two spare keys `disabled` at the cap with a title saying why, and no
element overflowing the panel at either width. `document.scrollWidth === 390` at
phone width. Under `prefers-reduced-motion: reduce` the panel's `animation-name`
and the row's `transition-property` both compute to `none` — the row lift rides
`motion-safe:` precisely because `.lab-anim` clears transitions and not
transforms.

The config window was checked on the same page: 12 pips across three synced
leagues, exactly `Math.max(2, slots)` per ladder with three unlit, and **none at
all** on the league whose `roster_positions` are null, which reads `—` for both
ladders, both counts and the premium. A `bonus_rec_te` of 0 renders `0` and an
absent `scoring_settings` renders `—`, which is the null-is-not-zero rule at its
one visible seam.

**The four facets** were verified the way the redesign was and for the same
reason — no database is reachable from where they were built — through a
temporary `/preview` route rendering the real `PlayerSharesDrawer` and
`LeaguemateSharesDrawer` against fixture payloads, driven over CDP at 1280 and
390 in both schemes, then deleted. The numbers below are fixtures; what they
check is the rules and the layout rather than Sleeper.

One render changed the code, and it is the one the handoff's own diff got wrong:
`{filters}` dropped into the search row put the **tray** in that row too — a
fragment does not escape its parent — where it laid out 774px wide inside a
354px panel and was silently clipped by the panel's own `overflow-hidden`, with
`document.scrollWidth` still reading 390 and nothing on screen saying so. The
row wraps now; measured after, the tray is 506 of 532 at 1280 and 328 of 354 at
390, with **zero** elements past the panel in either scheme at either width.

The rules held end to end. Two position chips took 90 rows to 26 with the badge
reading 1; adding BAL took it to 10 and the badge to 2, with the chosen option
disabled in the menu, the select snapping back to `+ Add team` and "All 9 teams"
giving way to a lit chip carrying its own count. Arrow keys on the min-age
handle moved 21 → 25 (native, no handler), lighting that readout with
`--readout-text-glow` while the Class one stayed on `--readout-label`, and
`End` → `Age 35–35` against the `—` position emptied the list to "No players
match these filters." with the Clear key beside it — the AND case the empty
state had to learn. Six arrow-lefts back to the bound put the badge out, the
summary back to "Nothing narrowed" and all 90 rows back, which is `spanActive`
at both ends. A query nothing answers still says "Nobody by that name."

The tray: 14 controls reachable in DOM order with it open (search → key → 8
chips → the menu → 4 handles), **0 reachable** with it shut, `inert` on and the
shell at `0px`. Its measured height followed six team chips wrapping — 288 →
328 → 369px, the shell equal to the tray to the pixel at each — which is what
the `ResizeObserver` is for. Under `prefers-reduced-motion: reduce` the shell's
`transition-property` computes to `none` and the tray opens to its full height
at once, which is `.lab-anim` doing its job rather than the tray not opening.

The columns strip was driven by **touch**, since that is the whole reason it
stopped being a drag: `Input.dispatchTouchEvent` on a slab's `⣿` raised two
slots (of four positions, less the two either side of it, each labelled "Move
Value here"), a tap on the last stored `["record","share","value"]` and moved
the header labels and the row cells with it, and a second lift cancelled by its
own handle left the order untouched. The leaguemates panel, which passes no
filters at all, is unchanged: no key, a two-child search row 36px tall, nothing
past its panel. Exactly one `<h1>`, `document.documentElement.scrollWidth`
equal to the viewport at both widths, and **no console output of any kind** —
no React warning about the controlled select or the layout effect.

## KeepTradeCut values

`shared/ktc` scrapes both of KTC's markets — dynasty (`/dynasty-rankings`) and
redraft (`/fantasy-rankings`) — into `ktc_values` and `ktc_value_history`:
current values on a 15-minute loop, each entry's full daily series backfilled
**once, at boot**. `scheduler.ts` runs it, started unawaited from
`instrumentation.ts` (`KTC_SYNC=off` disables); the boot tick doesn't force, so
a restart inside the TTL re-scrapes nothing, while interval ticks do, because
the interval equals the TTL. It is the sync half of TheLabX's `shared/ktc`
ported — bracket-walking parser, completeness gate, two-timestamp backfill
queue — plus the redraft dimension that repo never had.

**Format is rows, superflex is columns, and neither is a preference.** One
scraped page carries *both* `oneQBValues` and `superflexValues` per entry, so
all four boards are two requests and a row is what one fetch said about one
entry, the two QB readings side by side. The `page`/`filters`/`format` query
params the reference repos send are display-only — checked live, `?filters=QB`
returns the same full array — so the sync fetches the two bare URLs.

**KTC's `playerID` is per-board, and that is why `format` is in every key.**
Of 280 names on both boards when this landed, 183 carried different ids —
Bijan Robinson was dynasty `1414` and redraft `1507` — and the same number can
name different people on the two boards, so `ktc_id` alone would silently mix
them. The slug embeds the id, so it is per-board too; **nothing links an entry
across formats except `sleeper_id`**, which the matcher now writes (below).
It must never go unique: the match is name-based, so two KTC rows can
legitimately resolve to one Sleeper player — and with `format` in the key,
every player who is on both boards *is* such a pair by construction.
`foldKtcValues` is what resolves that at read time, per format and per QB
board independently.

**`validateKtcBoard` runs before the transaction opens, and the floors are
per-format.** The reconcile that follows the upsert is destructive by design —
every stored row of that format not in the response is nulled (never deleted;
history FKs the row), because a churning top-N would otherwise leave a
fallen-off player priced forever. A half-parsed fragment passing a bare
non-empty check would null the board and stamp it fresh, so a suspicious
response writes nothing at all. Dynasty's floor is 300 under a ~500-entry
board; redraft's is 200, because 300 sits close enough under its ~370 that an
off-season trim could wedge the sync — and the shrink check judges against the
*same format's* stored count, or the first sync of the smaller board would
read as a shrink of the bigger one.

**History is the base series only, dated on KTC's clock.** The daily snapshot
rides the values transaction (after the upsert — the FK needs the parent
rows), stamped `America/New_York` because KTC's series roll over on Eastern
days and a UTC evening lands on tomorrow. The player-page backfill drains the
`history_synced_at IS NULL` queue at boot — attempt-ordered so a failing page
rotates to the back, re-acquiring the advisory lock per ~10-player batch so no
pool connection is parked for the half hour, halting if an entire batch fails
(KTC saying no is not a thing to hammer) — and is resumable because the queue
predicate *is* the state. TE-premium variants (`tep`/`tepp`/`teppp`) are not
stored: the player pages carry no history for them, so the base value is the
one number today's row and the backfilled series can agree on. The known cost
of boot-only: a player who joins a board mid-process accrues forward snapshots
but no back-series until the next boot.

### The matcher, and reading a board back

Until the KTC columns landed, `ktc_values` was 897 rows nothing could reach.
**KTC publishes no Sleeper id and Sleeper carries none of KTC's**, so the only
bridge is the name — and `sleeper_id`, which every read here joins on, was
nullable and never written. `match.ts` is that bridge, ported whole: three
tiers, most precise first (normalized full name + position; a collision broken
to the single active or rostered player; last name + position + birth year, for
the nicknames), and **anything still ambiguous left unresolved** — a null id is
honest, a wrong player is not. Verified against the live board: two active WR
Davises born 1999, neither on a team, so KTC's "Gabriel Davis" resolves to
neither. That is the rule working, not a miss.

**One thing in it is this repo's own, and it exists because this repo scrapes
the redraft board.** TheLabX only ever read the dynasty one, which carries
neither a kicker nor a defence, so its matcher never met KTC's `PK` and `DST`
against Sleeper's `K` and `DEF`. Here they were **70 of the 71** unmatched
redraft entries — two of the ten seats a redraft lineup fills, going unpriced.
`KTC_POSITIONS` renames them before the key is built rather than adding a
fallback tier, since the position is half of every lookup key; the names line
up on both sides once they do, because Sleeper stores a defence as
"Philadelphia" / "Eagles". Measured after: redraft 300 → **369 of 371**,
dynasty **463 of 492** skill players.

**The ids are resolved per format and written by both halves of the upsert**,
which reverses what this file used to say. They were absent because nothing
could resolve one and an `EXCLUDED` overwrite would have erased a hand-filled
id; now the matcher is the only writer and it is deterministic over the same
players table, so re-deciding every run is exactly what lets a bad match be
*corrected* rather than frozen. The 12k-row players read is lazy and shared
across both formats — only KTC's ids are per-board — and resolves **before** the
transaction opens, on `validateKtcBoard`'s terms: an index build is not work to
hold a pooled connection across. `ensurePlayersFresh` is best-effort in a
try/catch, because a players refresh failing must not stop values updating.

The reads are `queries.ts` (`getKtcBoard`, `getKtcPickBoard`) with
`board-read.ts` in front of them, and **both take a format, because every read
of this table must**: a dynasty row and a redraft row are two markets, not two
readings of one. `getKtcBoard` reads the market **whole** rather than binding
ids — the manager page prices every roster in every league it lists, so the id
list is larger than the ~500-row board — and `board-read` holds it on
`projections/ros-read`'s exact terms: the sync's own TTL (a cache outliving
what it caches is a second staleness policy), a failed read evicted rather than
cached, and a map keyed by format rather than one slot, since an account
holding both kinds of league reads both boards on one request.

The barrel is **server-only** — the sync and the reads drag `pg` in — on the
projections barrel's exact terms: a client module needing `isSuperflexLineup`,
`ktcBoardValue` or the pick vocabulary imports `./roster` / `./picks` /
`./board-choice` relatively. Still deliberately not ported, each with what it
arrives with: `history-stats.ts`, `getKtcValuesAsOf` and `getKtcSfHistoryAsOf`
(the comps reads), and `rosterKtcValue` — the last one because the guard it
carries has nothing to guard against here; see the lineups section.

## The tools console

`/tools` is one bevelled panel: the account readout on the top row, a rule,
then the tool grid. Applied from a design handoff, and three things about it are
structural rather than cosmetic.

**The engraved wordmark plate that used to open that row is gone**, and so is
the rack's tool menu above it — see The tools page carries neither, under The
app rack. What the plate leaves behind is a visually-hidden `<h1>`, still passed
in from the page so the copy stays on the server side of the client boundary,
and one class: the account control no longer takes `ml-auto`, which pinned it to
the right of an otherwise empty row.

**The sticky header is gone, and nothing replaced it.** The account used to be a
full-width card under a translucent scrim that followed the scroll; it is a
compact readout on the heading's own row now, so there is nothing left to
follow. The scrim's two tokens went with it — a token whose only reader was
deleted is dead weight, in the same way Geist Mono was before this page asked
for it.

**The grid is three across at `lg`**, sized for the eight to ten tools the page
is growing into rather than the five it has. It was `PageShell width="wide"` and
is `console` **since** — `wide` and `default` are both `max-w-4xl`, so three
across the panel's own inset landed a card at 241px and wrapped two titles; see
The finalization pass. The design's placeholder cards (Values, Matchups, Drafts,
League Graph) are *not* shipped and `constants/tools.ts` carries only the five,
plus the `short` names the rack's menu key reads.

**Two CSS constraints carry the card, and both are silent when broken.**

- **`transform-style: preserve-3d` and `overflow: hidden` are mutually
  exclusive.** The clip forces a flat rendering context and every child
  `translateZ` collapses into the card's plane — no error, just a card whose
  contents no longer separate from the glass as it rises. So every decorative
  layer (specular, sheen, graticule floor, glow, edge light) lives inside one
  absolutely-positioned wrapper that does the clipping, and the content layers
  stay direct children. Do not move the clip onto the card.
- **The card is `flex-1` inside a `flex` `<li>`, never `h-full`.** A percentage
  height cannot resolve against an auto-sized grid row: the row is sized short
  and the card's layout box overflows its own cell, putting the "Open" row under
  the next row of cards. It looks correct until the descriptions are uneven.

The `<li>` owns the `perspective` rather than the `<ul>`, so each card is
projected from its own centre instead of from one vanishing point at the grid's
middle.

**The type is a gradient clipped to the glyphs, which changes what depth is
made of.** `bg-clip-text` + `text-transparent` means a `text-shadow` renders
*through* the letterforms; depth has to be `drop-shadow()` filters, which follow
the glyph alpha. Both the wordmark and the tool names do this, and both take
their filter stack from a token — see the Theme section for why the stack cannot
be written into the class string.

**Both copies of a wordmark are `whitespace-nowrap`, and the type steps down
below `sm`.** The engraving is two stacked copies of "The Lab" — an `aria-hidden`
extrusion under the face. If the face wraps and the extrusion cannot, the
extrusion's second line hangs off the plate as a ghost "LAB"; the plate is also
wider than a phone at 2.5rem, so the two are one fix. The rule outlived the
plate on this page — the rack's own wordmark and `ManagerPlate` both live by it.
For the same reason the panel's gutter steps `6 → 8 → 13` rather than going
straight to the design's 13, and the lookup input is fluid below `sm` and `w-56`
above it — a fixed-width input is wider than the panel's content box on a
phone.

**Light mode is derived, not measured.** The design was approved in dark; every
chrome token has a light counterpart reasoned out from it (bevels invert, the
chrome face becomes a dark metal gradient so it reads on a light plate, the
readout's glow is `none` because a glow under dark-on-light type only smears
it). It was checked at 1280 and 390 in both schemes after the port, which is
what turned up the ghost wordmark and the smeared engraving, but it has had no
designer's pass.

The console's three keys — Find, Change and the theme toggle — take their class
string from `CONSOLE_KEY`, with `CONSOLE_HOUSING` for the
machined pill they sit in. A key is a physically raised object (a 3px riser in
the resting shadow, 1px pressed, so it travels), and three hand-copied spellings
of that is three chances for one of them to stop travelling. **The constant
lives in `features/shared/console-chrome.ts`**, not in this folder: the leagues
console builds on it too, and "a second feature reads it" is exactly the line
that moves a client piece into `shared/`. It went there rather than into the
tools barrel because the barrel rule is about *this folder's own* modules. **The
theme key is no longer on this page**: it moved into the app rack (see The app
rack below), which is the only place it can be and still be one control. It
used to have a housing beside the account's, so that below `sm` the cluster
wrapped within itself and the lookup kept a full row; with the key gone the
lookup has the row outright and the wrap is moot.

**`LabWordmark` has left the barrel with the plate.** It joined it only because
the page passed it in as `ToolsHome`'s heading; the heading is now a
visually-hidden `<h1>` written inline, which keeps that copy on the server side
of the client boundary just as the plate did, and nothing outside this folder
builds on the component any more. It is kept rather than deleted — `ManagerPlate`
and the rack's own wordmark both cite it for decisions they take, so it is the
`peekActiveSeason` case: a module with no caller that carries the argument a
reader would otherwise get wrong. `tools`, `toolHref`, `Tool` and `ToolsMenu`
stay out on the same folder rule: only this folder's own modules build on them.

Accessibility that the chrome must not cost: exactly one `<h1>` (`sr-only` since
the plate went — the rack renders none, so dropping the plate without it would
leave the page with no heading at all), the readout's live state announced by `sr-only`
"Connected" rather than by the pulsing dot alone, disabled cards keeping
`role="link"` + `aria-disabled` + their `sr-only` reason, and nothing below
`foreground/60` or under 11px — the mono legends sit exactly on that floor.

## The leagues console

`/manager/[username]` is the tools page's instrument language applied to the
leagues list: one bevelled panel holding an engraved identity plate, a season
summary housing, and a grid of league cards that tilt and rise. Applied from a
design handoff.

**The card itself has since been redrawn — see The console card below.** Its
body is an instrument housing rather than glass, its engraved 1.75rem league
name is a plate straddling the top edge, and the status word and record moved
onto a second plate opposite with two new ranks beside them. Everything below
about the tiles, the rank ramp, the `pointer-fine:` budget and the three
`preserve-3d` constraints still holds; the surface under them changed. The information architecture, the five stream states, the
filters and the columns dialog are all unchanged — this was a visual pass —
and four things about it are structural rather than cosmetic.

**The header is now one plate — see The header became one plate, below.** What
this section describes is the four-instrument row it replaced, and the two
paragraphs after this one still describe the plate and the summary as objects,
which they are; what changed is that they are one object and what they count
over.

**The header is a plate and a housing, not an avatar and two lines.**
`ManagerPlate` is `LabWordmark` with the manager's `<Avatar size="lg" />` in
the bezel where the flask sits, and the page's static copy demoted from the
headline to the plate's mono eyebrow — the headline is the display name, which
only exists once the stream has answered, so the server/client seam is
unchanged and the page's one `<h1>` moved inside the plate. The name is a size
down from the wordmark and *allowed to wrap*, because a display name is
arbitrary length where "The Lab" was not; both copies wrap, which is what keeps
the extrusion under the face rather than ghosting beside it. It steps down
below `sm` for the wordmark's reason: the plate is wider than a phone at the
full size.

**The summary housing is new information, derived client-side.** Nothing on the
page aggregated before. `seasonSummary` (in `helpers/`, pure and tested) sums
`league.record` across the league list — the **unfiltered** one while the
summary was a housing standing beside the plate, and the **filtered** one since
it was engraved onto the plate itself; see The header became one plate for why
that reverses. Two decisions carry it, and both are the difference between
honest and wrong: a league whose rosters have not been read has `record: null`
and is **skipped rather than counted `0-0`**, so a partly-synced account shows a
combined record over fewer leagues than the count beside it; and `winPct` is
**null, never zero**, when no league has a record yet, because a zero-length arc
parked at the top of the dial claims the manager lost every game they played.
Null draws an empty track, no pointer, and an em dash. The gauge is a
`conic-gradient` with the pointer on a rotated wrapper — one angle, no
trigonometry — and it is decorative: the figure inside it is real text and each
count beside it is a `<dl>` of its own. (One list per field rather than one
holding both, since the milled grooves between them are not list content and a
`<dl>` may hold only `dt`, `dd` and the `div`s grouping them. And the record
figure is `whitespace-nowrap`, because the en dash in `8–5` is a break
opportunity and a record split over two lines reads as two numbers — it wrapped
at 390.)

**The rank columns became lit readout tiles with meters.** `rankFill` divides by
`of - 1`, **not `of`** — on `rank / of`, 1st of 12 sits at 92% and last at 8%,
so neither end of the scale is ever reached and the bar reads as a broken gauge
rather than as a position. A null rank or a one-roster league draws empty.
**The tiles are coloured by rank, not by metric family.** `rankColor` in
`lineup-metrics.ts` runs a red -> neutral -> green ramp off `rankPercentile`,
the same percentile `rankFill` draws the meter from, so the bar and the hue
cannot disagree. Chroma rides *distance from mid-pack* rather than the rank
itself, so a middling rank lands on the theme's neutral and only a real result
earns colour; the hue only picks the side. `--rank-l`, `--rank-l-mid` and
`--rank-c` are tokens because the ramp runs on two very different glasses, and
the value is a computed `oklch()` string through `style` rather than a class
because it is continuous.

`rankPercentile` exists as a second function for one reason: `rankFill` answers
**0 to two different questions** — last place, and nothing-to-rank (a null rank
or a one-roster league). The meter is right to draw both empty; the ramp is
not, because painting an absent answer full red claims a result. So the
degenerate cases come back null and land on the neutral.

This replaced `metricToneClass` / `metricFillClass` and the `METRIC_FAMILY`
record behind them, which gave the two families (accent for points,
`--metric-secondary` for capital) one colour each so a reader could tell the
*unit* without reading the label. **That cue was dropped rather than moved**, a
decision taken deliberately against this file's earlier note arguing for it: a
tile has one colour to spend, and what a rank is *worth* is the thing a reader
scans a page of cards for. The unit is still named, in words, in the tile's own
header. `--metric-secondary` lost its only consumer and was retired with them.

**One card per row, and the ranks are a strip across it.** The grid was three
across; it is `grid-cols-1` at every width now. The card keeps its stacked
composition — name, rule, manager line, then the tiles on their own row — and
the tiles take equal shares of the full width rather than a fixed size, so the
row reads as one instrument strip. Two across on a phone stays the exception: a
four-way split at 390 is 70px a tile, narrower than the rank it holds.

The tiles must stay a **direct child of the `<summary>`**. Laying the identity
and the ranks side by side needs wrappers, and a plain wrapper is a flat
rendering context: every `translateZ` under it collapses into the card's plane,
the same failure the clip causes above and with the same absence of an error to
say so. (Side by side was tried first and the wrappers had to carry
`preserve-3d` to survive it; on their own line no wrapper is needed at all,
which is the cheaper answer.) The `10rem`-capped tiles that arrangement wanted
went with it — a cap only earns its place where something competes for the row.

**Two CSS constraints are inherited from the tools page and bite again**, plus
one that is this page's own:

- `preserve-3d` and `overflow: hidden` are mutually exclusive, so every
  decorative layer lives in one absolutely-positioned clipping wrapper and the
  content stays a direct child of the `<summary>`.
- The card is `flex-1` inside a `flex` `<li>`, never `h-full`.
- **`group/card` is *named*.** The bench disclosure inside the card opens its
  own `group/bench`, and an unnamed `group-open:` would have the bench toggling
  the card's transform.

**The depth chrome rides `pointer-fine:`, because the budget it spends is
per-device rather than per-card.** In full dress a card is about six composited
planes — the `<li>`'s perspective, the summary's `preserve-3d` and resting
`rotateX(3deg)`, four content layers on their own `translateZ`, the masked
floor with its second nested perspective — plus a `drop-shadow` filter buffer
under the gradient-clipped title. The grid is one card per league with no
virtualization, so the plane count *is* the account's league count: measured on
the 113-league account, 791 transformed elements and 113 filter buffers live on
the page at once. A desktop absorbs that; iOS Safari's per-tab GPU budget does
not, and at DPR 3 a card's layers run megabytes each — expanding one card was a
reproducible "a problem repeatedly occurred" tab kill, which is WebKit killing
the page rather than any error the app could catch. The gate is `pointer-fine`
rather than a width or a UA sniff because the depth is a *pointer affordance*:
the tilt exists to be flattened by a hover, and Tailwind already wraps `hover:`
in `(hover: hover)`, so what touch was still paying for was the resting 3D
stack and the `group-open` styles, which are gated by nothing. So the
perspective, `preserve-3d`, every `[transform:…]`, the title's `filter` and —
the load-bearing one — the open-state `--card-lift-hover` + `--card-halo-hover`
pair (two 70px blurs, which *open* pins permanently) all carry `pointer-fine:`;
the hover variants carry `pointer-fine:hover:` on top of the hover gate, so a
coarse-primary device with a mouse attached cannot lift a card that has no tilt
to lift from. A coarse pointer gets the same card flat — bevel, gradients,
resting lift, and on open the border accent, glow and edge light, which stay
ungated because they are the open affordance mobile keeps. The floor and sheen
layers are `hidden pointer-fine:block` outright: one is only ever visible
mid-hover, the other exists to be foreshortened by a tilt that is not there.
**`lineupchecker/lineup-check-card.tsx` carries the identical gate** — it is the
same card over the same league list, so it had the same crash, and the two must
not drift.

Three things were changed against the handoff, each because a render showed it:

- **`PageShell` gained a `console` width (`max-w-6xl`).** At `wide` a league
  card lands at ~241px and *every* metric tile clips to "ROS STA…" over
  "1st o…" — the rank the tile exists to show. The handoff's own note named this
  as the fix and said the honest answer is a wider shell rather than dropping to
  two columns, and it is: at `console` the card was 326px and every tile read
  whole. The grid is one across since, which spends the same width on a 1014px
  card at 1280 — the strip above — rather than on three columns. `/tools` keeps
  `wide`.
- **The raise is z-ordered on the `<li>`, not on the `<summary>`.** The
  `perspective` makes each grid item its own stacking context, so a card that
  rises cannot paint over the one after it in DOM order — an open card sat
  *under* the card to its right, which is the one moment the raise is most
  visible. `relative hover:z-10 has-[details[open]]:z-10` on the grid item.
- The engraved league name takes `--card-title-depth` / `-hover` rather than the
  handoff's inline `drop-shadow()` list, on the token rule above: the handoff
  predates those tokens and a stack written for a dark plate smears on a light
  one. Same for the plate's `--wordmark-depth`.

**`globals.css` was merged, not replaced.** The handoff's copy is that file as
it stood *before* the theme toggle — it still selects light with
`prefers-color-scheme` and still carries the dead `--header-*` scrim tokens — so
taking it wholesale would have reverted the toggle. Only its five new tokens,
the `--color-metric-secondary` mapping and the reduced-motion rule's third
selector were folded in. A design bundle that supersedes a file is worth
diffing against the tree rather than copying over it.

**Deliberately still open, all three the handoff's own questions.** The
footnote under the ledger names the game count but not the league count, so a
partly-synced account's "over 4 of 6 leagues" goes unsaid. The filters and
columns dialogs kept their pre-console chrome — **closed since**, by the pass in
The app rack below, which is where `filter-rail`, `match-rail`, `rule-bay` and
`rule-row` finally moved onto the panel tokens. And light mode
is derived rather than designed, as on `/tools`; it was checked at 1280/1440 and
390 in both schemes, and the one number worth knowing is that the gauge's arc
sits at 4.49:1 against its track in light against 14.6:1 in dark — decorative
contrast, with the figure itself at 5.2:1.

### The configuration window

The card's identity line — `team name · N-team · status` — is gone, and a lit
window across the card says what game the league is playing instead: format,
lineup mode, teams, starters, the QB, SF and TE slot counts as countable pips,
and the TE premium. The line it replaces was one fact about the
manager and two about the league, none of them acted on; the team count moved
*into* the window, where it is the scale every slot count beside it is read
against. `features/shared/ui/league-config-window.tsx`.

**It lives in `features/shared` because a trade card reads it too** — see The
trades board's own note below. It moved there from `features/manager/components`
on the line that moved `CONSOLE_KEY`, `ManagerPlate` and `card-plate.tsx`: a
second reader.

**Nothing in it is derived twice, and that is the whole of the module.** Every
rule already has exactly one spelling in `features/shared/league-filters`, so
the window reads them: `leagueType` for the format (an absent `type` is
redraft), named through `TYPE_OPTIONS` so the card and the Filters dialog cannot
come to disagree about what "Dynasty" means; `isBestBall` for the lineup mode;
`slotCount` for both ladders and the starter count; `scoringValue` for the
premium. A second copy of any of them is a second chance to get one of Sleeper's
quirks wrong, and the symptom would be a card describing a league the Filters
dialog would not return.

**Null is not zero, in both directions, and the ladder is where it shows.**
`slotCount` answers null for a league whose `roster_positions` were never
synced, and a **null ladder draws no pips at all** — an empty two-pip ladder
would claim the league starts no quarterback, which is a different statement
from not knowing. `total_rosters` of 0 is `storedSetting`'s rule: a row stored
before the league answered, rendered `—`. An absent *scoring* key is a real 0,
which is why the premium is a value rather than a flag.

**The pip floor is two, and it is what makes the window scannable.** A one-QB
league drawn as a single lit dot reads as "one"; drawn as one of two it reads as
one of the two this board could have, so the superflex league beside it is
visibly different without anyone reading a number. Past two the ladder is exact.

**`QB+SF` became two exact ladders, and the Superflex tag narrowed to what they
cannot say.** The window used to draw the *union* as one `QB+SF` ladder with a
lit `Superflex` tag beside it; it draws `QB` and `SF` separately now, so
`QB 1 · SF 1` states a superflex lineup outright and `SF 0` — one unlit pip of
the two the floor draws — states a one-QB one. Nothing else that reads `QB+SF`
moved: the Filters presets, `breakdown.ts`, `isSuperflexLineup` and
`shared/ktc/roster` all keep the union, because the *rule* is still "two or more
QB-eligible starting slots".

The tag survives, narrowed to the one shape two ladders cannot state: a league
starting two bare `QB` slots and **no** `SUPER_FLEX`, which the union matches
and which prices exactly like a superflex league while looking, on the ladders,
like a league that simply starts two quarterbacks. So it renders when
`QB+SF ≥ 2` disagrees with `SF ≥ 1`, and not otherwise. Whether that shape
exists in this corpus is the handoff's own open question and **could not be
answered here** — no database was reachable from where this was built — so
narrowing is the arm that is correct under both answers: on a corpus without it
the tag never renders and the window is the design as drawn, and on one with it
the reader is not left to infer superflex from ladders that never name it. Run
the query and the tag can go.

**The divider is a line on glass, not `--groove`.** A groove is a channel milled
into the housing, and there is no metal inside a lit window to cut.

**Where it sits and what plane it sits on are the caller's**, which is the one
thing the second reader changed: they arrive as a `className`, the arrangement
`LeagueFiltersDialog` already takes its `triggerClassName` by, and for the same
reason — two cards mount this and only the card knows its own surroundings. A
manager card is a 3D context and gives it `translateZ(18px)`, between the tiles'
22px and the plates, so the planes still read front-to-back; a trade card is
flat, and a `translateZ` there buys nothing but a composited layer per card on a
board that appends a hundred at a time and never unmounts one — the
`pointer-fine:` budget argument, one grain down.

The one thing a render at 390 changed: nothing, but it is worth knowing that the
row wraps there rather than truncating, and a divider can land at the end of a
wrapped line. That is the cost of one flex row over three, and three rows would
be three at 1280 too.

## Checking a week's lineup

`/lineupchecker/[username]` answers two questions per league for one NFL week:
**what the lineup as set projects against the best one still reachable from
it**, and **whether its starters are seated in the order they lock best in**.
Its card has since been redrawn and gained a third answer — the week's
projected outcome against the opponent's own lineup; see The console card
below.

**The manager is named by the route, and was not always.** It read the stored
account off `local-store` until that changed, on the argument that a tool about
*your* leagues has no business asking for the name again. What that argument
missed is that the page then had exactly one URL for every manager: nobody could
open somebody else's lineups, keep a bookmark for a second account, or send
anyone a link to what they were looking at — and the manager page, which lists
the same leagues, has taken a username in its path since it landed. So the route
is `/lineupchecker/[username]` and it is `/manager/[username]`'s shape all the
way down: the same `PageProps` unwrap, the same `useManagerLeagues(username)`
underneath, and no bare `/lineupchecker` route, exactly as there is no bare
`/manager` one.

**The stored account is what gets a reader there in one press, and it is now a
default rather than the only answer.** `constants/tools.ts` gained a `hrefFor`
for Manager's reason — the tool card and the rack key resolve to
`/lineupchecker/<stored account>` — and the tool stays *not* `accountless`,
because there is still nothing behind "your lineups" without knowing whose. The
`NoAccount` plate went with the change: with a username in the path it was
unreachable. Two other files name the route and both moved with it — `proxy.ts`'s
matcher takes `/lineupchecker/:path+` (a positive list, which is why a route
shape is a line there as well as here), and `logs/derive-visit.ts` reads the
second segment as a **username**, so a visit to this tool now names its subject
in the log the way a visit to `/manager` does.

**Half of it was already in the tree and had never been called.**
`projections/optimal.ts`'s `compareLineup` — with its `locked` set and its
`bestBall` branch — was ported and tested with zero callers, and its doc
comments named three siblings that did not exist. This landed the first,
`kickoff-order`, and gave the solver its first reader. The build was mostly
plumbing between two things that were already right.

**The 1-hour buffer is not a lock rule, and reading it as one is the mistake to
avoid.** `KICKOFF_BUFFER_MS` buckets kickoff *instants into ranks* at one-hour
granularity, and only a rank difference moves a seat: two kickoffs twenty
minutes apart are one seat's worth of flexibility, so asking for a swap over
them is a press that buys nothing — the Sunday 4:05/4:25 windows are exactly
this case, and without the buffer the column read `2 to move` on lineups nobody
would have moved. The *lock* (`projections/locks.ts`) is still to the minute.
The bucket is measured **from the instant that opened it, not from the previous
one**: chaining is transitive, so a week of games fifty minutes apart would
collapse to a single rank however many hours it spanned and the ordering would
silently switch off.

The objective is `Σ breadth(seat) × kickoff-rank(player)`, maximised exactly by
a Hungarian assignment rather than by pairwise swaps — rotations of three are
real and no two of them may legally trade. **Later kickoffs go in the broader
seats**, which is the direction that reads backwards until you say why: a flex
that kicks off at 1pm is a flex spent, and every pivot that needed it for the
rest of the week is off the table. Verified against real week-1 data, where the
Wednesday opener is the *earliest* game and correctly takes the strict QB seat
while a Sunday 1pm QB moves to SUPER_FLEX.

**`matchups.starters` is the week's lineup; `rosters.starters` is today's.**
This is the first read of the `matchups` table, which the sync has been filling
since the league graph landed, and it is the whole reason a week stepper means
anything: Sleeper's roster `starters` is a *live* field, so grading week 3
against it would grade today's lineup and label it week 3.
`getManagerWeekLineups` LEFT JOINs the week's row and falls back to the live one
**flagged `as_of: "current"`**, which the card prints — the sync only fetches up
to the week being played, so a future week has no row by construction and
silence there would be a claim. A stored row whose `starters` is empty counts as
absent, since Sleeper writes one for a week a league never scheduled.

**Three failures, three different answers**, and the route's shape is that
distinction: the *database* read fails → 500, because it is the list the page is
made of; the *projections* read fails → `projections: "error"` with no leagues,
never a page of confident zeroes under a successful status; the *schedule* read
fails → everything else answers, `kickoff_moves` is null per league and the
locks fall back to the day rule. `getWeekKickoffs` never throws, which is what
makes the third possible.

**Zero and absent are different answers everywhere on this wire**, and the
client's three-way grammar is what makes that visible: a number in the alert
tone (act on it), a word (`Set`, `In order` — a real and good zero), or an em
dash (no answer at all). `kickoff_moves: 0` is "already in order"; `null` is a
best-ball league or a week with no published kickoffs. A tile printing `0` for
both would quietly claim the second was checked. Likewise `points: null` is "the
feed has no row for this id" where `0` is a row with no game — a real projected
zero, and the player stays in the candidate pool because he can be *started* and
dropping him would overstate what the lineup projects.

### What moved, and why

- **`LAST_REGULAR_WEEK` went to `projections/weeks.ts`.** Its own doc comment in
  `manager/graph-weeks.ts` promised it would "move back beside projections when
  they arrive"; week-scoped projections are that arrival. `manager` re-exports
  it, so no existing caller changed. `parseRequestedWeek` joins it there and
  answers in **three states** for the reason `parseRequestedSeason` does at
  length: collapsing absent and invalid is how `?week=abc` quietly becomes the
  current week and a reader is shown one week's lineup under another's heading.
- **`ManagerPlate` and `useManagerLeagues` went to `features/shared`** — the
  line `CONSOLE_KEY` moved on, and the same one: a second feature reads them.
  `ndjson.ts` travelled with the hook but stayed **out** of that barrel, on
  `local-store.ts`'s terms.
- **`readPlayerIdentity` and `isRealProjection` went to
  `projections/identity.ts`.** Two folds now read the same feed, and the two
  judgements they must agree on — which rows are real projections, and how to
  read a player off one — are exactly what a second spelling would drift on.
- **`easternDate` went to `shared/util`**, with `ktcToday()` becoming a caller.
  KTC's series and an NFL week both roll over on Eastern days, and two spellings
  of "which day is it in New York" is two chances for one to be the server's.

### Deliberately not ported

- **The opponent half** — who you play, their projection, Sleeper's league
  median, and the week's projected record. That is a *matchups* tool; the schema
  is already waiting for it (`matchups.matchup_id` plus its pairing index), and
  a median needs every team in the league solved rather than just the manager's.
- **`openingKickoff` came with `parse.ts` and has no reader**, kept because a
  whole-file port with its tests is the cheap half; its wired caller
  (`getFirstKickoff`, backing a season countdown) is absent and arrives with the
  header that wants one.
- **`week-inputs.ts`, `outlook.ts`, `candidates.ts`, `getUpcomingWeek`** — all
  read the `projections` and `players` tables TheLabX stores and this app does
  not. `week.ts`/`week-read.ts` is that read re-homed onto a fetch, and
  `getNflState`'s `display_week` is `getUpcomingWeek`'s answer from the only
  source here.
- **TheLabX's metric catalogue** (`ColumnsBar`, `SubjectRail`, `MetricColumns`)
  — none of it exists here, and two fixed tiles do not earn it.

`week-read.ts` caches **a keyed map, not `ros-read`'s single slot**: that file
justifies one entry with "the app asks for one season from one week at a time",
which is true of a span and false the moment a stepper exists — eighteen presses
against one slot is eighteen refetches. Bounded at four so a session cannot pin
all eighteen, evicted by *use* rather than by first fetch. Its TTL is **five
minutes against the ROS board's thirty**, which is the difference between a
season board that moves on injury news over days and a week board read by
somebody setting a lineup an hour before kickoff — the Sunday-morning inactive
is exactly what half an hour of staleness would hide.

**The page sits on the ground rather than on a panel of its own**, which is
the leagues console's arrangement and arrived here later than there. It used
to draw the rounded, bordered panel every pre-rack page drew — and drew it
*inside* the shell the manager page had already given up, so a reader walking
from `/manager` to `/lineupchecker` got a second bounded rectangle inside the
viewport under a floating rack, which is the doubling `ConsoleGround` exists to
remove.

**The card width fell out of the same edit, and it is the reason to make it.**
Both pages are one card per row at `PageShell width="console"`, so the only
thing that ever made these cards narrower was the panel's own inset and border
— `px-6 sm:px-13`, which measured **106px** at 1280 (1014 against `/manager`'s
1120) and **50px** at 390 (312 against 362) — and the two cards are the same
card over the same league. A league that read whole on `/manager` and clipped
here would be the shell's `console` arm failing at the one thing it was widened
for. With the panel gone the two agree by construction rather than by two
spellings of a width.

Checked at 1280 and 390 in both schemes. Light mode is derived rather than
designed, as everywhere else on the console.

### Syncing one league

Every card carries a `Sync` key that re-reads **that league** from Sleeper. It
exists because this tool is the one thing in the app a reader is meant to *act
on*, and until it landed the app could not see the action: the manager-grain
refresh buys ten minutes of quiet (`SYNC_TTL_MS`) and the crawler's live tier
fifteen, so somebody who moved a player and came back was shown the lineup they
had just changed. `POST /api/league/[leagueId]/sync` -> `shared/manager/league-refresh.ts`.

**It needed no migration**, and that is the schema's doing rather than luck:
`leagues.sync_attempt_at` and `leagues.updated_at` have carried exactly the two
meanings this reads since the league-graph migration, and `db/lock.ts` had
already reserved class `8675311` for the per-league lock this takes. The three
file headers that promised this port — `sync-freshness.ts`, `db/lock.ts`,
`graph.ts` — now describe it instead.

**Four bounds, and none of them is redundant**, which is worth stating because
any one read alone looks like it covers the next. The league must **already be
stored** (a press cannot grow the corpus — a route that fetched arbitrary ids
into the database is an open write endpoint wearing a refresh button); a
process-wide `leagueRefreshAdmission` bounds how many of these sessions exist at
once; a **per-league advisory lock** is the only one of the four that survives a
second instance; and `leagueRefreshGate` is what stops one intention becoming
several fan-outs. The admission is **its own limiter rather than a share of
`managerSyncAdmission`'s**: the two are different weights (~11 requests against
~11-per-league times a hundred), and sharing would let a burst of key presses
shed the leagues route's *cold* path, which has nothing cached to fall back on
and answers 503.

**A race is a success, not a refusal**, and that is the whole ordering of
`leagueRefreshGate`'s two arms. An attempt at or after `requestedAt` means
another caller's fan-out landed while this one waited on the lock — which is the
work this press wanted, already done — so it reports `raced`, `refreshLeague`
turns that into `fresh`, and the reader gets the data rather than a
fifteen-second apology for it. `requestedAt` is captured **before** the lock is
taken, which is the single line that makes the arm mean anything. Otherwise the
cooldown, measured from the last attempt **of any outcome**: a failed attempt
buys the same quiet, because a key that looks broken is precisely a key that
gets pressed again.

**`LEAGUE_REFRESH_COOLDOWN_MS` is fifteen seconds and is a hammer bound, not a
freshness TTL.** The press exists to be believed by somebody who changed
something a moment ago, so a window long enough to be a staleness policy would
refuse exactly the press the key is for; what it is sized against is a
double-click, a keyboard repeat and two tabs. `sync-freshness.test.ts` pins
`LEAGUE_REFRESH_COOLDOWN_MS < SYNC_TTL_MS / 10` so a later edit reaching for a
"sensible" ten minutes has to argue with a failure.

**`sync_attempt_at` is stamped before the fetch and `updated_at` is never
written here**, which is the two-columns rule at the league grain: a press
Sleeper fails must still hold its own cooldown and still rotate the league to the
back of the crawler's queue, while "this graph was written whole" stays
`persistLeagueGraph`'s alone. A **refused** press stamps nothing at all — the
gate returns above the write — which is both honest (it asked Sleeper nothing)
and load-bearing: stamping there would make the cooldown a *rolling* window, so
a reader mashing the key would push their own next press away forever. A press also stamps `last_accessed_at` — a manual
sync is *observed* demand, which is what that column means; the rule it must not
break is the crawler's, that a refresh pass never stamps what it refreshes, and
this is not that.

**`refreshedLeagues(result) !== 1` answers `failed`, carrying the previous
`updated_at`.** A graph missing a mandatory collection kept its stored rows
rather than being wiped — the right write — and reporting that as a success
would have the card redraw the numbers it already had under a key claiming
Sleeper had just confirmed them.

**The cache-busting token is load-bearing, not decoration.**
`sleeper/fresh.ts` appends `_=<mint time>` to every request one press makes, and
without it Sleeper's CDN can serve the pre-change roster — the key looking broken
while the app behaves exactly as written, which is the one failure this feature
cannot have. A `Cache-Control: no-cache` request header is deliberately *not* the
alternative: the major CDNs ignore it from anonymous clients, so it would read as
a fix and change nothing. **One token per press**, shared by all ~11 requests, so
the graph is read from one instant rather than eleven; `freshUrl` returns an
untokened URL untouched, which is what lets every getter offer the parameter
while the manager sync and the crawler keep hitting the cacheable copy.

**Every answer but `unknown` is a 200.** A cooldown and a race are *outcomes*,
not failures, and a 4xx would put a red note against a league in perfectly good
order. `unknown` is 404 because there is genuinely no such league here. GET is an
explicit 405 carrying the app's error shape: a re-read plus a rewrite is a state
change whatever method it wears.

**The re-read is narrowed, and `?league=` on the lineup-check route is what
narrows it.** That route's own doc argues *for* batching — the projections board
and the week's schedule are shared, so per-card requests refetch nothing and
re-enter everything — and this is that argument pointed the other way: exactly
one card's stored lineup changed, and re-sending a hundred solved leagues to
correct one row is the same waste. Measured on the 113-league account, 4.9KB in
34ms against 516KB in 815ms. It narrows the **rows** and not the path — same
season, same week, same board, same locks, same solve — so a narrowed answer
cannot drift from the batch it is merged into, and `MANAGER_LEAGUE_SQL` still
applies, so it can never answer for a league the batch would have left out.

**A success says nothing.** `syncStatusNote` is silent for `synced` *and*
`fresh` — read off the payload's own `synced` field, the same one the re-read is
gated on, so the note and the re-read cannot reach different conclusions about
one press. The numbers changing on the card are the answer; a badge on top of
that is the key congratulating itself, a hundred times over on a full page.
Every press that fetched **nothing** speaks, because those leave the screen
exactly as the reader found it and are otherwise indistinguishable from a dead
key. Cooldown seconds are `Math.ceil` floored at 1 — never "wait 0 seconds"
under a key that is actively refusing.

**The key is disabled while a press is in flight and at no other time**, and in
particular there is no client-side countdown. `retry_after_ms` is measured
against the server's clock and a background tab throttles timers to about once a
minute, so a countdown would re-enable a key the server still refuses; it would
be one interval *per card* on a page with no virtualization, which is the
per-device budget argument the card's `pointer-fine:` gate is built from; and
pressing during a cooldown is a cheap 200 that answers with a fresh number,
where a key greyed out on a stale one cannot correct itself. It uses
`aria-disabled` rather than the `disabled` attribute, because browsers **blur an
element that becomes disabled while focused** and this one toggles for a round
trip inside a list of a hundred cards — a keyboard reader would be dumped to
`<body>`. `WeekStepper` keeps real `disabled`: its states are stable facts about
the week bounds rather than a momentary one about a request.

**The key lives in the disclosure body, not in the `<summary>`**, and that is an
accessibility decision rather than a layout one: a `<summary>` maps to a leaf
`button`, so a nested control is unreliably reachable and a live region inside
one is folded into the disclosure's accessible name instead of announced. Two
things fall out in the codebase's favour — the body is already outside the card's
3D context, so this needs no `translateZ`, no direct-child discipline and no
`pointer-fine:` gate; and it lands beside "No lineup read for this league this
week", which is the case a sync most often fixes and was otherwise a dead end.
The cost is that a reader opens the card to sync it.

**The hook is the one place the house's abort lineage is deliberately not
followed.** `useLeagueRefresh` mints no `AbortController`: the sync fills
*shared Postgres state* rather than this component's answer, so cancelling
because a card was collapsed throws away Sleeper budget already spent — the
leagues route's `closed` argument, one grain down. Unmount safety is a flag, and
the promise still resolves, which is what lets the parent's re-read land even
when the card that pressed is gone. The double-press guard is a **ref, not
`pending`**, since `pending` is a value the render closed over. And every
ordinary refusal lands in `result`, never `error` — `error` means the press never
reached an answer, and re-inventing the refusals as errors would undo the reason
the route answers 200 to them.

**`useLineupCheck` returns `{ payload, reread }`, and its subject is unchanged.**
A league id or a refresh nonce in that subject would fire the render-time reset
and blank all hundred cards — and the "needs a look" count with them — to correct
one row. `reread` is `useCallback([])`-stable with what it needs on a ref, so a
handler a card captured resolves against the subject current *then*; it sends the
season and week **off the payload** rather than off the props, since `week` is
null until the reader steps and an unpinned re-read would let the route resolve
`display_week` for itself and answer a different week under the same card. The
merge guard compares the response's echoed season and week against the payload's,
reusing the route's existing promise rather than inventing a second token, and
leaves `projections` alone — that is a claim about the *account's* read of the
board, which one league can neither make nor unmake.

#### Verified

Run against the live database on the day it landed. `npm run migrate:up`
reported "No migrations to run", which is the claim above. A first press
answered `synced` in 730ms and left the three columns in exactly the designed
order: `sync_attempt_at` at `.559` — matching the minted token `_=1788481247559`
to the millisecond — `last_accessed_at` at `.561`, and `updated_at` at `.193` a
second later, once the graph was written. A second press answered `cooldown`
with a real `retry_after_ms` and no Sleeper traffic (8ms), an unknown id 404'd in
3ms on the pre-permit state read, and GET returned 405 with `Allow: POST`.

The end-to-end claim was tested by scrambling the stored week-1 lineup so the
card was visibly wrong — `Vs optimal −17.4`, `Kickoff 2 to move` — and pressing:
the tiles came back `Set` and `In order` within a second, the stored `starters`
were Sleeper's again, and the header count fell 8 -> 7, which is what proves the
merge landed in the shared payload rather than in card-local state. The press
caused **exactly two requests** — the POST and the narrowed GET — and no other
card's tiles moved. In the DOM: 113 keys for 113 leagues, none inside a
`<summary>`, one `role="status"` region per card empty at rest, no `disabled`
attribute, and still exactly one `<h1>`. Checked at 1280 and 390 in both schemes;
at 390 the key and its note share a row without overflowing and the page takes no
horizontal scroll.

#### Deliberately not ported

TheLabX's key lives on a shared league-detail panel and invalidates two query
keys through react-query; there is no such panel and no query library here, so
the press re-reads through the hook that owns the payload. Its
`invalidateLeagueDetail` — a server-side read cache evicted inside
`persistLeagueGraph` — has nothing to evict here, because this app stores no
league-detail cache; it arrives with one. And there is no **sync all**: on the
113-league account that is ~1,200 Sleeper requests behind one press, which wants
its own admission bound and a progress stream, and arrives with a reason to want
them.

### Four checks, and a header that says which

The card ran two checks — points left against the best reachable lineup, and
kickoff seat order — and the page's summary said how many leagues wanted a
press without saying what for. This adds two checks, turns the tile row into
four, and rebuilds the header around the same figures the manager page's plate
carries. Applied from a design handoff's option `1a`.

**It needed no migration**, and that is the schema's doing rather than luck:
`rosters.players`, `.reserve` and `.taxi` and `leagues.settings` have all been
stored since the league-graph migration, and the roster census is a read of
four columns nothing here was selecting yet.

**The tile grammar went from three states to four, and the fourth is the whole
reason.** `MetricCell.alert` was a boolean, which can say "act on this" and
"don't" and nothing else. A cleared check now draws a **checkmark** (`clear`),
and a figure that is real but not a problem draws the figure (`count`) — two
open roster spots is a waiver claim to make, and a check there would delete the
number while the error tone would send a reader to fix a league that is fine.
`none` is still the em dash. It is a union rather than a second boolean so the
tile's own `switch` has to place a fifth tone before it will compile, and
**`text` survives the `clear` state as the mark's `sr-only` name**: the mark is
the whole of what a sighted reader gets, so `Set` and `In order` have to stay
available to everyone else.

**The superflex check flags every occurrence, spare quarterback or not.** That
is the reading it is for: a superflex seat filled by a running back says the
roster is short a startable quarterback, which is a trade to make rather than a
lineup to fix, and the gap tile opposite already answers the narrower question
of whether a move available right now would score more. An **empty** superflex
seat is not counted — empty seats belong to the gap check, and counting them
twice would put one league on two reasons for one fault. The slots it reads are
**derived, not spelled `"SUPER_FLEX"`**: `SLOT_POSITIONS` entries that admit a
quarterback and something else, on `QB_ELIGIBLE_STARTING_SLOTS`' and
`DEFENSIVE_SLOTS`' terms, so the day the solver learns Sleeper's `OP` this check
reads the same set the solver seats from. A bare `QB` seat is excluded because a
non-QB cannot legally sit in one.

**The roster census counts three limits apart, because Sleeper enforces them
apart.** `roster_max` is `roster_positions` less its `IR` and `TAXI` entries —
**`BN` counts**, a bench spot being a roster spot — while IR and taxi are
counted against their own allowances, which some leagues state in `settings`
(`reserve_slots`, `taxi_slots`) and others only as seats; settings win where
both are on file. Folding all three into one figure would report a legal roster
carrying two taxi stashes as two over. Sleeper's `""`/`"0"` slot padding is
filtered before anything is counted, which `queries.ts` has warned about since
the graph landed: a raw `players.length` overcounts.

**The census is the one figure on the card that does not move with the week
stepper**, and it says so in the contract. Sleeper stores no historical
`reserve` or `taxi`, so "what did your IR look like in October" is not
answerable at all; what *is* answerable is whether Sleeper will refuse an add
now, which is the question the check is for. So it reads the **live** roster row
rather than the week's stored one, and `roster_players` is a field of its own
beside `players` precisely so the two grains cannot be mixed by accident.

**`null` is not zero in all six new fields.** `taxi_max: 0` is a league with no
taxi squad, which is a real answer and is what lets the tile stay quiet about
it; a `roster_max` of null is a league that cannot be answered for and draws an
em dash rather than claiming the roster is empty. The solve always answers
`roster_max` — a league with no slots on file is already dropped from the
payload — and the field stays nullable on the wire all the same, because that is
the state the tile draws its dash for and a client must not have to know which
producer filled it.

**`needsAttention` keeps its meaning and gains a sibling.** It still counts
*leagues*, and the two new checks join it on their **alert** state alone — an
open roster spot never sends anybody anywhere. `attentionByReason` is the
header window's four rows, and **they do not sum to the league count**: one
league off for two reasons is one league there and two rows here, which is why
the window prints the count separately rather than presenting a breakdown a
reader could add up. Both read the same functions the tiles do, so a row that
says two and a page with three lit tiles cannot happen.

**On the card, the identity line became the manager page's config rail.** The
team name went with it deliberately — the card is about the league, and the
rail answers what game it is playing — and `total_rosters` is now stated once,
as the rail's own `Teams` field. It is the same `LeagueConfigWindow`, so a
league described one way on `/manager` cannot be described another here. The
`as_of === "current"` caveat **kept a line of its own**: it is the one claim
this tool cannot make silently, and it rode the line that was deleted. The tile
row is two across on a phone and four from `sm`, on `GRID_COLS[4]`'s measured
rule, and stays a direct child of the `<summary>` — a wrapper there is a flat
rendering context and every `translateZ` under it collapses with no error to
say so.

**The header took `/manager`'s own pass.** `ManagerPlate` gets children for the
first time on this page, which is what switches it from `inline-flex` to the
full-width row — the seam that component's note has described since the manager
header merged. `WeekSummary` is `season-summary.tsx` with a week's figures:
a projected record and a dial for the rate it implies, over the **narrowed**
list, because a reader who has filtered to dynasty is asking about their
dynasty week. **A league with no opponent is excluded, never counted as a
loss** — `opponent_points` is null for a future week, an unpaired week and an
unstored opponent, three absences and no result — so a week with nothing
projected draws an empty track and an em dash rather than a projected 0–13 in
August.

Two measurements are this page's own. The dial's inner window is `inset-3`
rather than the manager's `inset-[0.9375rem]`, because the percentage clipped
against the round edge at 15px once `Win rate` became a `Proj win` caption; and
**the figure steps down to 15px at six characters**, which a render found: at
17px `100.0%` measures 61.2px inside a window whose widest chord at that height
is 60.8px, and `100.0%` is exactly what a small account projects when every
league is a win. Every shorter reading keeps the design's own 17px.

**The attention housing became one lit window on the plate**, carrying the
league count and the four reasons under a hairline — a lit row per reason above
zero, muted throughout at zero, and **no rows and no zeroes before the check
lands**: the em dash is what says "not yet", where four zeroes would make the
same false claim four times. Its denominator is the leagues **on screen** that
the check answered for, not every league it answered for: narrowed to one
league, `1 of 3` would be a count over a list the reader cannot see.

**And the filters moved onto the plate**, exactly as they did on `/manager`: the
key, a `Clear` key that appears only while something is filtering, and the
summary sentence, all in the plate's `controls` strip. The standalone sentence
under the header and the `Clear filters` key at the end of the week-stepper row
are both gone — they were the same news in two places, and neither said what
had been narrowed. The stepper keeps its row and its hairline.

#### Verified

Rendered through a temporary `/preview` route against the real components,
tokens and Tailwind build — the method the console-card, shares, rack and
timeline passes established, since no database is reachable from where this was
built — then driven over CDP at 1280 and 390 in both schemes and deleted. The
mechanics that method needs are unchanged: `--no-proxy-server`, and `localhost`
rather than `127.0.0.1`. The fixtures are three leagues — a dynasty superflex
two over its roster limit with a running back in the superflex seat, a best-ball
redraft two spots open and graded off the live lineup, and a league the check
answers nothing for — plus a cleared payload and one that never resolves.

Every arm landed. The dynasty card read `−6.6 / 2 to move / 1 non-QB / 2 over`,
all four in the error tone; the best-ball card read `Best ball / — / — / 2 open`
with only the last lit, which is the `count` state doing the one thing it exists
for; the cleared payload drew four checkmarks per card with the words intact as
`sr-only` names, and the window fell to `0 of 2` in readout teal with four muted
rows and muted pips. The unanswered league drew four em dashes. Before the check
resolved the count read `—` and every row read `—`.

The plate: `Proj rec 2–0` with the dial at `100.0%` measuring 54px inside its 62px
window after the step-down, the attention window at the plate's right end, and
the config rail replacing the identity line on all three cards — `—` for both
counts, both ladders and the premium on the unsynced league, with **no pips at
all**. Applying `Dynasty` from the plate's own key narrowed the page to one card,
lit the key with its badge, raised the `Clear` key, printed `dynasty · 1 of 3`,
and moved the projected record `2–0 → 1–0` and the window to `1 of 1` — the
narrowed-list rule end to end. `Clear` put all three back and took the key away.
Opening a card left the sync key, the seat rows, the `sit`/`→ RB` marks and the
bench disclosure exactly as they were.

At every width and in both schemes: `document.documentElement.scrollWidth` equal
to the viewport, zero elements past the viewport, one `<h1>`, the dialog
`:modal` and named `League filters`, and **no console output of any kind**.

**Not verified against real data**, which is the gap to close first: every number
above is a fixture, and what a render cannot check is the census against a real
corpus — whether `settings.reserve_slots` and the `IR`/`TAXI` seat counts
actually disagree in the leagues this database holds, and how often a stored
roster is genuinely over its own limit rather than the count merely looking
plausible.

#### Worth doing next, not drawn here

The superflex finding has no row-level mark in the expanded lineup table. The
`sit`/`start`/`move_to` marks are the precedent — a `non-qb` mark on the SF seat
row would let a reader act without counting seats.

### Starters and Opponents

Two more Browse keys in the rack, each opening a side panel of *week* shares:
**Starters** (docks left) is every player on the manager's rosters this week
with how many lineups started him and how many benched him, and **Opponents**
(docks right) is the same two columns over the rosters facing them. Pressing a
row narrows the league list behind the panel, exactly as a player row does on
`/manager`, **and** opens a start/sit decisions view for that player. Applied
from a design handoff.

**It needed no migration**, and one contract addition. `LineupCheckLeague`
carried `opponent_points` and nothing else about the other side, so the
Opponents panel could not be built from the wire at all; `opponent_lineup` and
`opponent_bench` sit beside it and are filled from the roster `compareLineup`
already resolves for that figure. So the number on the card's plate and the
players in that list are one measurement rather than two, and the null grammar
carries over whole: **every case that leaves `opponent_points` null leaves both
of these null**, never an empty array, because a panel counting an empty lineup
would report "no opposing players" for a league nobody has been scheduled
against yet. `move_to` is null on every opponent seat, which is a fact rather
than an omission — kickoff order answers who should sit *where* in a lineup
somebody can still move.

**The Starters half needed no server work at all.** Every seat, every bench
player and every projection is already on `useLineupCheck`'s payload because
the cards render them, so the fold is `helpers/starter-shares.ts` on the client
— which is also the only place it can be, since it counts over **the
league-filtered, subject-unnarrowed list** and the filters are the browser's.
That population rule is `playerShares`' in full: counted over the selection,
every row would collapse to the row just picked and could not be widened
without clearing first.

**The denominator is leagues that contributed a lineup**, so the Opponents
panel legitimately counts fewer leagues than the Starters panel on the same
account — a future week, an unpaired week and an unstored opponent roster are
all skipped rather than counted as leagues the opponent fielded nobody in. The
readout says which: `Across all 12 leagues · week 1`, the existing
`population()` string with the week appended, because these shares are one
week's and nothing else on screen said so.

#### Seat legality is the rule that is silent when wrong

`helpers/start-sit-decisions.ts` is the half with real rules, and it has a test
each because every one of them renders perfectly when it is wrong.

**Legality is the seat's, not the two players'.** A receiver is not a candidate
for a quarterback-only slot, and listing him as one is exactly the class of
false claim `lineup-check-card.tsx`'s module note says this tool must not make.
So `seatTakes` reads `SLOT_POSITIONS` — the app's own vocabulary, not a table
written here, so a league running `REC_FLEX` is answered by the same list the
solver seats from — and **an unrecognised seat takes nobody**, which is the
call the solver already makes when it drops a slot into `unknown_slots`.

**`relFor` prefers the narrowest bridging seat, which is the handoff's
flex-before-superflex rule generalised.** Where the seat itself will not take
the position, the swap is only reachable through a seat that takes both, read
out of the league's *own* `roster_positions`; ordering the candidates by how
many positions each admits offers `FLEX` (three) before `SUPER_FLEX` (four)
without naming either slot, and leaves the superflex route naming the case it
exists for — a swap with a quarterback on one end. Naming `Via SF` wherever a
league happens to carry a spare QB slot would tell the reader the mechanism
changed when only the league did. It asks the player's whole `fantasy_positions`
list rather than his first, since Sleeper lists two for the players this matters
most for.

**Grouped by counterpart, not by league.** One counterpart is one decision made
in however many lineups; grouping by league would split the same pairing across
a dozen headings and make the count the reader is after something they had to
add up. One row per league per pairing, never two. A **locked** player is still
a counterpart — the card's numbers stop offering moves once a game kicks off,
which is right for a tool answering what can still be changed, and this answers
what was already decided.

**A projection is scored by the league's own settings, so a row spanning
leagues has no single figure.** `points` is the value where every counted
league agrees and **null where they do not** — an average is a number no league
pays and the first league's is that same arbitrariness hidden. It is answerable
far more often than that sounds, because picking a counterpart re-folds over
that pairing's own leagues, which is usually one scoring. The per-league deltas
are never affected: each is computed inside one lineup.

#### What moved, and the one fallback that was wrong

- **`league-subjects.ts`, `shares-drawer.tsx` and `subject-tokens.tsx` went to
  `features/shared`** — the line `CONSOLE_KEY`, `ManagerPlate`, `card-plate.tsx`
  and `LineupColumnsDialog` all moved on, and the same folder rule, since
  `features/lineupchecker` may not import from `features/manager`.
  `SubjectKind` widened to the four panels and became the exhaustive seam
  `SHARES_COLUMNS_BY_KIND` is a `Record` over, and `matchesSubjects` takes its
  maps through a `SubjectRolls` resolver rather than one argument per kind — so
  a fifth panel does not compile until it has columns and does not narrow until
  it has a population.
- **The drawer's `seasonSummary` fold came off it.** A record arrives on the row
  already spelled (`rowRecord`), against the same aggregate the identity plate
  reads. It was a manager-only cost every panel paid and a league list every row
  had to carry; a week panel has neither.
- **`SharesDrawer` gained a `detail` slot, and it is two nodes rather than
  one** — `deck` takes the search-and-sort band inside the raised plate and
  `body` takes the scroller's contents. Handed one node the caller would draw
  its own plate and its own tray, and the panel's two surfaces would then have
  two spellings. The title band above is deliberately untouched: it is still the
  same panel counting the same population.
- **The rack's Browse keys are data now** (`RackControls.keys`), where the two
  legends used to be written into `features/tools`. That held while `/manager`
  was the only page publishing a pair; with a second page publishing a different
  one the rack would have carried every page's vocabulary and a `switch` on the
  route to choose between them. Both pages hand over a **module-level** array,
  which is what `usePublishRackControls` requires rather than prefers — a
  literal rebuilt each render republishes each render.
- **`sharesColumns` falls back to everything the panel offers, where it used to
  fall back to the panel's last column.** That was the one thing a render caught
  that no test would have: the stored default is three season metrics, neither
  week panel offers any of them, so *every* first visit hit the fallback and was
  shown `Bench` alone — a panel silently missing the half it is named for.
  `Started` and `Bench` are one reading split in two. The leaguemates panel
  gains its `Rec · Win` back on the same terms, which is the column it already
  defaulted to whenever anything at all was stored.

**Subjects of the two week kinds compose with each other through
`matchesSubjects` exactly as `player` and `leaguemate` do**, which is a
deliberate divergence from the handoff's "switching panels resets the
selection". That predicate is written for a mixed selection and tested for one,
and the handoff's own first rule — the panels stay mounted so their state
survives — is what a reset would undo. What does reset is drawer-local: closing
a panel clears its query, its open decisions view and its picked counterpart.

#### Verified

Rendered through a temporary `/preview` route against the real components,
tokens and Tailwind build — the method the console-card, shares, rack and
timeline passes established, since no database is reachable from where this was
built — then driven over CDP at 1280 and 390 in both schemes and deleted. The
mechanics that method needs are unchanged: `--no-proxy-server`, and `localhost`
rather than `127.0.0.1`. The fixtures are three leagues: a dynasty superflex, a
one-QB league, and a league with no scheduled opponent.

Every arm landed. The panel opened on **both** columns with `Started ▼` sorting
and no meter under either, the bench figure a step quieter than the started one,
and the readout reading `Across all 3 leagues · week 1`. The Opponents panel
read `Across all **2** leagues` over the same fixtures — the third league has no
opponent — docked right, and searched "opposing players". Pressing Lamar Jackson
replaced the search band with the decisions deck (`Back`, `QB · BAL`,
`Proj 21.6`, `Started in 2 of 3 leagues · benched in 0`) and the tray with three
counterpart cards, **all three from the superflex league**: the one-QB league
contributes nothing, because no seat there takes both a quarterback and a
receiver, which is the rule end to end. Picking one narrowed the line to
`With Rome Odunze · 1 of 3 leagues` and the tray to one card; `Back` restored the
list with the row still lit; Escape closed the panel and left the subject token
behind it. A benched subject drew `RB1`/`RB2`/`WR1`/`WR2` seat indices,
`Direct` against a like seat and `Via FLX` across one, and every negative delta
in the error tone (`rgb(252,165,165)`) against the muted readout for a positive
one — with the unprojected stash drawing an em dash and **no** colour on both
its `Proj` and its delta. In the rack, `/lineupchecker` published `Starters` and
`Opponents` and `/manager` still published `Players` and `Leaguemates`, both
`display: contents` at 1280 and folded behind the collapse key at 390.

One render changed the code. At 390 a league row is 284px of which the chip, the
seat, the route and the delta take ~240, leaving the league name **44px against
the 122px it wants** — every league read as six characters and an ellipsis, the
failure this file has already recorded twice at other grains. The row wraps
below `@md` now and the name takes the line above it; measured after, 284px and
not truncated at 390, unchanged at 30px on one line from 640 up. The counterpart
caption lost its position for the same render — the badge beside it already says
it — and wraps rather than truncating, since the two counts are what the card is
read for and truncation cut them off exactly where they start.

At every width and in both schemes: `document.documentElement.scrollWidth` equal
to the viewport, zero elements past the panel's own box, `:modal` true, one
`<h1>`, one `<nav>`, and **no console output of any kind**.

**Not verified against real data**, which is the gap to close first: every
number above is a fixture. Three things a render cannot check — what a real
account's decisions list actually costs (a player started in twelve leagues with
eight legal bench candidates each is a long page, and there is no cap), how
often the mixed-scoring rule leaves the `Proj` window on an em dash across a
real 113-league account, and whether `opponent_lineup` is populated as widely as
`opponent_points` already is.

## The trades board

`/trades` is every trade this database has stored for a season, newest first,
narrowed three ways. **A trade is not a table**: it is a `transactions` row with
`type = 'trade' AND status = 'complete'`, which the league sync has been
mirroring since the graph landed and nothing read until now. The tool card was
declared from the start (`accountless`, no `hrefFor`) and this is what arrived
behind it.

**The card has since been redrawn — see The console card below.** It gained a
value per asset and a side total (both `—` until the KTC matcher ports), a
league avatar and a much larger league name on its plate, a timestamp where the
plate carried a scoring week, and the housing-and-windows surface the other two
tools' cards now share. The three narrowings, the keyset walk and the circle
are untouched.

**And it now carries the manager card's configuration window**, under the plate
that names the league and above the hauls it prices — format, lineup mode,
teams, starters, the QB, SF and TE ladders, the TE premium. It is the
same component read from the same rules rather than a second derivation (see The
configuration window, which moved to `features/shared` for this), so a league
described one way on `/manager` cannot be described another here. What it
answers is the thing a value on this board could not say on its own: the same
two players are a different trade in a dynasty superflex league than in a
redraft one, and until this landed the two printed under the same numbers with
nothing on the card saying which game was being played.

**It is drawn only once the league row has arrived**, which is this card's own
rule rather than the window's. Every rule the window reads treats an absent blob
as its own default — an absent `type` is redraft, an absent `best_ball` is
managed — which is right for a league that *answered* and said nothing, and a
claim for one that has not answered yet: the card would state "Redraft ·
Managed" over a dynasty league for as long as `/api/trades/leagues` took, then
silently correct itself. Nothing is the honest reading, and it is the same beat
the league's name already spends showing its id. The KTC market resolution
opposite is deliberately *not* gated the same way — see the local `leagueType`'s
own note: a price on the conservative board is corrected by the same request,
and both markets are already on the wire.

*Verified* the way the console-card pass was, since there is no Sleeper access
from where this was built: a temporary `/preview` route rendering the **real**
`TradesList` and `LeagueCard` against fixture leagues — dynasty superflex,
redraft best ball, a keeper league whose `roster_positions` never synced and
whose `total_rosters` is 0, a chopped league, and a trade whose league row is
absent — screenshotted over CDP at 1280 and 390 in both schemes, then deleted.
Every arm landed: the unsynced league drew `—` for both counts, both ladders and
the premium with **no pips at all**, the absent-row trade drew no window, and
the redraft league's one-QB ladder drew one lit pip of two. The two cards'
windows are identical in the DOM but for their placement classes — the manager's
`mt-3.5` + `translateZ(18px)`, the trade card's `mb-4` and no transform — which
is the one thing the shared move was allowed to change.
`document.documentElement.scrollWidth === 390` at phone width, where the row
wraps as it already does on a manager card, and still exactly one `<h1>`.

**The three narrowings are three different kinds of thing, and the split is the
whole design.**

- **The league rules run in the browser and only their *answer* crosses the
  wire.** They are the same `league-filters` engine the manager page uses, over
  Sleeper's JSONB blobs; a second implementation in SQL would drift silently,
  and the symptom would be a filter quietly returning the wrong leagues rather
  than an error. `/api/trades/leagues` hands the page every league that traded
  this season — once, not per page — and `resolveLeagueScope` sends back
  whichever of the include/exclude lists is shorter.
- **The bays run in SQL.** A *bay* is one side of the trade a reader is
  describing, and **everything in it is what that side received — there is no
  `gave` field anywhere.** A give is the other bay's take, so "what did he give
  up" is his name in one bay and the player in the other; that is how a
  direction gets into the vocabulary without a directional field, and it is the
  same rule `assembleTrade` stores a trade by. `sidesSql`'s nested `EXISTS` is
  what makes the two bays *distinct* rosters — two independent subqueries
  cannot compare their rosters to each other, so `[A] ⇄ [player]` would match a
  trade where A received the player.
- **The circle crosses unresolved**, as a word plus the stored account's id.
  What "my leagues" and "my leaguemates" stand for is the database's answer; a
  browser holding it would have had to be told it first. Verified against the
  live corpus, and the nesting the type claims holds exactly:
  mine 586 ⊆ leaguemates 595 ⊆ leaguemate-leagues 599 ⊆ all 634.

**`trade_participants` is the one derived table, and it is rebuilt *inside*
`writeLeagueGraph`'s transaction.** A trade names rosters in a jsonb array and a
reader names people; a jsonb array cannot be joined to, so every read that asks
"was one of these managers in this trade" would otherwise unnest and cast per
candidate trade — on the leaguemates circle, the managers facet and both
denominators, none of which has a `LIMIT` to stop it. It commits with the rows
it describes or not at all, because a missing participant row makes a trade
**invisible** to the circle that should have found it: a plausible wrong answer
rather than a visibly thinner one. Its migration backfills the whole corpus for
the same reason — the reads switch over the moment the code deploys — and the
backfill's SQL must stay textually what `tradeParticipantsSql` emits, which
`sql.test.ts` pins by reading `db/migrations/*.sql`.

**Two indexes on the same column, deliberately.** `transactions_trade_keyset_idx`
is ordered on `coalesce(status_updated, created, 0)` and
`transactions_trade_recency_idx` on the *two*-argument coalesce, which to the
planner are different expressions. The board's page needs the first (a row
comparison is null-propagating, so the keyset resume folds the null away); the
counts and facets have no `ORDER BY` and read a date window as a *range* on the
second. Spelling the window as the sort key would make the older index
droppable and those counts a full scan — `sql.test.ts` pins each expression to
the migration that indexes it.

**Zero and absent stay different everywhere on this wire.** `nextCursor: null`
is the *only* end-of-board signal — a page that exactly fills the limit might
still be the last one. `total`/`scopeTotal` are counted on a **first page only**
and are `null` on later ones (and on a failed count, which degrades the
denominator rather than the list). A player the stored map has no row for keeps
his **id** on the card: a visible, searchable token beats a blank.

### What this port changed against TheLabX

- **The contract direction inverts.** TheLabX declares `Trade` beside the
  assembler and its contract imports it; here `shared/contract/trades.ts`
  declares it and `shared/trades` imports it back with `import type`. The rule
  this folder exists for is that a `"use client"` module must name a payload
  without pulling `pg` into the browser, and a trade is named on both sides of
  that seam. `PlayerSummary` moved for the same reason.
- **`LEAGUE_COLUMNS_SQL` and `toManagerLeague` were extracted** in
  `manager/queries.ts` so `getSeasonTradeLeagues` and `getManagerLeagues` cannot
  drift. A field added to `ManagerLeague` now arrives on both or on neither;
  `team_name` and `record` are null on the trades list because there is no
  manager in that question.
- **No query library and no virtualizer.** `use-trades` is the keyset walk
  hand-rolled on the house idioms — the subject key is the request's normalised
  query string, the reset happens *during render*, one abort controller lineage,
  and `loadMore` is stable because it is handed to an IntersectionObserver (a new
  identity per render would tear the observer down, and with the sentinel still
  on screen that walks the whole board in one go). The cost is deliberate and
  documented: no `keepPreviousData`, so a filter press blanks the list for one
  round trip. **The page size is 100 rather than TheLabX's 200** because every
  loaded card stays in the DOM.
- **`BoundedCache` declares its fields explicitly.** Node's strip-only mode
  cannot parse a TypeScript parameter property — it fails to *parse*, not to
  test — so the constructor assigns rather than declaring in its signature.

### Deliberately not ported, each with what it arrives with

- **Board *selection* for the ADP prices.** ADP prices landed with the value
  basis — see The value basis, and colour on an asset — off a season-wide
  `getSeasonDraftAdp`. What is still absent is the half `adp-value.ts` has always
  named as missing: `adpBoardFor`, the filters and the signature that decide
  *which* crawled drafts a board is pooled from. It arrives with `/api/adp`, and
  is the read that replaces this one.
- **`trade_rosters` and the anchored timeline.** **The rewind and the rail have
  since landed** — on the manager card, over a league's whole log; see The
  league's history. What is still absent is this board's own half of it: a sheet
  opened *from* a trade card, whose rail stops at that trade and whose far stop
  is the two sides as they stood before it. That is one field on the payload
  (`anchor`), one `findIndex` truncation on the read, and the snapshot walk
  (`rewindTradeRosters`) that fills a `trade_rosters` table this repo does not
  have. It arrives with the sheet.
- **`trade_market_stats`.** TheLabX precomputes the unnarrowed denominator
  because its corpus is millions of crawled transactions; here `countTradeTotals`
  always counts, which is a walk of a partial index holding the trades and
  nothing else.
- **The facets memoiser.** Three aggregates over this corpus are milliseconds
  and a reader who never opens the panel never asks. The one *rule* it carried —
  count the menus **without** the selection, or each collapses to its own
  selection the moment you make one — is `facetsQuery` in `trades/params`,
  applied by `readTradeFacets` so a route cannot forget it.

### The scope outgrew the request line

The one thing this section listed as unported was TheLabX's **POST-body league
scope**, on the grounds that a manager-sync-fed corpus could not reach the
length that needs one. The crawler is what made it reach: a filtered board over
a two-thousand-league corpus sent ~800 excluded ids, 19KB of query string, and
Heroku's router answered **431 with an empty body** — which arrives at
`apiFetch` as a failure naming nothing, so the board went blank the moment a
reader narrowed it. It is ported now, as `features/trades/trade-query`'s
`tradeHttpRequest` and `shared/trades/transport`.

**The ids are still all sent, and the fix is only about how.** A cap on the
scope would be a cap on how many leagues a reader may filter over, enforced at
the moment they narrow — and the older reading of TheLabX's threshold, where the
page gave up narrowing past it and filtered in the browser, is the thing this
file has warned against since the board landed: a first page of excluded trades
renders the empty state, which unmounts the list, which is what would have asked
for page two.

**A body is the rest of the query string, form-encoded — not a vocabulary of its
own.** `readTradeParams` folds it back into one `URLSearchParams` before
`parseTradeQuery` sees it, so the parser, the SQL and the payload cannot tell
which method was used, and a parameter that grows unbounded later needs no new
seam. It is why the two routes are `GET` and `POST` over one handler rather than
two shapes. Three rules keep the fold honest: the **body wins** on a key both
carry (`list()` reads repeated keys as one list, so joining them would *widen* a
scope a stale line parameter had narrowed — a filter failing open); a body that
is **not** form-encoded is refused **415** rather than read, since
`new URLSearchParams('{"leagues":["a"]}')` parses happily into a key nobody
reads and would arrive as no narrowing at all; and the cap is applied to the
**stream** rather than to the declared length, past which the answer is a 413 —
never a truncated list.

**The threshold is 2,000 characters of query, far below the 8KB a router
carries.** That budget covers the request line *and* every header beside it, so
what is left is ~6KB for cookies and the rest; 2,000 characters is around ninety
league ids at 22 encoded characters each. It is deliberately conservative
because what sits on the other side is not a slower board but a bodiless 431.
**Only the league scope moves**, because only the league scope is unbounded — a
reader cannot select their way past a request line — and a long request with
nothing movable in it stays a GET rather than being declined here.

**How a request travelled is not part of what it is.** `tradeQueryKey` is built
from the parameters and never from the transport, so the paging hook's subject
does not change on the beat a scope crosses the threshold. The one real cost is
that a POST forfeits the page route's `Cache-Control: private, max-age=30` — no
browser caches one — which is why only the long scopes pay it.

#### Verified

Against a throwaway Postgres 16 cluster seeded with 2,000 leagues, one trade
each, since the failure is a property of corpus size rather than of any stored
row. The old shape reproduces exactly: 1,999 excluded ids is a 40,006-character
query string and **431** — locally, from Node's own header limit, the same
status Heroku returned. The same request through `tradeHttpRequest` is a
19-character line and a 39,986-byte body, **200**, and the narrowing is exact:
one trade, from the one league not excluded, `total` and `scopeTotal` both 1.
`/api/trades/facets` took the identical scope and answered its menus. The keyset
walk holds over POST — 1,990 excluded, `limit=4`, three pages of 4/4/2 covering
exactly the ten leagues left, `total` on the first page only and null after,
`nextCursor` null at the end. A JSON body 415s, a body past the cap 413s, a
malformed `?season=` still 400s, and a scope short enough to fit is still a
plain GET.

### KeepTradeCut prices landed here

`enrich.ts`'s header always said this was where the KTC lookups would land, and
they did: the name matcher filled `ktc_values.sleeper_id` and `ktc/picks`
reached the rookie-pick rows, so a card prices its players, its picks and each
side's total. FAAB stays `—` permanently — a league's own currency is not
something a market prices — and a side that could price **none** of its haul
totals `—` rather than `0`, which is the rule `asset-value.ts` was written to
carry before it had any numbers to carry it for. A zero there is a claim in
exactly the sense a `DEFAULT now()` is.

Both markets ship per asset and the card picks between them; that asymmetry
with the manager page is argued in **Choosing a KeepTradeCut market** above.
Three reads back it, all cached and all narrowed to what the page names:
`lookupLeagueMarkets` (a league's superflex reading and its size — the second
is the width a round's thirds divide, taken from `total_rosters` rather than
from a draft order that loses a departed user's slot), `getDraftSlots`, which
was already there, and `lookupKtcMarkets`, which is a deliberate pass-through
rather than a fourth cache: `shared/ktc/board-read` already holds the boards
for the sync's TTL, and a second cache in front of it would be a second
staleness policy for one set of numbers.

**The superflex predicate is asked in SQL against the same derived list
`isSuperflexLineup` reads**, bound rather than spelled, the arrangement
`getManagerDraftAdp` already uses. One consequence worth knowing, because it
looks like a bug and is not: a league with a single `SUPER_FLEX` slot and *no*
`QB` slot reads the **1QB** column, since it starts at most one quarterback.
Checked live against stored rows — a real two-QB league priced every asset off
`sf_value` to the digit.

### The players table came with it

`shared/players` and a daily sync of Sleeper's `/v1/players/nfl` (~12k entries,
~5MB) are new, on the KTC scheduler's exact terms: `PLAYERS_SYNC=off` disables,
the **boot tick does not force** (a restart inside the TTL re-downloads nothing)
and **interval ticks do** (the interval equals the TTL, so an unforced one would
find the rows a moment short of stale and skip forever). The advisory lock wraps
the *freshness check*, not just the fetch — otherwise every instance decides for
itself that a refresh is due and they queue up to download 5MB in turn.

**The trades board is what forced it.** The only name source here was the
projections feed, which answers for the current season's rostered players, and a
trade list is history: a 2021 trade names players who have since retired. The
upsert never deletes, so a player Sleeper drops from the map keeps his row —
the map is Sleeper's *current* players and the board is not.

Checked at 1280 and 390 in both schemes, against the live corpus: pagination
appends one page per scroll (100 → 200 → 300 → 400, no runaway), a player
selected in the search panel narrows the board to exactly that facet's own count
(16 of 634), and pick labels read "2026 1.05" where the order is known and
"2027 1st from <owner>" where the origin is a third party. Light mode is derived
rather than designed, as everywhere else on the console. **The two filter
dialogs kept their pre-console chrome**, the same open item the leagues console
recorded — the `Filters` trigger visibly did not match the mono keys beside it.
**Closed since**: the manager console pass re-housed the shared dialog, so this
page got it too, and the trigger now takes `CONSOLE_KEY_PILL` like the `Search`
and `To today` keys it stands beside.

### The value basis, and colour on an asset

Every figure on this board was KeepTradeCut and nothing said so. KTC is one
answer to "what is this worth" and the app already derives two others — the ADP
curve `/manager` prices a roster's capital with, and a rest-of-season projection
under the league's own scoring — so the board offers all three behind one key,
and each take-side figure is coloured and metered by where that asset stands
among the priced assets of its own league. Applied from a design handoff.

**It needed no migration.** `rosters.players`, `leagues.scoring_settings`,
`leagues.roster_positions` and `draft_picks` have all been stored since the
league-graph migration; what was missing was a read of them from this route.

**All three bases ship and the client picks, which is the same trade this
payload already made for KTC's two markets.** A basis is a *display unit*:
putting it in `TradeRequest` would reset a scrolled keyset walk to page one to
change one — the documented cost of this board having no `keepPreviousData` —
and flipping basis is **comparative**, a reader switching between two to watch
one card change, so a round trip per press would land in exactly the case the
control exists for. `TradeAssetValue` is therefore `{capital, ktc:{dynasty,
redraft}, ros}` per asset, and the panel is a render.

**The rank is why any of this is server-side.** A value is a lookup and the
browser could do it; a *rank* is a statement about a population, and the
population is the league — every player its rosters hold and every cell of its
pick grid — where the client holds only the page it has scrolled to. Computed
there, a colour would mean "third-best among the fourteen currently on screen",
which is a different sentence and a false one. So `shared/trades/valuation.ts`
builds one universe per league per basis and ranks into it.

**A `{rank, of}` crosses the wire, never a percentile.** `rankPercentile` and
`rankFill` in `features/shared/rank-ramp` are what the manager card's meters and
hues already come off and they must be fed the same number or the bar and the
colour disagree; `shared/` cannot import that module, so a percentile computed
server-side would be a second spelling of it on the far side of the seam. Shipping
the rank is what lets this board read them through the identical two functions —
and `rankPercentile` rather than `rankFill` for the hue, because `rankFill`
answers 0 to two questions and painting "nothing to rank" full red claims a
result.

**The asset's own figure is in its own population.** The universe is the
league's rostered players unioned with the players this page's trades name: a
traded player may since have been dropped, and left out he would rank `of + 1`
and the meter would run past its own track.

**The pick population is the league's grid, not the picks on the page** — every
(season, round) the market prices, one entry per roster, tiered by the draft
order where that season's is known and untiered where it is not, which is most
of them. Ownership never enters it, because who holds a cell does not change
what the league's picks are worth. Players and picks rank in **one** ranking,
because that is what the colour claims; split, a 2029 4th would sit at the top
of a three-item pick ladder beside a card saying it is worth 190.

**Three bases, and only one of them prices a pick.** There is no ADP pick ladder
in this repo (`ktcPickDiscount` is unported and arrives with `/api/adp`) and a
pick has no rest-of-season projection because it is not a player yet, so both
answer null and the card draws an em dash. A zero would say a 2027 first is
worth nothing.

**A league that cannot anchor a basis is left off it rather than given a
degenerate one.** `leagueAdpPool` is teams × starters, so a league with no
stored size has a pool of zero and every player collapses onto the peak;
`scoreStatLine` reads a null scoring table as nothing scored and answers a flat
zero for everyone in the league. Both are the same claim in different clothes,
and both read as "not priced" — which the all-zero arm of the ranker would
refuse to rank anyway.

**`getSeasonDraftAdp` is the one genuinely new read, and it is a widening rather
than an invention.** `getManagerDraftAdp` is a manager's synced drafts and this
board is `accountless` by construction, so there was no manager whose drafts
could be the population. Both are now one statement with the manager as its only
difference — every judgement in it (which draft is a rookie board, which are
excluded, how the two fold) is a rule about drafts rather than about whose they
are, and two copies would be two chances to read one of Sleeper's quirks
differently on two pages showing the same players. The two splits that make an
average meaningful are unchanged: superflex apart from standard, rookie apart
from full. What is still absent is board *selection* — no `adpBoardFor`, no
filters — which arrives with `/api/adp` and is the read that replaces this one.

**Three reads are not bounded by the page and all three are cached**: the season
ADP aggregate (`lookupSeasonAdp`, fifteen minutes on `globalThis`, evicted on
rejection), the folded projections span (`getRosProjections`, half an hour) and
the two markets (`getKtcBoards`, the sync's own fifteen). None is re-read per
scroll, which is what makes three bases affordable. **Every basis degrades on its
own** — a failed span, an unreadable market and a season with no completed draft
each cost that basis and nothing else, and `values` on the payload is what the
panel says so from.

**The colour lands on the take track only, and no total is ever coloured.** A
give line is the other side's take line, so colouring both would draw every
asset on a two-sided card twice in the same hue and the card would stop reading
take-first — the one thing its redundancy is paid for by. And a coloured total
is a fairness indicator by implication, which `trade-card.tsx` rules out by
name. The side header gained a `CAP`/`KTC`/`PTS` unit instead: three figures on
three scales never share a column without one, and a total that changed because
the reader flipped the panel would otherwise be indistinguishable from one that
moved.

**The Auto/Dynasty/Redraft keys moved off the rail and into the panel**, the
same call that put them at the foot of the manager page's Columns dialog: they
are a KTC question and say nothing on the other two bases, so out on the rail
they read as a second control over every number on the page. **Disabled on the
other two bases rather than dimmed-but-pressable**, which is where this differs
from the prototype — a key that visibly changes nothing is one a reader presses
twice and then distrusts, and this app's rule is to make an ineffective control
unreachable rather than to let it be pressed and ignored. Real `disabled` is
safe because nothing in that group has focus when the basis moves: the press
that turns it off landed on a lamp above.

**The panel is the rail's width, not the key's.** Anchored to its own key it
would be a 23rem box hanging off a control two thirds along a 362px row, and at
a phone's width it would leave the viewport on the left; anchored to the rail
(`relative z-30`) its right edge is the shell's own gutter and it cannot. It is
**not a `<dialog>`**, on `ToolsMenu`'s terms, and it deliberately **stays open on
a press** — see comparative, above — so the capture-phase `pointerdown` and the
Escape that returns focus are spelled out rather than inherited.

**The basis has its own storage key** (`thelab:trade-value-basis`), not a share
of `thelab:ktc-board`: those are two questions and only one is about KTC — the
board choice says *which market*, this says whether a market is being read at
all — so a reader on the capital basis still has a board choice and it still
means what it meant.

**The page took `ConsoleGround` and dropped its own panel**, which is the answer
to the handoff's blocking width question and is recorded there rather than here:
see the report under **The page width, answered**, below.

#### The page width, answered

The handoff asks for a report and the report is short, because the premise was
wrong: **`/manager` is not edge-to-edge and never was.** Both pages already
passed `PageShell width="console"` — `max-w-6xl`, 72rem, 1152px — and the shell
has exactly three arms (`default` and `wide` are both `max-w-4xl`, differing
only in gutters; `console` alone is `max-w-6xl`). `app-rack.tsx` is `fixed` and
its own width, tied to the shell only through `--rack-clear`.

So the whole difference was the panel `TradesHome` drew *inside* the shell —
`px-5 sm:px-10` plus a border, which is ~106px at 1280 and ~50px at 390 that
this page spent and `/manager` did not. It is the identical finding
`/lineupchecker` recorded when it took the ground, down to the numbers, and it
took the identical fix: the panel is gone, the route renders `ConsoleGround`,
and a trade card is now the same width as a league card by construction rather
than by two spellings of a width. `/tools` (on `wide`) is untouched.

#### The other three questions

- **Positional vs overall percentile** is **overall**, as the prototype implies,
  and it is the one answer that is not obviously right — flagged back rather than
  settled. Two things push against positional here. A pick has no position at
  all, and picks and players rank in one ranking for the reason above; and the
  colour is meant to say "where does this asset stand among what this league
  trades", which is a question about the league's whole board rather than about
  a depth chart. The cost is real and is the handoff's own: tight ends and
  kickers read cold against running backs. Positional would be a second ranking
  keyed on `PlayerSummary.position` and is a small change to `valuation.ts` if
  that is the call.
- **The dimmed board track is `disabled`** — argued above.
- **Mobile** holds. The meter's 9rem cap is a `max-width` and reads as a meter in
  a ~290px window; the side header is name (`min-w-0 truncate`), unit, total and
  fits at 390 with the sides stacked below `sm`; the panel sits at x=14 of 390.

#### Verified

Rendered through a temporary `/preview` route against the real `TradesList`,
`TradeCard` and `ValuePanel` — the real tokens, the real Tailwind build and the
real `local-store` hooks, so a driven run exercises the persistence — then driven
over CDP at 1280 and 390 in both schemes and deleted. The method's two mechanics
are unchanged: `--no-proxy-server`, and `localhost` rather than `127.0.0.1`. No
database is reachable from where this was built, so **the numbers below are
fixtures** and what they check is the rules and the layout rather than Sleeper.

The fixtures are two leagues — a dynasty superflex whose assets rank across a
214-asset universe, and a redraft league with one priced asset a side so nothing
ranks — plus a kicker priced on no basis, a FAAB leg, a three-way trade and an
undated one.

Every arm landed. On KTC the first card drew four coloured take figures with four
meters (`8,120` at rank 2 of 214 → a full-width green bar, `640` at 205 → a red
sliver) and the give track opposite stayed `--readout-muted` with **no meters and
no colour**; both side totals stayed `--readout-text` under a `KTC` unit.
Switching to Capital left the panel **open**, moved the key to `Value · Capital`,
the readout to `CAP` and the figures to the capital column — and dropped the card
to **three** meters, the pick having no ADP ladder to place it on, which is the
"a pick prices on KTC alone" rule on screen. Pts ROS did the same to `241 / 148 /
204`. The board keys read `[false,false,false]` on KTC and `[true,true,true]` on
the other two with the note switching to "Only the KTC basis reads a board". The
second league drew its figures with **zero** meters — nothing to rank. The
staleness line read `mixed · 41m ago`, the older of the two markets. Escape
closed the panel and returned focus to the key; an outside `pointerdown` closed
it.

At every width and in both schemes: the panel inside the viewport (x=14, width
362 at 390; x=832, width 368 at 1280), `document.documentElement.scrollWidth`
equal to the viewport, zero overflowing elements, exactly one `<h1>`, and no
console output but the dev server's own React-DevTools and HMR lines.

`valuation.test.ts` is where the arithmetic is pinned rather than rendered:
competition ranking with ties sharing and the next distinct skipping, a null rank
for a population of one and for an all-zero one, a dropped player still inside his
own population, the grid as the pick population, a slot's tier off the league's
draft order, a pick null on both non-KTC bases, an unsized league unable to anchor
the curve, an unscored league unable to score a projection, an empty `weeks`
reading as no projection where an empty `stats` reads as a projected zero, an
unreadable market costing its own column alone, and `auto_board` reading "mixed"
only where a page holds both kinds.

**Not verified against real data**, which is the gap to close first. Three things
a render cannot check: whether the season-wide ADP board's coverage is wide enough
for the capital basis to be worth reading on a corpus this size, what the
projections read costs on a page spanning a hundred leagues (the board is shared
and cached, but it is scored per league), and whether the pick grid a league
enumerates matches the one its own card draws.

## Tracking placeholder picks

`/picktracker` was the one tool this app *declared* and did not have: an entry in
`constants/tools.ts`, a key in the rack, and a 404 behind both. It is TheLabX's
feature ported, plus a live half that repo never had.

**It is a decoder for a league convention, not a draft board.** Leagues that let
managers trade next year's rookie picks during a startup draft cannot draft
those rookies — they are not in Sleeper's player pool yet — so they draft
**kickers as stand-ins**, and the Nth kicker off the board is rookie pick N. That
makes Sleeper's own numbers wrong on purpose: `shared/picktracker/picks.ts`
sorts by `pick_no`, filters to `metadata.position === "K"` and **numbers from the
filtered index**, so the pick's own `round`/`pick_no` are discarded. Verified
against a live league, which is the check worth keeping because agreement would
mean the filter had failed: Sleeper's `1.04`, `2.01`, `2.04`, `2.12`, `3.01` are
placeholder `1.01` through `1.05`.

**`slots_k > 0` is the only predicate available, and it cannot be narrowed.**
It matches any league that rosters a kicker, so an ordinary redraft league's
kickers are renumbered into a placeholder sequence that means nothing — the tool
will happily report six rounds of rookie picks that nobody is trading. The
obvious narrowing is to ask whether the league *really* starts a kicker, and it
does not work: **a league running the convention still carries `K` in its
`roster_positions` while the draft is on**, because that slot is precisely what
lets a kicker be drafted at all. The two cases are indistinguishable from the
graph, which makes this a decoder a reader *aims* rather than a detector that
finds placeholder drafts on its own — the tool is opened against a league you
already know is running the convention. Do not re-propose a roster-shape filter;
it would reject exactly the leagues the tool is for.

Two adjacent traps ride in that file's doc comments. Teams per round is
`settings.teams`, because `draft_order` maps only *users who claimed a slot* and
is null before an order is set — `seasonDraftSlots` documents the same trap.
And `nextPickLabel` gates on `draft.status`, never on arithmetic, because after
the last pick the arithmetic still names a plausible slot that will never exist.

**It needed no migration and reads no table.** Four Sleeper calls behind ~230
lines of pure logic; `npm run migrate:up` reported "No migrations to run". It is
therefore a **deliberate exception to "a cache-backed route reads and nothing
else"**, joining the manager routes and `POST /api/league/[leagueId]/sync`: the
tool follows a draft *while it happens*, for any league id whether a sync has
seen it or not, and the crawler's fifteen-minute live tier is most of a draft.

### Why SSE, and why the poll is shared

**Sleeper publishes no push API** — the documented API is read-only REST, whose
only operational guidance is "stay under 1000 API calls per minute". The socket
its own client uses is undocumented and unversioned and would be this repo's
first runtime dependency outside React/Next/`pg` for a protocol client. So
something must poll, and the only question is where.

**It polls server-side, once per league.** The tool is meant to be pasted into a
league chat mid-draft, so a dozen people opening one link is the ordinary case,
not an edge — and a poll per viewer would be a dozen fan-outs for one draft. A
client timer is also throttled to ~1/min in a background tab, the argument the
lineup checker's Sync key already makes against a client-side countdown. What
reaches the browser is SSE rather than a websocket because a route handler can
return a `ReadableStream` today (the leagues route already streams NDJSON) where
an upgrade would need a custom server this app does not have.

**A tick is two calls, and the split that makes it two is a decision rather than
an optimisation.** `trackPlaceholderDraft` reads the league, its drafts, its
picks and its members; `retrackPlaceholderDraft` re-reads only the draft and its
picks against a held `PicktrackerContext`. But **the context is immutable
*during* a draft, not immutable**: before one starts, `draft_order` is unset, the
league's size can still change and members are still joining, so a room re-reads
it whole while the status is `pre_draft` and once more on any status transition.
Holding the first read forever labels every pick against a team count from
before the order was set and drops any manager who joined since.

**The change signal is `status:last_picked:kickerCount`.** `drafts.last_picked`
is Sleeper's own stamp of the most recent pick, which is the one thing it is
right for — this repo's `SleeperDraft` doc warns against reading it as an *end*,
and a running edge is exactly what a change detector wants. It is paired with the
kicker count because a non-kicker pick moves the stamp and changes nothing on
this board, and with the status so that a draft *completing* registers even
though its last pick is not new. Nothing is sent when nothing changed, which is
what makes a 15-second cadence reasonable on a page left open for three hours.

**A completed draft stops the poller outright.** `pollIntervalMs` answers null,
the timer is cleared, and the stream stays open holding a board that will not
change — a finished draft is a fact, not a feed.

### The four things that are silent when wrong

- **Bytes must be written before the first `await` in `start`.** Next flushes
  response headers on the first chunk, not when the `Response` is returned — its
  own comment in `pipe-readable.js` says so. Until something is enqueued the
  browser has no headers and `EventSource.onopen` has not fired, so the reader
  stares at a connection that is in fact healthy. The route writes a jittered
  `retry:` line first; the jitter is because a fixed reconnect delay is a
  thundering herd when a dozen viewers lose one deploy together.
- **`desiredSize` needs a queuing strategy to mean anything.** A `ReadableStream`
  built with no strategy gets a count-based high-water mark of **one**, so
  `desiredSize` drops to 0 the instant one chunk is queued and unpulled — the
  normal state of a healthy stream. A back-pressure guard read against that
  default silently discards every frame after the first, which is precisely what
  it did: the connection opened, `onopen` fired, and no board ever arrived. The
  stream is constructed with `new CountQueuingStrategy({ highWaterMark: 16 })`.
- **The in-flight open is shared, and that is the feature's whole claim.**
  Looking a room up, missing, and *then* awaiting a four-call read has every
  simultaneous cold joiner run its own — and simultaneous cold joiners are the
  use case. The promise is registered before the await with nothing between the
  miss and the insert; re-checking the registry afterwards would deduplicate the
  *room* and never the Sleeper work already spent. Verified: six concurrent cold
  viewers produced exactly one `room open` line.
- **A terminal failure must say so before closing.** `EventSource` reconnects on
  *any* close, so a league id that will never resolve would be retried a second
  apart forever by every tab that opened it. The route sends `type: "error"` and
  closes; the hook calls `close()` on it. Both halves are required. Measured: a
  nonsense id answers one frame and closes in 0.26s.

**The room is ref-counted and its teardown is deferred by 30 seconds.** The
linger is not politeness: React's StrictMode double-mount takes the count
1 → 0 → 1 within a turn, so without it every dev page load costs two four-call
reads. It is cancelled *before* a rejoining subscriber is added, because a timer
firing between the two would tear down a room that has just been joined. A room
is also born with an armed teardown, as the backstop for a joiner that goes away
between the read landing and its seat being taken. Verified: both test rooms
logged `room closed` after their linger — a poller outliving its subscribers is
the failure with no symptom.

`startBackgroundLoop` is deliberately **not** reused. It is a fixed
`intervalMs` where a room's cadence changes with the draft's status and then
stops, and its guard is a `Set` of app-lifetime loop *names* where a room is
ephemeral and keyed by league. Teaching it a variable interval and a per-key
lifecycle is most of what it does — that is a fork wearing a shared name.

**The poller must never hold a limiter slot between ticks.** It gets that for
free by calling the getters, which take a slot around the call; an edit that
wrapped a whole tick in `sleeperLimiter.run` would park one of a 24-slot
process-wide budget per watched league, and the symptom would be manager syncs
queueing behind idle draft rooms.

**One thing has no answer and is written down rather than guarded.** Fan-in is
**per process**: there is no cross-process bus here, and an advisory lock would
be actively wrong, since it would let one instance's poller win while that
instance's viewers sit on the other one. The app runs one instance by
construction — the crawler's section already depends on it — and this is the
first feature whose *reader-facing* correctness does, rather than only its
efficiency. A second instance multiplies the Sleeper budget by N and wants
sticky routing by league id, not a lock.

### The board, and the picker

The board is **one console card at page width**: `CONSOLE_CARD` with
`LeaguePlate` straddling the top edge and a `ReadingPlate` carrying the next
placeholder up, so it reads as the same instrument the manager, trades and
lineup-checker cards are. Rows are **flat** on the shares drawer's budget
argument — no perspective, no `translateZ`, nothing to gate behind
`pointer-fine:` and no reason for a virtualizer, since a draft is a few dozen
rows. The pick chip is `CONSOLE_WINDOW` rather than `CONSOLE_READOUT`: inside a
housing a readout is a window, and the difference is the lit lip closing the
recess. An autopick's manager is an **em dash**, never a guessed name.

**`mt-6` on the card is clearance, not spacing.** `CardPlateRow` hangs 13px above
the card's own box, so a card standing on its own — rather than in a grid whose
gap already pays for it — puts the league plate over whatever precedes it.
Measured at 9px of overlap on the back link before it was added.

The landing page is the picker plus a raw-id form, and **the raw-id form is the
path the tool was designed for**, not a fallback: opened from a league chat,
there is an id in the URL bar and no account in hand. With no stored account it
is the whole page — idle rather than empty, since nothing is fetched.

**The combobox fixes four defects TheLabX's own design notes list as known and
unfixed**, all verified over CDP: Tab closes it; the first ArrowDown out of a
shut popup opens at index 0 rather than skipping the first league; Enter only
picks while the popup is open, so Enter after Escape cannot pick out of an
invisible list; and option ids are keyed by `league_id`, because positional ids
tell an assistive technology that row four was renamed when the list was
replaced.

### Verified

Against the live database and Sleeper on the day it landed. `migrate:up` reported
"No migrations to run", which is the claim above and why this port is code only.
The snapshot route answered a real 12-team league with 67 placeholder picks whose
labels disagree with Sleeper's own slots on every row. Six concurrent cold stream
subscribers opened **one** room; both test rooms tore down after their linger.
A nonsense id answered one `error` frame and closed; the snapshot route 404'd it;
`POST` to the stream answered 405 with `Allow: GET`. In the browser: `onopen`
then a `board` frame, a heartbeat at 20s, and no further frames on a complete
draft. Over CDP at 1280 and 390 in both schemes — one `<h1>` per page, the rack's
key lit on `/picktracker` *and* `/picktracker/<id>`, `documentElement.scrollWidth
=== 390` at phone width, 113 leagues in the picker with `aria-activedescendant`
naming a real option id.

### Deliberately not ported

TheLabX's board is a plain table with a manual Refresh button and no live half at
all; the refresh key is kept here for the reason its own Sync key argues, that a
reader of a live tool presses things when they doubt them, and because it is the
only control that works where a proxy buffers the stream. Its capacity caps, an
operator kill switch and a snapshot cache in front of the registry are all
designs this does not carry: the ref-count already bounds pollers by actual
readers, and each of those arrives with a second instance or a load problem to
size it against.

## Who has visited

`/logs` is every request this app has recorded, narrowed three ways, over a
window the reader picks. Nothing here recorded a visit before it: there was no
middleware, no analytics and no table. TheLab2026's feature ported — same
question, one facet fewer — with the three things that had to change written
down below, each because this app is not that one.

**It needed a migration, and only one table.**
`db/migrations/1788000000004_create_visitor_logs.sql` is `(id, seen_at, ip,
route)` — it had a fifth column, `viewer`, dropped by
`1788000000005_drop_visitor_log_viewer.sql`; see The viewer column, and why it
went — plus one index on `(seen_at DESC, id DESC)`, which is the window
predicate and the newest-first ordering in one read. The ported original has no
index at all on a table it full-scans forever, and no primary key; **the identity
column here is this repo's first synthetic key** and earns one where the other
ten tables have natural ones — a visit has no identity of its own, the same
address may hit the same route twice in a millisecond, and those are two facts.
The read is capped, and a cap over `seen_at` alone splits a tie arbitrarily.

**The route is stored whole and everything about it is derived at read time.**
Which tool, whose page, which league — all of it comes out of the path in
`features/logs/helpers/derive-visit.ts`, so a seventh tool is a line in a pure
helper rather than a migration. **Everything the page shows is now derived that
way**, which is what dropping the fifth column left behind: a visit is its
timestamp, its address and its path, and every reading of it is a pure function
of the path.

### The viewer column, and why it went

The table shipped with a `viewer` beside `route`, on the argument that they are
two questions one column cannot answer: `route` says who was being looked *at*
and `viewer` said who was *looking*, which on `/manager/jkap86` are two
different people whenever anybody looks somebody else up. That argument is
still true. What was false is that the column answered the second half.

**It held the last account the browser had looked up, not the person looking.**
The cookie behind it (`thelab_viewer`, mirrored out of `localStorage` by
`storeAccount`, which the proxy cannot read) was written by exactly one caller:
the lookup form on `/tools`. That form is also the only way to reach somebody
else's manager page, because the Manager card resolves to
`/manager/<stored account>` — so looking a second person up *rewrote the value*,
and a reader checking five managers finished the session declaring themselves
the fifth, with every visit before each change attributed to whoever preceded
it. Nothing authenticated it either; it was a claim by the browser.

So the question went rather than the answer being patched. A column that names
the wrong person is worse than one that names nobody, in the sense this repo
uses about a `DEFAULT now()` on a row nothing has read: both are claims the data
cannot support, and an undercount has exactly one true reading where a
misattribution has none. **Every column left is either stamped by the request or
read out of the path**, and the three readouts above the table count the same
way — visits, addresses, subjects, none of them claiming to be a count of
people.

**What would bring it back is an identity this app does not have.** Sleeper
publishes no OAuth and there are no accounts here, so a real viewer needs
something this app cannot get. The cheap thing that answers what the column was standing
in for — "is this the same visitor again" — is a random browser id cookie, which
never names anybody; it is the first thing to add if the log ever has to count
people rather than requests. **A user-agent column is still the first thing to
add if it reads as noise**, and neither is here.

The cookie itself outlives the column on every browser that ever resolved an
account, with a year on its max-age and now no reader, so `storeAccount` expires
it — the same path that wrote it, and deletable once those browsers have turned
over. Removing it does not reopen the argument `theme.ts` settles against
cookies: **that** one is about reading a cookie *in the root layout*, which opts
the app out of static prerendering. The proxy runs per request regardless, so
`/tools` was prerendered throughout and still is.

**`ip` is nullable, and the sentinel it replaces is the bug worth naming.** The
original declares it `INET NOT NULL` and writes the literal strings
`"Unknown IP"` / `"Invalid IP"` into it whenever its sanitizer refuses a value —
which its own IPv4 pattern (`\d{1,3}` four times) does for anything it lets
through in range, since `999.999.999.999` passes the regex and then fails the
cast. Neither string is castable to `INET`, the insert is fire-and-forget, and
so the row is dropped with nothing said. `shared/logs/client-ip.ts` answers
**null** instead, and its patterns are the stricter ones — an address we cannot
read is absent, not a sentinel, and absent is not zero.

### The proxy, and the one thing it cannot see

**It is `proxy.ts`, not `middleware.ts`.** Next 16 deprecated that convention and
renamed it; the export is `proxy` and it sits beside `app/`. The consequence that
matters is that **Proxy now defaults to the Node.js runtime**, so it reaches
Postgres directly. The original cannot: its middleware is on Edge, where `pg`
does not exist, so it fires an HTTP request at its own hardcoded public hostname
and an API route does the insert — one extra inbound request per page view,
through an axios instance carrying three retries, so a failing log endpoint costs
four requests a view. That hop, that hostname and those retries are all gone, and
**the pool is genuinely shared rather than a second one**: `next-server.js` loads
the proxy with a plain `require()` in-process, `pg` is externalized by
`next.config.ts`, and the built bundle carries `globalThis.pgPool ??= …` — which
is exactly what `db/pool.ts` caches it on `globalThis` for. The insert rides
`event.waitUntil`, which the Proxy docs name for this ("background work like
logging or analytics"), so the response is not held and the write is not cut off.
There is also no write *endpoint*: the proxy is the only writer, where the
original's `/api/common/logs/update` is open to anyone who wants to fill the
table.

**A row means "a browser asked for this page as a page", and that is a decision
made by measuring rather than by reasoning.** The App Router issues two kinds of
request that are not a page view: a *prefetch*, fired for every `<Link>` in the
viewport the moment a page loads, and the *soft navigation* after a click. **In
Next 16 the proxy cannot tell them apart.** Verified against a production build
driving a real browser: the prefetch of `/trades` and the click through to
`/trades` arrived with the same URL, the same eighteen header names, and the same
value for every one — `RSC` and `Next-Router-Prefetch` do reach the server, but
Next consumes them into request metadata and strips them before the proxy runs,
and the `.rsc` pathname suffix they can arrive as is normalised away too.

So the choice was never "log navigations but not prefetches"; it was between
logging both and logging neither. Logging both is worse by a distance — one load
of `/tools` produced **six** rows, two of them for `/trades` and one for
`/comps`, a page nobody had opened. A log reporting visits to pages nobody
visited has no reading that is true, where one that undercounts has exactly one.
`isPageView` therefore takes document requests only: a hard load, a new tab, a
bookmark, a pasted link, a refresh. In-app clicks between tools are not recorded
and mostly could not be — a prefetched route is served from the router cache, so
the click that follows often makes no request at all. The two conditions cover
each other: `next-url` is the App Router's own marker and catches a stray RSC
request with no fetch metadata, and `sec-fetch-dest` is browser-set and cannot be
forged, with its *absence* read as a page view so a crawler or a curl still
counts.

**The matcher is a positive list and cannot be generated from
`constants/tools.ts`**, however much it looks like it should be: Next requires
matcher values to be static constants so they can be analysed at build time. A
seventh tool is a line in both places. A negative pattern would avoid that and
pay for it by logging `_next` chunks, images, every API call — and `/logs`
itself, which this list excludes by not naming it.

### Reading it back

**A failed token is a 404, not a 401**, on both the page and `/api/logs`. The
protection is that the page does not appear to exist, and a 401 confirms that it
does — the only thing somebody guessing paths wants to learn. `logsAccess` is
pure with the environment as an argument, in `db/config.ts`'s shape, and makes
that file's split for its reason: an unset `LOGS_TOKEN` is **denied in production
and allowed in development**, because a checkout with no `.env` should still
render its pages and a deployment that forgot the variable must not publish
everyone's address. The original gates neither its page nor its API and relies on
not being linked to, which is not a gate. The cost taken here is that the token
rides the query string and therefore browser history: a cookie would need a route
handler to set it, since a server component cannot.

**The whole window is fetched and narrowed in the browser**, deliberately — every
facet menu is a cross-tab over the rows in hand, so answering them on the server
would be an aggregate per press. The read is capped at `VISITOR_LOG_CAP` and the
payload says whether the cap bit, because a trimmed month presented as the whole
month is a claim; the original has no `LIMIT` at all.

**One behaviour is deliberately reversed.** The original builds all five of its
menus (this has three) from the *fully filtered* list, so choosing an IP leaves that IP as the
only option in the IP menu: the selection can be cleared but never changed, and
the same goes for every facet in turn. That is exactly the failure `facetsQuery`
already names for the trades board — count the menus **without** the selection —
and `facetOptions` is that rule applied to a list held in the browser: each
facet's options come from the rows filtered by every *other* facet. A selected
value is kept even when nothing else matches it, so a `<select>` can never show a
value its own options do not contain.

**The Subject column is dropped below `sm`, and the table takes no minimum
width.** Five columns in 390px is 78px each, and the alternative — a minimum
width scrolling inside its own container — does not hold: measured at 390,
`documentElement.scrollWidth` went to 492 and the whole page scrolled sideways.
Subject is the column to lose because it is the only *derived* one — the route
printed under the tool already contains it — so dropping it removes a reading
rather than a fact, which is the console card's own rule for the plates that drop
the points rank and the year at that breakpoint. The clock is pinned to 24 hours
for the same width: a meridiem is a fifth token in a third of 390px and wrapped
onto a line of its own.

**Losing the Viewer column did not buy Subject a place back**, and that was
measured rather than assumed: shown at 390 the four columns are 79px each, the
same width the five-column layout gave its four visible ones, so the phone table
would be exactly as cramped as the arrangement the rule above already rejects.
Dropped, the three left are 105px. The width goes to the columns that survived.

### Verified

Run against the live database and a **production build**, since prefetching is
disabled under `next dev` and the central decision above is invisible there.
`migrate:up` applied the one migration, `migrate:down -- 1 --dry-run` printed the
mirror, and the round trip down-and-up left the table and its index as declared.

Four matched routes logged four rows with the address taken from the *head* of
`x-forwarded-for` rather than the proxy hop. `::ffff:198.51.100.7` stored as
`198.51.100.7`, and `999.999.999.999` stored as **null** rather than losing the
row. The viewer chain was driven end to end through the real lookup form rather
than a planted cookie, and is what the removal below undid: `/tools` before
resolving an account logged `viewer` null, `storeAccount` wrote
`thelab_viewer=jkap86`, and `/trades` after it logged `jkap86`. That last step is
the behaviour that was correct and the reading that was not — see The viewer
column, and why it went.

The prefetch finding is the one worth repeating: before `isPageView`, one browser
load of `/tools` wrote six rows including `/comps`; after it, one. `/logs` logged
itself zero times.

The gate: `/logs` 404s with no key and with a wrong key and answers 200 with the
right one; `/api/logs` does the same on `x-logs-key`; `?hours=abc` and
`?hours=99999` are 400s carrying `ApiErrorPayload`. The three windows returned
9 / 10 / 11 visits over the same seeded rows.

Over CDP at 1280 and 390 in both schemes — **and the theme has to be driven by
`data-theme`, not by `prefers-color-scheme`**, which this app ignores; emulating
the media feature produces two identical dark screenshots. Exactly one `<h1>`,
one `role="status"`, every control labelled, `documentElement.scrollWidth === 390`
at phone width with zero overflowing elements, and no cell colliding with the one
beside it (`lineupchecker` in a `table-fixed` column was the case that found
that). The facet rule was driven in the browser: with `203.0.113.5` chosen the
rows fell 11 → 2 and the Subject menu to `jkap86` alone, while the Address menu
still offered all five — and switching straight to `198.51.100.7` worked without
clearing first, which is the move the original cannot make.

**The removal was verified separately**, against a throwaway Postgres 16 cluster
and a production build, since the live database was not reachable from where it
was done. `migrate:up` applied `1788000000005` and left
`(id, seen_at, ip, route)` with the index intact; `migrate:down -- 1` brought the
column back empty and `up` dropped it again, which is the round trip that keeps
that path honest. The proxy still records — a document request with an
`x-forwarded-for` head *and* a planted `thelab_viewer` cookie wrote a row
carrying the address and nothing else — and `/api/logs` ships no `viewer` key.
The legacy cookie's expiry was driven through the real lookup form with the
cookie planted first: one resolve and the browser holds no cookies at all. Over
CDP at 1280 and 390 in both schemes, four column headers, three readouts, three
facet menus, one `<h1>`, one `role="status"`, no element past the viewport and
`documentElement.scrollWidth === 390`, with the word "viewer" absent from the
rendered page. 1,027 unit tests pass, and `lint`, `typecheck` and `build` are
clean.

### Deliberately not ported

- **The open write endpoint.** `/api/common/logs/update` accepts any `ip` and
  `route` from anyone, over both GET and POST. The proxy is the only writer here,
  so there is nothing to call.
- **A user-agent column, and therefore bot filtering.** Neither app has one; this
  is named because the absence is what makes "a visit" a request rather than a
  person, and it is the first thing to add if the log ever reads as noise.
- **Retention.** Rows are kept, which is what the index is for. A pruning loop
  would hook into `instrumentation.ts` beside the other three with a `LOCK_KEYS`
  entry — `[8675309, 4]` is free.
- **The original's combobox filters and its `Tab` facet.** The tab exists because
  its manager page is `/manager/<user>/<tab>`; every page here keeps its state in
  the client, so that menu would always be empty. Native `<select>`s carry the
  keyboard behaviour and a platform list on a phone, and the Search field covers
  what a typeahead would.

## The app rack

The app had no navigation. `/tools` was the only way to another tool and a
typed URL was the only way back, so the rack is the one genuinely new object in
this pass rather than a restyling of an old one: a floating housing carrying
the wordmark, the tool navigation, a season readout and the theme key. Applied
from a design handoff scoped to `/manager/[username]`; five things about it are
structural rather than cosmetic. **The tool links have since become one key that
opens a menu** — see The track became a menu below — and **the rack has since
been pinned and taken the manager page's Browse and View controls**, which
retired the season readout; see The rack is pinned below. The five still hold,
with the readout one now reading as the shape the controls context took.

**It lives in `features/tools`, not `features/shared`.** Everything it is made
of is that folder's own — the tool registry, `toolHref`, the flask mark, the
engraved wordmark treatment — and `features/tools` may read `features/shared`
where the reverse would invert the layering. Mounting it in `layout.tsx` is
`app/` reaching for a feature, which is the direction routes already import in.
The alternative was moving the registry into `features/shared` on the rule that
moved `CONSOLE_KEY` and `ManagerPlate` there; it was not worth three files of
churn to avoid a dependency that already points the legal way.

**It renders no `<h1>`.** The wordmark here is two `<span>`s, where
`LabWordmark` engraves the same string around a heading. A rack on every page
would otherwise put a second `<h1>` above each page's own — the manager name,
the tools headline — and the pages are right. `base` (the tool's own href) is
what lights a key, not the resolved `href`: Manager points at
`/manager/<username>` once an account is stored, and matching on that would
leave the rack unlit on somebody else's page.

**Below `md` the brand row becomes `display: contents`.** The rack was two
stacked objects at a phone's width — a brand pill, then the nav track — and one
row above it. Rather than render two trees, the wrapper's box stops existing at
`md`, its children join the rack's flex container directly, and `order` puts
them back in the wide layout's reading order. That is also why the pill chrome
is on the rack above `md` and on the row below it: there is only ever one box
painting it. The stacking is what the menu removed — one key fits in the brand
row where six never did — but the mechanism is unchanged and still carries the
menu, the theme key and the readout into their wide-layout order.

**The season readout was published by the page, not read by the rack** — and
the *pill* is gone while the mechanism it established is what the controls now
ride on. It named whose page this was, which is manager data in app-level
chrome, and three answers were possible with only one of them true: the stored
account names whoever last logged in, which is the wrong person on
`/manager/someone-else`; the URL names the right person but not the season,
which is resolved on the server and arrives on the leagues stream. So a provider
wraps both in `layout.tsx`, `LeaguesHome` publishes into it, and **a page that
publishes nothing gets nothing** — which is what "only where a manager is
resolved" has to mean. Read and write are two contexts so a publisher takes only
the stable setter; the publish is an effect, because it writes to an ancestor's
state, and its cleanup is the half that matters: without it, walking from a
manager page to `/trades` leaves the old page's controls in the rack, wired to a
component that has unmounted.

**There is now exactly one theme control, in the rack.** `ThemeToggle` was
removed from `tools-home`, `leagues-home`, `trades-home` and
`lineup-checker-home`; it gained an optional `labelClassName`, which renders
the name of the theme a press switches *to* beside the glyph. That word is
`aria-hidden` rather than being the button's name — each face already carries a
full sentence, and a visible "Light" would only prepend a redundant token.

### The track became a menu

The six-key horizontal track is one key that names the page you are on and opens
a menu of the rest — `tools-menu.tsx`, a sibling of `app-rack.tsx` and out of the
barrel on the folder rule. Two reasons, and the second is what made it worth
doing: the rack's width grew with the registry, which `constants/tools.ts` is
documented as sizing for eight to ten entries, and below `md` the track was
already an `overflow-x-auto` row, so everything past Trades was reachable only by
a horizontal swipe nobody would guess at. **One key costs the same width at six
tools as at ten.**

**The key names the page you are on rather than saying "Tools."** That is the
only thing the old track said besides its list — the lit key *was* the "you are
here" — and a menu that dropped it would be a nav that reports nothing. The
menu repeats it: the current entry is drawn raised and lit, with an accent lamp
beside it, for the moment the open menu covers the key it came from.

**The tools page carries neither the menu nor the groove.** Its grid *is* the
tool list, and a menu of the same six names directly above it is a second copy
of the page's own content — the same argument that took the wordmark plate off
that page, where the rack already engraves "The Lab". The groove goes with the
menu, since a separator with nothing on its far side is a rule. The one thing
that has to move for it is the theme key's auto-margin: above `md` the readout's
own `ml-auto` normally takes the row's slack, and the tools page has no menu
*and* publishes no readout, so there the key takes it itself (`md:ml-auto`
against `md:ml-0` everywhere else). The visible cost is that `/tools` is now the
one route with no `aria-current="page"` and no `<nav>` at all — correct, since
the page is the list rather than a page beside it.

**It is not a `<dialog>`, where the league filters and the columns picker both
are.** Those are modal; a nav menu that trapped focus and dimmed the page to
offer six links would be heavier than the links are worth. So the dismissal a
`<dialog>` gives for free is spelled out: a **capture-phase `pointerdown`**, so
a press that starts outside dismisses before whatever it landed on acts on it,
and Escape, which returns focus to the key it came from — the one piece of that
behaviour that is not optional. Closing on a menu item's click is not redundant
with the route change either: the current page's own entry navigates nowhere, so
nothing else would dismiss it.

**Below `md` the menu rides in the brand row beside the wordmark**, which is what
removes the second stacked row a phone used to get. Measured at 390 that row
fits exactly, with no slack: flask, wordmark, the longest tool name
("Lineup Checker") and the icon-only theme key come to the full content width,
and the open menu's right edge lands on the viewport's. **Below 390 it
overflows** — at 375 the theme key spills past the rack pill's cap by 8px — which
is a width this repo has never verified at (the bar is 1280 and 390 in both
schemes) and which the page already overflowed at 360 for its own reasons before
this landed. If it ever needs to hold, the cheap fix is dropping the wordmark's
*text* below 390 and keeping the flask, on the theme key's own precedent that
the legend is the first thing to go — with an `sr-only` name left on the link.

#### Verified

Against a throwaway Postgres 16 cluster and a production build, over CDP at 1280
and 390 in both schemes. `/tools` renders no `<nav>`, no menu trigger and no
groove, one `sr-only` `<h1>` measuring 1x1, and the theme key pinned right on an
otherwise empty rack row; the panel's lookup sits at the row's left where
`ml-auto` used to hold it right. On the other routes the key names the page
("Lineup Checker", "Trades", "Manager"), the menu lists all six with `toolHref`'s
resolved targets, and exactly one entry carries `aria-current="page"` — the
resolved-vs-`base` rule intact, since `/manager/jkap86` lights Manager. Escape
closes it and returns focus to the key with `aria-expanded` back to `false`; an
outside `pointerdown` closes it; reopening works. `document.documentElement.scrollWidth`
equals the viewport at 1280 and 390 with the menu open, and the four-instrument
row (brand, groove, menu, readout + theme key) is unmoved at 1280.

### The ground, and why it is per-route

`ConsoleGround` is the bevelled surface run to the viewport edges. The leagues
page used to draw it as a rounded, bordered panel inside its own shell with
`--background` showing around it; with the rack floating above, a second
bounded rectangle inside the viewport reads as a panel inside a panel.

It is **fixed and viewport-sized**, not painted onto the page's box:
`--panel-bg` is a radial gradient anchored at `50% -20%` of whatever box
carries it, so a document-sized box stretches that glow over a hundred-league
page until it is no longer light falling on a console. And it is `-z-10`, which
is what lets a *route* opt in — the element is out of flow and behind every
positioned sibling, so a page can render it and still have it sit under the
rack that `layout.tsx` mounted above that page.

**Rendering it from `layout.tsx` was tried first and reverted**, which is the
part worth keeping. App-wide, it put the tools, trades and lineup-checker
panels — which still draw their own — on a second panel, the exact doubling it
exists to remove, on three pages this bundle does not design. The handoff
offers both placements ("the page-level wrapper in `layout.tsx`, or the route's
own outer element"); the route's own is the one that delivers the manager page
as designed and leaves the other three untouched. `PageShell` keeps `max-w-6xl`
and governs content width only now, plus the padding that used to belong to the
panel.

### The View housing

**It has since moved into the rack, with the Browse housing beside it — see The
rack is pinned below.** What follows is the housing it was, and the two rules
that survived the move: the dialogs still hide their own state, so something
still has to say what the grid has been narrowed to, and the trigger's *shape*
is still the caller's.

The trim rule with three bordered buttons hanging off it is gone. `ViewHousing`
in `leagues-home.tsx` is the third instrument on the header row: the two dialog
triggers stacked over a readout of what they have left. The accent sentence
that used to sit above the rule (`{summary} · n of m`) is that readout's two
lines — both dialogs hide their own state, so something on the page has to say
what the grid has been narrowed to.

`items-stretch` on the header, not `items-center`, is what makes the row read
as one rack: three instruments of one height rather than three objects on a
midline. `mt-auto` on the readout is what makes the heights *agree* — the
housing stretches to the tallest instrument beside it and the readout takes up
the slack, rather than leaving a gap under the keys. At a phone's width the
three stack and the housing's own contents go on one line, dropping the summary
line: the figure is the half that cannot be got anywhere else.

### The dialogs, and the key-shape rule

Both dialogs, the filter rails, the rule bays and rows, and the expanded card's
control strip moved onto the console vocabulary. Behaviour is untouched
throughout — the draft-and-Apply semantics, the cross-tab counts, the
live-write columns, the disable-rather-than-refuse bounds, the sentinel key,
the text-only-while-editing number. Only the surfaces moved.

**A key's shape and a key's colour had to be split, and the reason is a
Tailwind trap.** `CONSOLE_KEY` names `border-foreground/10`; appending
`border-active/45` for a lit state is a coin flip, because both utilities have
the same specificity and which wins is decided by the order Tailwind emitted
them, not by their order in the class attribute. So `CONSOLE_KEY_PILL` and
`CONSOLE_KEY_BLOCK` carry geometry and travel with **no colour of their own**,
and `CONSOLE_KEY` is the pill plus the unlit colours. A caller composes
`shape + state` and cannot lose the flip. `LeagueFiltersDialog` and
`LineupColumnsDialog` take a `triggerClassName` for exactly this: the trades
board stands the trigger in a row of pill keys and the manager page stacks it
in the View housing as a slab, while the two *states* stay in the dialog, since
only it knows which is true.

The other two constants are recesses, and they are two because they hold
different things. `--track-shadow` is the tight channel a *single* key travels
in — the nav track, the lens toggle, the metric picker — cut deep so the key
reads proud of it. `--well-shadow` is the shallow tray a *panel* of controls
sits in — the filter rails, the rule bays, a rule's own slots — which at the
same depth would read as a hole rather than a surface.

Three smaller decisions in the dialogs:

- **A rule's two menus are recessed slots and its number is lit glass.** The
  value is what the rule is about and everything beside it only selects it; a
  reader scanning three bays for the rule that emptied their list is looking
  for numbers, and the numbers are the only things that glow. `text-[16px]`
  stays on the input — anything smaller makes iOS Safari zoom on focus — and
  steps down only above `@md`.
- **The filters panel gained a title bar.** It relied on `aria-label` alone;
  the bar makes it legible as an instrument and gives Esc a visible home, an
  affordance that was always there with nothing on screen saying so. The
  `aria-label` stays.
- **The columns dialog's checkbox is an indicator lamp with a real `<input>`
  underneath**, visually hidden and drawn from `peer-checked`, so the keyboard
  behaviour, the label association and the disabled semantics stay the
  browser's rather than being re-implemented on a `role="checkbox"`.

**One value was taken against the handoff.** It specifies a selected rail
chip's trailing count at `color-mix(var(--readout-text) 75%)` and, in the next
sentence, says to keep the full-opacity-accent rule. Those contradict — in
light mode `--readout-text` *is* the teal — so the count is drawn at full
opacity and held apart by size alone, which is what the rest of the app does.

### The chrome gradient

`--chrome-face` had a hard band at `#8fb3b6 46%` -> `#4d7175 53%`. Across a
1.75rem glyph that 7% is a crisp dark line through the middle of every
letterform, and the league titles, the manager name and the wordmark all read
as struck through. The band is lifted to 50% and widened either side, in both
themes; nothing else about the engraving changed, and one token edit fixes all
three places because they all name it.

### Verified, and still open

Checked at 1280 and 390 in both schemes against the live database, with headless
Chrome over CDP: the rack, the ground, the View housing, the rank ramp, both
dialogs and the expanded card's strip. The DOM checks that matter also hold —
exactly one `<h1>` per page (the rack's wordmark is spans), one
`aria-current="page"` matching the route, one `<nav>`, one theme control — the
first three re-checked after the menu landed, with `/tools` the deliberate
exception on the last two.

Two things are deliberately left. **`/picktracker` and `/comps` are in the rack
and are 404s**, because they are in `constants/tools.ts` and the handoff names
that list as the rack's source; the tool grid has always linked to them the same
way, so the rack is not a new claim. And **the tools, trades and lineup-checker
pages still draw their own panel** on `--background` rather than on the ground —
they are unchanged apart from losing their theme key, and giving them the
full-bleed treatment is a redesign of three pages this bundle does not cover.
**`/lineupchecker` has since taken the ground**, which cost it no redesign at
all: it was already the leagues console's plate and cards on a panel of its
own, so the panel was the only thing between it and `/manager`. See Checking a
week's lineup.

### The rack is pinned, and it carries the page's controls

The rack floated in flow at `mt-6` and scrolled away. It is `fixed` at `top-6`
now — the same 24px gap, measured against the viewport instead of against
whatever preceded it — and it has taken the manager page's **Browse** and
**View** housings as two tracks of keys. Applied from a design handoff off its
option 2a, in the order that handoff sets out.

**Pinning is the whole reason the controls could move up there.** On a
hundred-league page the header scrolls away after two cards, so a Filters key
in the header is a key you scroll back for; in a pinned rack it is reachable at
any scroll depth. The cost is the one the pill paid for it: the lit account
readout — the manager's name and season — is gone, because the identity plate
below now names both and the pill was a second answer to a question already
answered. Its ~185px is exactly what the two tracks needed.

**The rack is out of flow, so the shell's top padding is the only thing holding
a page clear of it, and that is one number rather than two.** `--rack-clear` in
`globals.css`, read by `PageShell` as `pt-[var(--rack-clear)]`. The rack's
height and the shell's clearance are one fact, and two spellings of it drift the
first time a key's padding changes — the symptom being a rack sitting on a
page's first row. Measured rather than guessed, at each of the rack's three
heights: 52.5px below `md` (a 36px bezel in 6px of padding, plus its border) and
62px at `md` and up (a 44px bezel in 8px), which is the height the handoff
predicted to the pixel. The token is `24 + rack + gap` at each: 100px, 120px at
`sm` where the shell used to open on `pt-11`, and 114px at `md` where the gap is
the design's own 28.

**Every shell arm takes the clearance, not just `console`.** The handoff says
only the console pages render a rack-clearing layout; they are not, because the
rack renders above *every* route and `/tools` is on `wide`. Without it the tool
grid's first row sat under the rack. Only the bottom padding and the gutters are
each arm's own now. `ConsoleGround` needs nothing either way, being already
fixed and viewport-sized.

**The rack gained a third shadow, and it is a token.** `--rack-cast`: content
passes *under* a pinned rack, and a housing with no cast shadow reads as printed
on the page rather than standing over it. Written as a token for the reason
`globals.css` gives about every other one — the dark ground's `#000` at 40px
smears on the light one, which takes a slate tint instead.

**The controls reach the rack through a published context, and that is the real
cost of putting them there.** The rack is mounted in `layout.tsx` above
`{children}`, so it cannot see the page's state — and all four keys are
page-specific. `RackReadoutProvider` was already the right shape, so it was
extended rather than deleted: it is `RackControlsProvider` now, carrying
`{ filters, onFilters, leagues, columns, board, ktc, drawer, onOpenDrawer }`,
and a page that publishes nothing renders no controls, the rule the tools menu
already lives by. The state stays on the page, where the drawers, the two
predicates and the lineups gate all read it.

**Every field is a dependency of the publishing effect, and that is
load-bearing.** The object handed to `usePublishRackControls` is new on every
render, so an effect depending on the *object* would run on every render, set an
ancestor's state, re-render the page and run again — an unbounded loop rather
than a stale value. Depending on the fields means the effect fires only when one
of them moves, which puts a requirement on the caller: `onOpenDrawer` is a
`useCallback` in `LeaguesHome` for exactly this reason, and everything else it
passes is a primitive or a piece of state. A future caller that rebuilds a
nested object literal each render gets the loop, which is why the hook says so.

**`LineupColumnsDialog` moved to `features/shared`, and `LINEUP_METRIC_LABELS`
with it.** The rack lives in `features/tools`, and a rack reaching into
`features/manager` for a picker would be one sibling feature importing another;
the sibling it may read is `shared`. It is the line `CONSOLE_KEY`,
`ManagerPlate`, `LeagueFiltersDialog` and `LeagueConfigWindow` all moved on — a
second reader. The labels landed in `lineup-columns.ts` beside `METRIC_ORDER`,
which they are the other exhaustive `Record<LineupMetricId, …>` of: the same
compiler seam, twice.

**Two of these four keys have since come back down onto the page** — see The
controls came back down onto the plate, below; what the rack still carries is
the Browse pair, and the paragraphs here describe the four-key row they were
measured as.

**Below `lg` the four keys collapse behind one icon-only key that opens a
menu.** That is the question the handoff leaves open and asks be decided before
shipping, and it is decided the way this folder decided it once already:
`ToolsMenu` replaced a six-key track with one key and a menu because the track
did not fit. Four control keys are ~470px in a 362px pill, so the same answer
applies, and the key is icon-only for the theme key's reason — the legend is the
first thing to go. The two alternatives were a second stacked row, which is what
the rack was rewritten to remove and which costs ~112px of an 844px screen
*permanently* once pinned, and leaving the controls on the page at narrow
widths, which would mount both dialogs twice.

**The breakpoint is `lg`, not the `md` the rest of the rack turns on, and it was
measured.** With the tracks in, the rack's row is ~900px of content: at `md`
(768px) it wrapped to a second line, 114px of pinned rack with the page's first
row underneath it. So the tracks wait for `lg` while everything else still
switches at `md`, and the rack is one row at every width — which is a constraint
rather than an observation, since it is what keeps `--rack-clear` to three
values instead of five.

**The same two tracks serve both layouts and nothing is rendered twice.** The
menu panel is `display: contents` at `lg`, so its box stops existing and the
tracks join the rack's flex row under their own `order` — the trick the brand
row already turns. A filter set from the menu on a phone is therefore the same
dialog instance as one set from the rack on a desktop. The menu is not a
`<dialog>`, for `ToolsMenu`'s reason, so its dismissal is spelled out: a
capture-phase `pointerdown` and an Escape that returns focus to the key.

**And the menu must not dismiss on the press that opens one of its own two
dialogs**, which is the rule it shipped without and the one whose failure
nobody can see. Both dialogs are mounted *inside* the menu, and a modal
`<dialog>` is in the top layer only for as long as it still generates a box: a
blanket `onClick` that hid the panel took the modal off screen with it, so
pressing Filters or Columns produced a backdrop over an inert page with nothing
on it — a key that reads as dead. Above `lg` the panel is `display: contents`
and there is no menu to close, so it was invisible on a desktop and broken at
**every width under 1024px**, which is a laptop window as readily as a phone.
The two Browse keys still dismiss on the press, because a shares drawer is the
*page's* dialog and nowhere near this box; the two that are mounted here close
the menu when *they* close, through a capture-phase `close` listener on the
menu's own root. `close` does not bubble, but the capture phase runs on every
ancestor regardless — which is what lets the menu hear its own dialogs without
either of them growing a callback for it. Escape is deferred to the same path
whenever a `dialog[open]` is inside the menu, or the panel would be hidden on
the very keystroke that closes the dialog inside it.

#### The header became one plate

`ManagerPlate` and `SeasonSummary` merged. The plate carries the avatar bezel,
the groove, the eyebrow and the engraved name as before, and then — through a
new optional `children` — the season's two figures and the win-rate dial on the
same engraving. **The presence of children is what switches the box**: a plate
carrying a season runs the shell's width and wraps below `sm`, and a plate
carrying only a name stays `inline-flex`. That is because `ManagerPlate` is
shared with the lineup checker, which draws it with no season and stands an
attention housing to its right; editing the box in place would have moved that
page's header without anyone asking.

What went with the merge: the Games line (`182 games · no ties`) came off the
plate — `summary.games` is still the win rate's denominator, it is just not a
reading of its own — and the dial stepped down from 112px to 88px, because it
now shares a plate with a 2rem engraved name rather than standing beside one.

**`seasonSummary()` is fed the filtered list, which reverses its own doc
comment.** It was the unfiltered one while the summary stood beside the plate
describing the account, and the *filtered* count had a home in the View
housing's `{matched} / {total}` readout. The merge took both away, so the one
set of figures on the page has to answer the question the reader is actually
asking — a reader narrowed to dynasty wants their dynasty record, the same
argument the shares drawers already count by.

**The unfiltered total lives in the Leagues figure, and only while it means
something.** That is the handoff's own open question and its cheapest answer:
the field reads `14` unfiltered and `9 / 14` while a narrowing is in force. Left
as one number on a filtered page, "Leagues 9" reads as the whole account to
anyone who did not set the filter; carried always, the denominator is noise in
the common case. **`filterSummary(filters)` lands under the plate**, in accent,
which is the line `lineup-checker-home.tsx` already draws under its own plate —
a pinned rack has no room for a sentence of prose, and the subject selection
still has the token tray below it.

**The `Win rate` caption drops below `sm`.** The whole season block has to fit a
332px plate at 390 and the caption is ~46px of it, while the lit window inside
the dial already reads `WIN 50.0%` — it is the one thing in the block that says
something twice. Measured after: 311px against 332, and no horizontal page
overflow.

#### Verified

Rendered through a temporary `/preview` route against the real components,
tokens and Tailwind build — the method the console-card and shares passes
established, since no database is reachable from where this was built — then
screenshotted over CDP at 1280 and 390 in both schemes and deleted. Two things
about that method are worth writing down: **Chrome must be launched with
`--no-proxy-server`** or the agent proxy swallows the dev chunks, and the page
must be opened on **`http://localhost:3000`, not `127.0.0.1`** — `next dev`
answers 403 to the other origin's chunk requests, and the page then serves 200,
renders its SSR markup and never hydrates. Both failures look identical from the
outside: a correct-looking page whose buttons do nothing.

What the renders turned up is the three changes above — the `lg` breakpoint, the
clearance on every shell arm, and the dropped caption. What holds after them:
the rack is one row at 390, 640, 768, 900 and 1280, and `contentTop` is exactly
`rackBottom + 28` at `md` and up on `/manager`, `/tools`, `/trades`,
`/lineupchecker` and `/picktracker`. `document.documentElement.scrollWidth`
equals the viewport at 390 and 1280. In the DOM: one `<h1>`, one `<nav>`, and
**two** `<dialog>`s — one instance each, which is the `display: contents` claim
end to end. At 1280 the panel computes `display: contents`, its two tracks carry
`order: 4` and `5`, and the collapse key is `display: none`; at 390 the key is
`inline-flex`, `aria-expanded` toggles, the panel opens inside the viewport
(65–312 of 390), Escape closes it and returns focus to the key, and an outside
`pointerdown` closes it. Filtered, the plate reads `LEAGUES 1 / 3` with the
`DYNASTY` line under it and the Filters key lit carrying its badge. `/tools`
still renders no `<nav>` and no controls, with its theme key pinned right.

**Not verified against real data**, which is the gap to close first: every
number above is a fixture, and the QB/SF split's one open question — whether any
league in the corpus starts two bare `QB` slots with no `SUPER_FLEX` — needs the
database rather than a render.

### The controls came back down onto the plate

Two of the four keys the rack took are on the manager page again, and the
argument that put them up there is the one that failed. A pinned rack is
reachable at any scroll depth, which is why the two Browse keys stay — but the
**Filters** key up there and the plate's own `Leagues 9 / 14` were the same news
in two places, and neither said *what* had been narrowed. **The plate carries a
strip now** (`ManagerPlate`'s new `controls` slot): the Filters key, a `Clear`
key that appears only while something is filtering, and the summary sentence
that had been standing alone under the plate since the merge. The key, the
figure it moves and the words for it are one object.

**The strip is a full-width flex item, not a fourth column.** The plate is
already `flex w-full flex-wrap` whenever it has children, so `w-full` is the
whole mechanism, and the separator is a **milled cut read horizontally** — a
dark hairline with a light one under it — rather than `--groove`, which is the
vertical channel beside the avatar and would read as a rule turned on its side.

**The columns are a tray of chips under the plate** — **gone since**, along with
the whole component; see The finalization pass below, where the designer removed
the chips and the well went with them, a tray holding a single key reading as a
hole. What follows describes the tray it was, and the last-chip rule it records
is the one that survived it, into the dialog that already enforced the same
bound. `ColumnsStrip`, in a
`CONSOLE_WELL`: one lit chip per chosen column, pressable to remove, with the
existing `LineupColumnsDialog` as `Edit columns` at the far end. Same problem as
the subject tokens and the same answer — a closed dialog says nothing, and a
reader who chose two columns three scrolls ago had nothing on screen naming
them. **The last chip is guarded in the strip rather than in the store**, and
that is the rule most likely to be got wrong: `normalize` falls back to
`DEFAULT_LINEUP_COLUMNS` when handed an empty array, which is right for a stale
stored value and exactly wrong for this press — removing the last column would
silently restore all four defaults rather than clearing the row. The press is a
no-op instead, which is the same bound the dialog enforces by disabling its last
ticked box. Both write through `storeLineupColumns`, so a chip pressed here and
a box unticked in there are one edit under `thelab:lineup-columns`.

The dialog's trigger lost its count with the move. In the rack that figure was
the only thing on screen saying how many of the four were in use; beside a chip
per column it is the same news twice, so the key reads `Edit columns` — what it
does, rather than a second label for the tray it stands in. **The prototype's
unchosen-column chips are deliberately not shipped**: nine metrics as a
permanent strip is the picker rebuilt in the page, and the picker is one key
away.

**`RackControls` lost six fields rather than keeping them published and
unread.** The filter state and its setter, the unfiltered league list, the
column selection, the KTC market and its scrape stamp all crossed that seam for
controls that are no longer up there; a field nobody reads is a field the next
reader of either file has to prove is dead. What is left is `{ drawer,
onOpenDrawer }`. The rack key's `filtering` lit state reads `drawer !== null`
now, and the `close` listener in `rack-controls-keys.tsx` went with the dialogs
it existed for — **the rule it enforced stays written down in that file**,
because it comes straight back with any dialog mounted in that subtree: a modal
`<dialog>` is in the top layer only while it still generates a box, so hiding
the panel it lives in leaves a backdrop over an inert page. The two remaining
keys open the *page's* drawers, mounted nowhere near that box, so they dismiss
on the press. The collapse breakpoint stays `lg`: one track is ~220px less than
two and `md` may well hold it now, but what is on the other side of a wrong
guess is `--rack-clear` computed against a rack that is quietly two rows tall.

### The rank is the reading, and the denominator is the config window's

`formatRank` prints `2nd`, not `2nd of 12`. A tile takes an equal quarter of a
card, and at four columns a nine- or ten-character figure was the widest thing
on the row — read as a sentence rather than as a reading. **The maths is
untouched**: `rankFill` and `rankPercentile` both still divide by `rank.of`, so
the meter and the ramp know the field size the text no longer states, and the em
dash still covers "no answer yet" and "nothing to rank" alike. The denominator
survives in exactly one place on the card, the configuration window's `Teams`
field, where it is the scale every count beside it is read against — which is
why that field states `12` and never `12 of 12`.

**The meter is capped at 88px and the cap is on the track, not the tile.** A bar
running the whole of a quarter-card share reads as a progress bar being filled;
at one column it was a bar the width of the card. The label has to keep the full
width or `ROS starters` truncates, which is why the cap sits where it does.

**The config window's readings are three groups that wrap whole** — *what game*
(the tags), *the scale* (teams, starters) and *the lineup* (the three ladders
and the TE premium), each `inline-flex whitespace-nowrap`. Loose in the flex row
the line broke wherever it ran out of width, stranding a label on one line with
its number on the next. The two dividers stay siblings *between* the groups, so
the window's own `gap-x` spaces them and the only wrap points are the two that
exist. Measured: `scrollWidth === clientWidth` in a 330px box.

**The card's reading plate reads `Rank · Rec · Pts`** — the standing is what the
plate is read for and the record is how it was arrived at — and `PlateField`
steps up to a 17px figure under a 10px label, with `PlateDivider` following it
to 17px.

**That step-up is `sm` and up, which a render at 390 forced.** The handoff asks
for it flat and names this as the thing to re-check, and the check failed: a
plate sits opposite the league's own name in one flex row, and at phone width
the step takes a two-field plate from 155px to 182px and leaves the league name
**71px — six characters**, where `StandingPlate` already drops its third field
precisely to hold that number at nine. So the size is the question the width
answers rather than the card: below `sm` every reading plate keeps the type it
had (98px of name, restored), and at 640 the same name has 236px and the
design's own figure. It is the rule the trade card's date already lives by, one
row up — and doing it on the breakpoint rather than through the `size` prop the
handoff offers means the lineup checker's `Proj` plate and the picktracker's
`On the clock` plate are fixed at 390 too, without either of them being told.

#### Verified

Rendered through a temporary `/preview` route against the real components,
tokens and Tailwind build — the method the console-card, shares and rack passes
established, since no database is reachable from where this was built (the boot
hook skips migrations with no `DATABASE_URL` and the loops log their refusals,
which is the server coming up healthy against nothing) — then screenshotted over
CDP at 1280, 768, 390 and 360 in both schemes and deleted. The two mechanics
that method needs are unchanged: `--no-proxy-server`, and `localhost` rather
than `127.0.0.1`.

The fixtures are three leagues — a dynasty superflex with a full solve, a
keeper league whose `roster_positions` and `settings` never synced, and a
best-ball redraft — plus a bare `ReadingPlate` for each of `PlateField`'s other
two readers. Every arm landed. The tiles read `2nd`, `11th`, `1st`, `7th` and
**all twelve meters measured exactly 88px** at every width. The unsynced league
drew `—` for both counts, both ladders and the premium with no pips, and no
reading plate at all. The config window wrapped by group with
`scrollWidth === clientWidth` at 358 and at 330.

The chip strip was driven end to end: pressing `ROS bench` stored
`["ros_starters","capital_total","capital_bench"]` and moved the tile headers
and the grid with it, three more presses took it to `["ros_starters"]`, and
pressing **the last chip changed nothing** — the guard, rather than a silent
restore of the four defaults. `GRID_COLS` followed to `grid-cols-1`. The Filters
key opened a `:modal` dialog named `League filters` from the plate, applying
`Dynasty` lit the key, raised its badge, printed the summary sentence in the
strip and brought up the `Clear` key, which was absent at rest and put all three
back. The strip is one 58px row at 1280 and wraps its sentence under the keys
below it.

At every width and in both schemes: `document.documentElement.scrollWidth` equal
to the viewport at 1280, 768 and 390, one `<h1>`, and **no console output of any
kind** — no React warning about the strip or the tray. At 360 the page takes 3px
of horizontal scroll from the *rack*, which is the pre-existing sub-390 overflow
this file already records and nothing in this pass touches.

**Not verified against real data**, which is the gap to close first: every
number above is a fixture. What a render cannot check is the one thing the
denominator's removal turns on — that `Teams` is genuinely the scale a reader
reads a bare `2nd` against on a page of a hundred cards, where the field size
differs between them.

### The strip holds one row on a phone

`GRID_COLS` fell to `grid-cols-2` below `sm`, so a four-column card drew two
rows of two and the ranks pushed the card past the fold. It is one row of four
at every width now, and what made that possible was a change already in the
tree: dropping "of 12" out of the figure. An ordinal fits 75px where `2nd of 12`
needs ~86px at 16px mono, so the tile shrank to `10px 8px` of padding, the
figure went up to 21px, and at a 326px card inner width each tile measures
**exactly 75px**. Applied from a design handoff.

**The label became two lines with the height reserved on the *block*, not on
either line.** A two-line label beside a one-line label would push its own
figure down and the strip would read as four tiles at four heights; a
`min-height` on the container is what holds every ordinal on one baseline.

**Line one is the unit and line two is the scope** — `Proj pts / Starters`,
`Draft cap / Bench` — which is the grammar that makes a 9px row of four legible:
two tiles from one family read as one instrument rather than as two labels a
reader has to tell apart. On the four KeepTradeCut metrics the second line
carries the **market pair** instead (`Dyn·SF`), because which board priced a
number is the thing a reader cannot infer, and the scope is already in the
unit's own words (`KTC bench`).

**That pair is resolved, not echoed.** A column left on `Auto` still priced
against one market and one QB board, and a tile saying "Auto" would leave the
reader to work out which — so the card runs `resolveKtcFormat` and
`resolveKtcLineup`, the same two pure functions the route priced the number
with, against its own league. A second spelling of either is a label naming a
board the figure under it was not read on. `leagueType` rather than a read of
`settings.type`, on that helper's own terms.

**The denominator moved under the row rather than into the tile** — and has
since moved out of the card altogether, `Teams` in the configuration window
being the same number 40px above it; see The finalization pass below for the
judgement that removed it and for the one reading it could make that `Teams`
cannot. What follows is `RankedOf` as it stood. `Ranked of
12`, right-aligned, once — read off the ranks themselves rather than
`total_rosters`, since a metric ranks the rosters it could total; suppressed
where no column has a rank, and suppressed where the columns on screen do not
agree on a field size, because one caption over two of them would be wrong about
one. In practice every metric ranks the same stored rosters, so the disagreement
arm is a guard rather than a case — which is the point: it is the reading that
cannot quietly become false.

**One consequence worth knowing.** A column on `Auto` and a column forcing the
board that league already reads resolve to the same pair, so the two tiles print
the same label over the same rank. That is true rather than a fault — the two
columns really are reading one board there — and it is visible only on a league
whose own board is the one being forced.

#### Verified

Rendered through a temporary `/preview` route against the real components,
tokens and Tailwind build — the method the console-card, shares, rack and
timeline passes established, since no database is reachable from where this was
built — then driven over CDP at 390 and 1280 in both schemes and deleted. The
mechanics that method needs are unchanged: `--no-proxy-server`, `localhost`
rather than `127.0.0.1`, and a phone viewport from
`Emulation.setDeviceMetricsOverride`. The fixtures are two leagues — a dynasty
superflex ranked on four columns including two KeepTradeCut boards, and a
redraft league whose `roster_positions` never synced and whose entry is absent.

Every arm landed. All four tiles measured **exactly 75px** at 390 with **no
label clipped** on either line (`scrollWidth === clientWidth` on all eight), the
caption read `RANKED OF 12` under the row, and the unranked league drew four em
dashes with empty meters and no caption at all.
`document.documentElement.scrollWidth === 390` with one `<h1>` and no console
output of any kind.

The picker was driven end to end. At four columns every key is disabled and the
held ones announce their bay (`ROS starters, in bay 01`) where the rest read
`no bay free`. Clearing two bays and pressing `KTC total` **twice** opened
`Auto · Auto` and then `Auto · 1QB` — the second press is the feature, and it is
not a no-op — after which each bay's Lineup track greyed the option the other
held, in both directions. Setting bay 04 to `Dyn`/`SF` stored
`ktc_total:dynasty:sf` and the card's fourth tile came back reading `KTC /
DYN·SF` over `1st`, which is the variant rank end to end. The panel is 352px
inside a 390 viewport with **zero** elements past its own box, `:modal` true,
and the Done key reachable after the scroll the `overflow-y-auto` change exists
for (content 1,192px against a UA cap of 868). The foot read `KTC scraped ·
dynasty 6m ago · redraft 6m ago`.

**Not verified against real data**, which is the gap to close first: every
number above is a fixture. What a render cannot check is the server half — that
a forced board's four ranks actually differ from the base nine over a real
account, and what a second market read costs on the 113-league page.

### Flush, larger, and the open card freezes

Four changes finishing the manager page, from a design handoff: the rack goes
flush to the viewport's top edge, the page's type goes up ~14–16%, an open
league card's housing pins under the rack while its team browser scrolls past,
and the identity plate is halved on a phone. **No route, query, contract type or
payload field moved for any of it** — this is chrome, top to bottom.

**The rack is `top-0` and every arm of `--rack-clear` lost the same 1.5rem.** It
floated at `top-6`, which was 24px of ground above a *fixed* element — ground
the page could never use and which, once the rack stopped scrolling away, was
just a strip of nothing. The gutter either side stays, so it still reads as a
rack unit rather than a bar welded across the top. The number that had to move
with it is the shell's clearance, and it is one token for the reason its own
comment gives: measured after, the rack's top edge is at 0 and the identity
plate clears its bottom edge by **exactly 28px at `md`**, which is the gap it
had before and the design's own figure.

**The type is one multiplier and every size derived from it.** The page spelled
~20 distinct arbitrary sizes across four dozen files, so a scale bumped literal
by literal is four dozen chances to miss one — and a missed one is a label a
hair off the readout it names, with nothing on screen saying which edit it was.
`--fs-8` … `--fs-40` are `calc(<the literal it replaced> * var(--type-scale))`,
which makes the safety of it exact: at `--type-scale: 1` the page is what it was
byte for byte, so the scale lands and tunes as **one number**. It is `1.14` on
`:root` and `1.16` from `sm` up — mobile-first, the smaller figure first, the
way the rack's own three arms are already written — because the phone is tighter
on width and the plate and dial fits below `sm` were measured at `1.14`.

**Tailwind's own `text-xs`/`sm`/`base` went into the same table**, which was not
in the handoff and is the difference between one scale and two. Thirty-one of
them sat *inside* the console — a seat row at `text-xs` beside a figure at
`--fs-11`, a league plate at `text-base` beside a scaled `PlateField` — and left
alone they would have inverted the relationships the components were drawn with
at exactly one breakpoint each.

**The scale is app-wide rather than scoped to `/manager`.** The alternative was
to raise it on this route alone, and it is worse in the way that has no symptom:
`ManagerPlate`, `card-plate`, `league-config-window`, `league-teams` and the
console key constants are read by four pages, so a scoped bump is a trade card
whose plate is 16% larger than the board around it. Every other console page was
re-measured at 390 and 1280 in both schemes rather than assumed — see Verified.

**Three fixed-width boxes did not scale with the type in them, and all three had
to be re-measured**, which is the failure class this kind of change has: type in
flow reflows and type in a circle clips.

- **Both win-rate dials.** The manager's is 88px with a 56px lit window, the
  checker's 88px with a 62px one, and neither grew. What a figure inside them
  has to clear is **the chord at its own height, not the window's diameter** —
  a line of digits sits below the `Win` label and crosses a shorter part of the
  circle. At the new scale `--fs-17` cut `53.7%` on the manager dial, an
  ordinary reading rather than a worst case, so it steps `--fs-15` at five
  characters and `--fs-12` at six; the checker's six-character step moved
  `--fs-15` → `--fs-13`. The rule is the one `WeekSummary` already had and the
  manager's dial never did — which is why `100.0%`, what a small account
  projects when every league is a win, was clipping there before this pass too.
  Verified by eye at 4× rather than by arithmetic: a box measurement says the
  ink is wider than it is, and the handoff's own estimate for this figure (~51px
  where it renders at 59) is what a formula gets you.
- **The card's reading plate.** It sits opposite a league name that truncates,
  so every pixel it spends is a character off the card's own subject — and it
  grew ~12px at a phone's width without the card growing. It is `gap-2 pl-3
  pr-3` below `sm` now, which takes exactly that back out of the padding: the
  name is 10 characters at 402 against 8 without it, clearing the handoff's own
  "nine characters" claim. Nothing the plate *says* changed, which dropping a
  field would have cost.
- **The rack.** With the wordmark on, its row is ~370px against a 362px pill at
  390 — it fits from ~412px up and not below. So **the wordmark is the flask
  alone below `sm`**, with an `sr-only` "The Lab" carrying the link's name at
  every width. That is the fix this file already nominated for this exact
  situation, on the theme key's precedent that the legend is the first thing to
  go, and it also closes a fault that predates the scale: `/lineupchecker`'s
  rack was 54px over its pill at 390 and nobody had measured it.

  **The gate is narrower since**, and the measurement above is why it could be:
  the menu key carries a short tool name now, so the row only exceeds the pill
  on the pages whose rack is *also* carrying that page's controls. The wordmark
  is back below `sm` everywhere else, and the 370-against-348 figure that keeps
  it off the other two is remeasured in The finalization pass.

**The open card's housing freezes**, which is `group-open/card:sticky` at
`--card-freeze-top` and nothing else. A twelve-team browser is taller than the
viewport, so a reader three scrolls into one had nothing on screen naming the
league — the name is on a plate at the card's top edge and the top edge was
gone. It must be the **`<summary>`**: the `<li>` and the `<details>` are the
whole card, taller than the viewport, and sticky on a box that never fits does
nothing at all. The summary's sticky containing block *is* the `<details>`,
which is exactly the range the housing should stay over — it parks at the offset
and releases when the card's own bottom edge catches it, so it never outlives
its league. It also depends on no ancestor gaining `overflow: hidden`, which
makes the decorative clip's scoping to its own absolutely-positioned span
load-bearing a second time.

#### The plate on a phone, and the seam it cost

Below `sm` the plate stacked a name row, a season row and a controls row at
desktop padding — ~270px of an 874px screen before a single card. It is one
name row and one strip now, `Leagues · Filters │ Record │ dial`, at ~160px,
which is the design reference's own 157px to within three.

**The Filters key had to be in two places and is one element.** It rides the
season strip below `sm`, beside the figure it narrows, and the plate's own
controls strip from `sm` up. Rendering it twice and hiding one would mount two
`<dialog>`s — the argument the rack already settled the same way — so
`ManagerPlate` gained **`compactStrip`**: a wrapper takes the milled cut, both
lower blocks go `display: contents` inside it, and an `order` each interleaves
the figures and the keys into one flex row. `sm:contents` makes the wrapper
vanish above the breakpoint, so the desktop plate is untouched.

It is **opt-in**, and that is not caution: the merge is not something the plate
can do to a caller that has not been written for it, since the caller's own two
blocks carry the `contents` and the orders. The lineup checker deliberately does
not take it — its week figures and its attention window are a phone row on their
own, and merging a key into them is a redesign of a page rather than a
compaction of this one. What it *does* take is everything else in the phone
pass, the padding, the gaps, the avatar and the engraved name having always been
the plate's own.

**The key is etched below `sm`, not raised** (`PLATE_KEY` / `PLATE_KEY_CHROME`).
A key standing 3px proud among engraved figures reads as an object dropped onto
the plate rather than as part of it, so on a phone it is a hairline and a hint
of inset light. Geometry and chrome are two constants for `CONSOLE_KEY_PILL`'s
reason, and the surface reaches the dialog as its own **`triggerChrome`** prop
rather than through `triggerClassName`: appending `bg-none` to a string that
component already spells `bg-[image:…]` in is decided by Tailwind's emit order,
which is the coin flip that split exists to keep a key out of.

**One wrap point was added to the config window** and no group boundary moved.
Three ladders and the TE premium are the widest of its three groups and the one
that outgrows a phone-width card; below `lg` that group wraps internally and
`TE prem` drops under the ladders, which is the field that reads correctly on a
line of its own — it is a fact about the TE slot rather than another number on
the league's scale.

#### Verified

Rendered through a temporary `/preview` route against the real components,
tokens and Tailwind build — the method the console-card, shares, rack and
timeline passes established, since no database is reachable from where this was
built — then driven over CDP at 1280, 402 and 390 in both schemes and deleted.
The mechanics are unchanged: `--no-proxy-server`, `localhost` rather than
`127.0.0.1`, and a phone viewport from `Emulation.setDeviceMetricsOverride`.
The fixtures are three leagues — a dynasty superflex solved over twelve rosters,
a 14-team best-ball redraft, and a keeper league whose `roster_positions` and
`settings` never synced — plus an all-wins account for the dial's worst case.

The rack: top edge at `y = 0` at every width, and `plateTop − rackBottom = 28`
exactly at `md`. Rack content against its pill measured **9px of slack** at 390,
402 and 375 on `/manager`, `/trades`, `/picktracker` and `/lineupchecker` — the
last of which was 54px *over* before this pass, at the scale it already shipped.

The freeze, at 1280 and 402: `position: sticky`, `top: 74px`, `z-index: 20`; at
700px of scroll the housing sits at exactly 74 against a rack bottom of 62 and
54.8, **overlapping neither**; at the page's foot the summary's bottom edge
equals the `<details>`' own, which is the release. No horizontal overflow with a
card open.

The phone plate: 160.3px against the reference's 157, the strip reading
`Leagues 3 · Filters │ Record │ dial` on one line with the key at x=87.5
immediately after the `Leagues` figure and no groove between them, `background-image:
none` on the key (etched), the dial at 72px with a 46px window, and `100.0%`
measuring 41px inside it. The 40px bezel, the `--fs-9` eyebrow and the `--fs-21`
name are all the handoff's numbers.

Both dials were checked as pixels at 4×, which is the only check that answers
this: every reading now clears its circle at both sizes, where `53.7%` (manager)
and `100.0%` (both) were cut before.

At every width and in both schemes, on `/tools`, `/trades`, `/picktracker`,
`/lineupchecker` and `/manager`: `document.documentElement.scrollWidth` equal to
the viewport, **zero** elements past it, exactly one `<h1>`, and **no console
output of any kind**. 1,203 unit tests pass; `lint`, `typecheck` and `build` are
clean.

**Not verified against real data**, which is the gap to close first: every number
above is a fixture, and three things a render cannot check. Whether a real
account's league names truncate acceptably at 402 now that the plate spends ~12px
more on its figures — the fixtures' names are long by construction and the
handoff's are short. Whether the freeze still reads on a 113-league page, where
the sticky housings are one per card and the browser under one of them is a real
twelve-team solve. And whether `1.16` is the right figure against real content
rather than against three fixture leagues, which is exactly what the one-number
scale exists to make cheap to answer.

### The finalization pass

A contrast, density and phone-layout pass over `/tools`, `/manager` and
`/lineupchecker`, plus one genuine redesign — the **Card columns** dialog.
Applied from a design handoff, on its chosen directions (`1b` for Tools, `4b`
for the modal). Nothing on the wire moved: no route, no query, no contract type,
no payload field, and no migration.

**The one change that touches every page is two numbers.** `--readout-label` and
`--readout-muted` are the colour of the label under every figure on every card
in the app, and at 0.55 and 0.45 over `--readout-bg` they measured ~3:1 and
~2.5:1 — both under the floor. They are 0.72 and 0.62. Light mode needed no
edit, its counterparts being solid colours already measured at 5.2 and 4.8:1,
which is the argument `globals.css` gives for why they are tokens rather than
alphas in the first place. Four component-level label colours follow the same
reasoning and are not tokens: `PlateField`'s label, both summaries' `<dt>`, and
the lineup checker's `Lineup as set now`.

#### Tools

**`/tools` was on `wide`, which is `max-w-4xl` — the same as `default`.** The two
arms differ only in gutters, so a three-across grid inside the panel's own inset
landed a card at 241px and wrapped two of the five titles. It is `console` now
and the panel's inset steps `6 -> 8 -> 10` rather than to 13: card 241 -> **334px**,
every title on one line, measured.

**A locked card is not dimmed; it says so in words.** `opacity-45` over a
description already at `text-foreground/60` composited near 1.9:1, on three of
the five cards a first visit shows — and the dimming was the only *visible*
signal the card was inert, the `role="link"` + `aria-disabled` pair having
carried it for everybody else. So the foot reads `Account needed` where an open
card reads `Open`, at full contrast, and the phone card carries the same fact as
`Account` / `Ready` on its title row.

**The phone card drops its foot row and its depth.** The whole card is the
target on a touch device, so a row whose only job is to say "this is pressable"
is a row spent on nothing; the title steps `--fs-28 -> --fs-24` and the padding
tightens. **The depth rides `pointer-fine:` rather than a breakpoint** — the
league cards' own gate, and for their reason: the tilt exists to be flattened by
a hover, so on a coarse pointer it is a composited plane per card with nothing to
spend it on. The `<li>`'s `perspective` went with it.

#### The rack's wordmark, and the short tool names

`Tool.short` is new — `Mgr` and `Lineups` — and it lives in the registry rather
than being truncated in `ToolsMenu`, because a short name is a fact about the
tool: "Lineup Checker" abbreviates to "Lineups" and not to "Lineup Ch…", and a
component cutting at a character count would have to be right about every entry
`tools.ts` grows into. Only the *key* shortens; the menu's own entries keep the
full name, since a list that abbreviated would name the tools by two
vocabularies on one screen.

**The wordmark is back on the phone rack, on every page whose rack is not also
carrying that page's own controls** — and the gate is `controls`, not `sm`,
because a measurement says so. The pill's content box is 348px at 390. On
`/lineupchecker`: wordmark 129.1 + menu key 116.9 + Browse key 50 + theme key 38,
with three 12px gaps — **370 against 348**, and what hangs off the right edge is
the theme key. `/manager` fits at 333, but only because `Mgr` is three letters,
and the next tool to publish controls is what would break it silently. So the
legend yields to the page's own controls, which is the theme key's own precedent
— the legend is the first thing to go — applied to what the row is *carrying*
rather than to a breakpoint that cannot see it.

**Tightening the row instead was tried, measured and reverted**, and it is
written down in `app-rack.tsx` so it is not tried again: cutting the rack's gap
12 -> 8, the brand link's 12 -> 8 and the menu key's padding and tracking gets
`/lineupchecker` to **+4px at 390 and -12 at 375**, which is an ordinary phone.
Four pixels is not a margin on a row whose width the next registry entry changes.

#### The manager card

**The avatar lapped its own bezel on a phone.** `ManagerPlate`'s mount was
`size-10` (40px) and `Avatar size="lg"` a fixed 44px — 46px including its border
inside a 42px ring, on all four sides. Both halves moved: the avatar steps to
38px below `sm` (in `avatar.tsx`, where every caller gets it) and the mount to
48px, which is the 44-in-56 proportion the desktop plate already had. Measured
after: 5px of ring on every side at both widths.

**Twenty of the thirty-two tile labels were clipped at 390.** Four tiles across a
362px card gave a 75px tile and a 59px label box, against `Draft cap` at 64.9px
tracked. The gutter goes `px-[1.125rem] -> px-3.5`, the gap `2 -> 1.5`, the tile
padding `px-2 -> px-1.5` and both label lines lose their tracking below `sm` —
tile **79px**, label box **65px**, and **0 of 32 clipped**, driven over every
metric at both schemes.

That gutter is why `CONSOLE_CARD` split. `CONSOLE_CARD_SHELL` is the housing with
**no padding of its own** and `CONSOLE_CARD` is that plus the standard inset, on
`CONSOLE_KEY_PILL`'s exact line one axis over: a card that needs a different
gutter cannot get it by appending `px-3.5` to a string that already says
`px-[1.125rem]`, because two base `px-*` utilities of the same specificity are
decided by Tailwind's emit order rather than the class attribute's — and the
symptom is a card silently laid out at the wrong width.

**The tile's two lines had the hierarchy backwards.** Both were `--fs-9`, and the
*second* — the qualifier — carried `text-readout` and the readout glow while the
first, the thing being qualified, was the muted label colour. It is
`--readout-line` over `--readout-label` now, at `--fs-11`/`--fs-10` from `sm` up.
**The size half of that is one step smaller on a phone, and a render is what said
so**: at `--fs-11` untracked, `Draft cap`, `KTC start` and `KTC picks` are all
67.7px against the 65px box, and `--fs-10-5` leaves 0.4px, which is not a margin.
So the phone runs `--fs-10` over `--fs-9` — the hierarchy kept, one size down —
which is the §3.2/§3.3 conflict the handoff could not see from either section
alone.

**`RankedOf` is deleted.** It printed `Ranked of 12` under the strip: the same
number as the configuration window's `Teams` 40px above it, and the only
right-aligned caption on a card where everything else is left. The reading it
*could* make and `Teams` cannot is a rank's own `of` — the rosters a metric could
total, which is not always every seat — but that gap is a guard rather than a
case, and a caption that is right about a case nobody has is not worth a second
denominator on every card. **This was the handoff's own judgement call**, flagged
for the designer with a recommendation; the recommendation is what shipped, and
the alternative it names (keep it, drop `Teams`) is still available.

**`ColumnsStrip` is gone and the picker's key stands on its own row.** The tray
held a `Columns` label, one lit chip per chosen column and the key at `ml-auto`;
the designer removed the chips, and the well went with them, because a tray
holding a single key reads as a hole rather than as a panel of controls. The
bound the chips carried survives where it always also lived — the dialog refuses
to clear the last bay standing — and that rule is the one that must not become a
fall back to `DEFAULT_LINEUP_COLUMNS`, which is exactly what `normalize` does
when handed an empty array.

#### The lineup checker

**The week dial did not step down.** `SeasonSummary` runs 88px and 72px and
documents why; this one was a fixed 88 at every width — the same plate over the
same account drawn at two heights by two tools. Every inset is a chain measured
from the bezel's edge, so the arc, the pointer, the window and both type sizes
step together or the dial comes apart. The desktop arm's `100.0%` rule is
untouched; the phone window is 50px and its figure `--fs-10`, which needs no
help.

**The attention window forced the plate to four rows.** Its `min-w-[12.5rem]`
does not fit beside an 88px dial and a `Proj rec` figure in a 336px plate, so it
wrapped *and kept its floor*: 385px of phone before a single card. Below `sm` it
takes the line under the dial, its four `ReasonRow`s flow as one row of pips with
short labels, and the floor comes back at `sm`.

**`basis-full`, not `flex-1`, and that is the thing a render had to say.** The
handoff specifies `min-w-0 flex-1`; `flex-1` is `flex: 1 1 0%`, so the window's
hypothetical size is zero and it *always* fits on the dial's line — measured at
134.8px, in which the four pips are 52.2, 60.6, 43.8 and 66 and stack four deep,
which is the arrangement the change exists to replace. On its own line the wrap
box is 306px and the four flow in one row: window **336 × 77px**, one pip line,
measured.

**The week stepper joins the plate's controls strip below `sm`**, where its own
row was 36px of control and a hairline across the rest of a phone. **It is
rendered twice, which every other two-position control in this app refuses to
do**, and the two facts that make it safe are worth stating because neither holds
for the dialogs that established the rule: `WeekStepper` holds **no state** — the
week is off the payload and the handler is the page's, so two copies cannot
disagree — and both gates are `display: none`, which takes an element out of the
accessibility tree, so the `aria-live` readout inside it exists exactly once at
any width. Driven at both widths: two in the DOM, **one visible**. The header
carries the bottom margin below `sm`, because a hidden element's margins collapse
with it.

### The Card columns dialog, rewritten

The one genuine redesign, and the idea is one sentence: **the bay you select is
the thing you are editing.**

**What was wrong is a number.** Add and edit were two regions — a rack of four
bays, and under it a list of nine keys each carrying a full sentence, with the
chosen ones repeating that sentence inside their bay. Twelve sentences in a
448px column measured 1218px at desktop and 1352px at 390, against a `<dialog>`'s
own budget of ~812px: it scrolled, and *Done* sat well below the fold.

**The nine metric keys are gone because the nine metrics were never nine
questions.** They are a *value* crossed with a *scope*, and `METRIC_AXES` in
`lineup-columns.ts` is that grid — the **fifth** exhaustive
`Record<LineupMetricId, …>` in the contract's compiler seam, with `metricAt`
derived from it rather than written twice, because a metric that named one
pairing in the table and another in the lookup would be a picker whose keys light
on a column it does not set.

**The grid has two holes and the list was hiding both.** Projection × All has no
metric — a whole-roster rest-of-season projection does not exist here, and adding
one is server work — and picks are not a roster scope, only KeepTradeCut pricing
them. Each is greyed with its **reason in the key's title**, which is this app's
rule for a control that cannot act; `cellGapReason` is the one spelling, and
`lineup-columns.test.ts` pins that a hole always carries a reason, that a cell
never does, and that the holes are exactly those three cells and no others.

**`SwitchTrack` was generalised rather than copied**, which the handoff asks for
by name and `ktc-board-keys.tsx`'s own note already required: a switch that
stopped travelling in one of two spellings is the failure `console-chrome`'s
constants exist to prevent, and four tracks in one panel is four chances at it.
Two things generalised with it, and each is a state the two KTC axes never had —
`value` may be **null**, because an empty bay lights nothing where a market
always has an answer, and `taken` became `unavailable`, returning a *reason*
rather than a boolean, because a key can now be off for reasons that are not
"another bay holds it". A `row` size carries the labelled track; the legend is
`aria-hidden` because the group it labels already carries the same string as its
accessible name.

**The selection follows the column it wrote, and that is a bug a render found.**
Bays are numbered by canonical order, so an edit renumbers them: adding
`Proj · Bench` from bay 04 sorts it to bay 02 and left the panel editing bay 04's
old neighbour — the reader pressing a key and watching a different column answer.
Every write goes through `write`, which asks `normalizeLineupColumns` where the
column landed rather than predicting it. `clear` is the one that does not, and
deliberately: what the reader is looking at is the socket they emptied.

**An empty bay composes rather than refusing.** Its tracks are live with nothing
lit, and a press picks the first cell that is *free* — pressing `Proj` with bay
01 on `Proj · Starters` opens `Proj · Bench` rather than greying. A filled bay
keeps the axis the reader is not pressing, which is what makes the grid's holes
visible instead of silently routed around. Both were wrong in the first cut and
both were caught by driving the panel.

**The bay is the preview**, so there is no preview tile: the selected bay is
already drawn as the tile it configures and a second copy would be the same
reading twice. What is kept from the stepped-composer direction is the **`Reads`
line** — the composed column stated in words, on lit glass, recomposed on every
press — because it is the one thing the rack cannot say: a bay is four characters
of unit over a board pair, and `KTC · Dyn · SF` does not tell a reader the number
includes the picks.

**Two units per bay, switched by the cascade.** A bay is 91px at the dialog's
desktop width and 72px at 390, and inside the second there are ~58px for that
line — where `Draft cap`, `KTC start` and `KTC picks` all measure 61.5px. The
long form is the card tile's own `unit`, which is what makes the bay read as the
tile; the short form is the *value* axis the track below sets, the same word one
grain coarser, and it cannot clip.

**A `Position` axis is deliberately not built.** The design offers a third track
— `All / QB / RB / WR / TE / IDP` — and it is the one thing in the panel that is
a *feature* rather than a re-presentation: there is no position axis on
`LineupColumn`, no per-position total on `LeagueTeam`, nothing in
`lineupMetricTotals` that groups by position, and no rank for one in the route.
Building the track without those four seams would be a control that reads a
column nobody can compute. The handoff flags it as new server scope and asks that
it be confirmed first; it is flagged back rather than guessed at. The words
themselves are not new when it arrives — `SLOT_GROUPS` is derived from the
solver's own tables.

#### Verified

Rendered through a temporary `/preview` route against the real components,
tokens and Tailwind build — the method the console-card, shares, rack and
timeline passes established, since no database is reachable from where this was
built — then driven over CDP at 1280, 390 and 375 in both schemes and deleted.
The mechanics are unchanged: `--no-proxy-server`, `localhost` rather than
`127.0.0.1`, and a phone viewport from `Emulation.setDeviceMetricsOverride`.

The dialog: **448 × 504px** at desktop and **352 × 558px** at 390, both far
inside the 812px budget where the panel it replaces was 1218 and 1352. Four bays
across at both widths in **one row**, 91px and 72px, with **no line clipped** on
any of the nine metrics; `:modal` true, **zero** elements past the panel's own
box, and *Done* inside the viewport at both. Every rule landed: bay 03 on
`Dyn · SF` beside bay 02 on `Dyn · Auto` greyed the QB track's `Auto` with
"Another bay is on this board"; sitting on `All` greyed `Proj` with "There is no
whole-roster projection"; `Picks` greyed under Capital with "Only KeepTradeCut
prices a draft pick"; the empty bay drew `Composing`, an `Add` key and two live
tracks, and pressing `Proj` on it stored `ros_bench`, moved the selection to the
bay that column sorted into, and put `Projected points — bench, rest of season.`
in the `Reads` line.

The manager card at 390: tile **79px**, label box **65px**, **0 of 32 labels
clipped** across three column sets in both schemes, one row of four, and no
`Ranked of` caption. `/tools` at 1280: card **334px**, all five titles on one
line, `opacity: 1` on all three locked cards, `Account needed`/`Open` in the
foot, no `<nav>` — the page's deliberate exception. The rack is **one row with
zero overflow** on `/tools`, `/trades`, `/picktracker`, `/manager` and
`/lineupchecker` at 390 **and 375**, with the wordmark drawn on the first three
and the flask alone on the two that publish Browse keys. The lineup checker
plate: dial **88 -> 72px**, attention window **336 × 77px** on its own line with
**one** pip row at 390 and four stacked rows at 1280, exactly **one** stepper
visible at each width against two in the DOM, and the avatar **38-in-48** at
phone and **44-in-56** at desktop with 5px of ring on every side.

At every width and in both schemes: `document.documentElement.scrollWidth` equal
to the viewport, zero elements past it, one `<h1>`, and no console output but the
dev server's own React-DevTools and HMR lines. 1,207 unit tests pass; `lint`,
`typecheck` and `build` are clean.

**Not verified against real data**, which is the gap to close first: every number
above is a fixture. Three things a render cannot check — whether the raised
`--readout-label` reads as intended on **Pick Tracker, Trades and Logs**, which
the handoff has not designed and which every use of those two tokens now touches;
whether a real account's league names still set acceptably in the manager card's
tighter 14px gutter; and whether the four-bay rack holds a reader's own stored
selection as legibly as the fixtures', since the bay's short unit is the *value*
axis and two KTC bays on one board read alike there.

## The console card

One card carries a league across three tools — `/trades`, `/manager` and
`/lineupchecker` — and this pass applied one idea to all three: **the card
stops being a pane of glass and becomes a bezel housing with lit windows set
into it.** The body was `--card-bg` with `--readout-bg` tiles floating on it;
it is `--housing-bg` now, and everything carrying a reading is a window. Type
inside a card is all `--font-mono`. Applied from a design handoff.

**The league moved from a headline into a plate**, and that is the change the
rest follows from. On `/manager` and `/lineupchecker` the name was a 1.75rem
`--chrome-face` engraving; it is a mono plate straddling the card's top edge
with the league's avatar lit in its bezel, and a second plate opposite carries
the figures the card is read for — record and two ranks, or the week's
projected outcome, or the trade's timestamp. A trade card already had that
construction, so the other two adopting it is what makes the three read as one
instrument seen from three tools rather than three cards that happen to hold a
league.

`features/shared/ui/card-plate.tsx` is the shared header — `CardPlateRow`,
`LeaguePlate`, `ReadingPlate`, `PlateField`, `PlateDivider`, `CardRule`,
`Scanlines` — on `CONSOLE_KEY`'s own line: a second feature reads it.
`console-chrome.ts` gained `CONSOLE_CARD` (the housing), `CONSOLE_WINDOW` (a
readout set *into* one) and `CONSOLE_PLATE`. **The plate row is one flex row,
never two absolutely-positioned spans**, which `trade-card.tsx` found at 390
and every card now inherits: laid out independently the two plates overlap and
the league name runs under the date.

### The three data dependencies, and where each landed

**KTC values on a trade's assets: blocked when this shipped, filled in
since.** `shared/ktc` scraped both markets but `ktc_values.sleeper_id` was
nullable and never written, so nothing could price a player and a pick had no
board to read. What landed *then* was `features/trades/asset-value.ts` — the
value column, the side total, and **the rule that outlived the gap**: a side
with nothing priced totals `—`, never `0`, because a zero there is a claim in
the sense this file uses the word about `DEFAULT now()`. The matcher and the
pick board arrived with the KTC columns and filled the seam; `NO_ASSET_VALUES`
survives as the empty state rather than as the permanent one, and FAAB is still
`—` for good — it is a league's own currency and no market prices it. See
**KeepTradeCut prices landed here** in the trades section.

**The league avatar needed nothing.** `ManagerLeague.avatar_url` already
carries it, resolved server-side by `sleeperAvatarUrl`, so the trades board
gets it free through `TradeLeaguesPayload`.

**Standings rank and points rank are new, and they come off `rosters`, not
`matchups`.** The handoff named the matchup rows; the roster settings blob is
where Sleeper keeps its *own* running standings — the same `wins`/`losses`
`league.record` is read from, plus `fpts` and `fpts_decimal` — so deriving the
ranks from anywhere else is how a rank could disagree with the record printed
beside it on the same plate. `MANAGER_RANKS_SQL` in `manager/queries.ts` is a
LATERAL counting the rosters strictly ahead: standard competition ranking, and
a **row comparison** so wins-then-points is one expression rather than two that
can drift. Three guards keep a rank from being a claim — `manager_roster_id`
(a chopped-out manager has no roster to rank and would otherwise compare as
0-0-0 and come back ranked, last), `league_played` (a league where nobody has
played has no standings) and `league_scored`.

**The lineup checker's projected outcome is the opponent's own lineup, solved.**
`getManagerWeekLineups` now joins the other side of the same `matchups` pairing
— `matchup_id` is nullable and a null never equals a null, so an unpaired week
finds no opponent rather than pairing with every unpaired roster — and
`solveWeekLineup` prices it through **the same `compareLineup`** the manager's
own total comes from. That is not waste: the comparison drops slots this build
doesn't recognise from both lineups, where a bare sum over the opponent's
starters would leave theirs whole and read as a loss caused by an unfamiliar
slot name. `opponent_points` is null — never zero — for a future week, an
unpaired week, or an opponent whose roster is not stored, and the plate is not
drawn at all in those cases rather than showing `128.4–0` and a W.

### Tokens, and light mode

Three new tokens the handoff named (`--housing-shadow`, `--plate-raised-bg`,
`--plate-raised-shadow`) plus five it implied, each with a light counterpart:

- **`--housing-bg` is its own token rather than `--bezel-bg`**, and light mode
  is why. The bezel is the small raised mount the flask sits on and light mode
  draws it near-white; a *card* drawn near-white has almost no separation from
  the pale-mint readouts set into it. The light housing is a **mid slate** —
  the handoff's own instruction to darken rather than mirror — and the plate on
  top stays near-white, because a plate mounted on a housing is the surface
  catching the light.
- `--window-shadow` is `--readout-shadow` plus the lit bottom lip that closes
  the recess against the bezel around it. A readout on a flat panel has nothing
  for that lip to catch, which is why the account readout keeps the other.
- `--readout-line`, `--readout-label` and `--readout-muted` are type on lit
  glass. **Tokens rather than alphas over `--color-readout`**, for the reason
  the accent is never drawn with an alpha: light mode's readout text is a teal
  already near its contrast floor, and `text-readout/45` on a pale mint window
  is ~2:1. The light values are solid and measured — 11:1, 5.2:1, 4.8:1. The
  give track's three shades collapse into `--readout-muted` alone, since a
  light counterpart cannot carry an alpha and 0.05 of the same mint is below
  the threshold at which anyone could tell the halves apart.

**The lineup checker's refresh key sits inside the window now.** The disclosure
body it lives in stopped being a second slab of card and became lit glass, so
the key takes a `relative` wrapper to clear the scanlines and a hairline under
it: the seat rows below draw their own dividers, and a key resting straight on
the first of them reads as the lineup's own header row. Where it lives is
unchanged and is an accessibility decision — see Syncing one league.

`rankColor` moved to `features/shared/rank-ramp.ts` — the checker's win/loss
pip draws from the same red→green ramp the manager card's rank tiles run on,
rather than a second red — and `lineup-metrics.ts` re-exports it, so its own
readers and its test did not move.

### Changed against the handoff, each because a render showed it

- **`min-w-0` on the `<details>`**, on both cards. The `<li>` is a row flex
  container, so its item takes `min-width: auto` and refuses to go below its
  own min-content — and the expanded half's two panes sit side by side at every
  width by design, which puts that min-content above 390. Without it the card
  is wider than the viewport and the whole page scrolls sideways. **This was
  true before the pass** (the old wrapper's wider padding made it 412px against
  404) and is fixed here because the pass was in the file.
- **The manager plate drops its points rank below `sm`.** Three fields and
  their dividers are ~225px of a 322px row at 390, leaving the league plate
  four characters — "D…" where the league name is the card's whole subject.
  Dropping the third gives it nine, and the points rank is the one of the three
  a reader can most nearly infer from the other two.
- **The trade date drops its year below `sm`**, for the same 322px: the board
  answers one season by construction, so the year is the most redundant token
  on the plate. Two spans switched by the cascade, not by state — a client
  component must not have to hydrate to learn a breakpoint.
- `--card-specular` is gone with the glass. It was a white wash over a
  translucent card, and the housing draws its own top highlight in
  `--housing-shadow`'s first inset; two of them is a bezel with a second,
  brighter bezel painted on it. The sheen, floor, glow and edge light stay, and
  so does the whole `pointer-fine:` gate — the handoff is explicit that nothing
  in the redesign argues against the tilt, and its per-device budget is
  unchanged.

### Verified

Rendered through a temporary `/preview` route against the real components,
tokens and Tailwind build (there is no Sleeper access from a sandbox, so the
props were fixtures), and screenshotted over CDP at 1280 and 390 in both
schemes with every disclosure open. What that turned up is the three changes
above; the 390 pass now has **no horizontal page overflow** (`main.scrollWidth
=== 390`), where it had 28px before. A phone-width viewport has to come from
`Emulation.setDeviceMetricsOverride` rather than `--window-size`, which headless
Chrome clamps to a ~485px minimum — a `--window-size=390` run silently lays out
at 485 and crops. The route was deleted afterwards.

## Theme

Two schemes, one set of markup, and `globals.css` is nearly the whole of it:
the dark tokens on `:root`, a `:root[data-theme="light"]` block that moves them,
and `@theme inline` mapping them into Tailwind's namespace.

**Dark is the default and light is the opt-out**, which is a choice rather than
an accident of ordering: the console is a dark-first design whose light half is
derived from it, so dark is what the app *is* rather than what a given machine
prefers. `prefers-color-scheme` selected between them until the toggle landed
and now selects nothing — with a persisted choice in the header, an OS query is
a second answer to a question that has an owner, and the two disagree the moment
anyone presses the button. Dark needs no selector of its own; the absence of the
attribute is the default, so only light is ever written.

**`inline` is load-bearing.** A plain `@theme` bakes its value into every
generated utility, so `text-foreground` would resolve once at build time and no
`:root` override could move it afterwards. `inline` emits `var(--foreground)` at
each use site instead and lets the cascade do it. (This reverses an earlier note
here arguing for plain `@theme` on the grounds that nothing indirected any more.
Supporting a second scheme is what made the indirection earn its place.)

Two rules for adding to it:

- **Write alphas over `--color-foreground`, not literal colours.**
  `bg-foreground/[0.04]` and `border-foreground/12` are what make one card read
  correctly in both schemes — a translucent dark tint on a light ground and a
  translucent light tint on a dark one are the same glass.
- **Anything that must name a colour becomes a token.** The card shadow, the
  accent glow and the error text are all `var(--…)` in the class string for
  exactly this reason: an `rgba()` typed into a Tailwind arbitrary value cannot
  invert. (The header scrim's `--header-from` / `--header-to` were the third
  example until the tools page's sticky header went; the tokens went with it.)
- **A bevel is a stack, and the inverse is a different stack — not a different
  alpha.** The tools console's chrome (plate, bezel, key, readout, groove, card,
  panel) is therefore a token *per surface* holding a whole gradient or
  shadow list, with a light counterpart in the `[data-theme="light"]` block,
  rather than the alphas the rest of the app is written in. The same goes for depth on
  *engraved* type: `--wordmark-depth` and `--card-title-depth` sink the glyphs
  with black on the dark ground and lift them with white on the light one, and
  the hover glow is a second token (`--card-title-depth-hover`) because `filter`
  does not compose across two declarations the way `box-shadow` lists do.
- The leagues console added five more on the same terms: `--meter-track` (the
  cut channel a meter runs in — darker than its plate in both schemes, because
  a groove is), `--dial-track`, `--progress-fill` (segmented, so a lit bar
  reads as an instrument counting up rather than a painted rectangle),
  `--alert-bg`, and `--metric-secondary` (mapped as `--color-metric-secondary`).
  **That last one is gone**: it was the *second* metric colour, and the rank
  ramp took its only consumer — see the leagues console. The console pass added
  `--track-shadow` and `--well-shadow` in its place, plus the ramp's own
  `--rank-l` / `--rank-l-mid` / `--rank-c`.
- The console-card pass added eight more, and one of them is the exception to
  the rule above: `--housing-bg` exists **because a light counterpart cannot be
  a mirror**. See The console card for that argument, for why
  `--window-shadow` is not `--readout-shadow`, and for why the three lit-glass
  type colours (`--readout-line`, `--readout-label`, `--readout-muted`) are
  tokens rather than alphas over `--color-readout`.

### The toggle

`ThemeToggle` (in `features/shared`) writes `data-theme` onto `<html>` and
persists the choice through `local-store`, on `account.ts`'s terms. Three things
about it are load-bearing, and two were learned from Next's own
`preventing-flash-before-hydration` guide rather than from first principles:

- **The stored theme is applied by an inline script in `<head>`, not by
  React.** `THEME_BOOT_SCRIPT` in `shared/theme.ts` runs while the HTML is still
  parsing, which is the only moment early enough: an effect — even a layout
  effect — runs after hydration, and on a slow connection the browser has
  painted the server's markup in the default scheme long before React loads. A
  reader who chose light would watch the dark console flash on every hard load.
  The key is a *string in a module with no imports and no `"use client"`*, so
  the server layout and the client toggle spell it once. It is `localStorage`
  and not a cookie deliberately: reading a cookie in the root layout opts the
  whole app out of static prerendering, and `/tools` is prerendered.
- **`<html>` carries `suppressHydrationWarning`.** React would otherwise treat
  the attribute it did not render as a mismatch, and its recovery —
  client-rendering from the nearest boundary — discards the script's work along
  with the theme.
- **The toggle re-applies the attribute in a `useLayoutEffect`.** React's
  dev-only Strict Mode remount resets `<html>` to the attributes it manages from
  JSX, clearing the one the script set: the stored theme silently reverts to the
  default under `next dev` and nowhere else. The effect is a no-op in
  production, and deleting it as dead code makes development lie.

**The button holds no state, and that is what keeps its glyph right.** It
renders both faces — sun while dark, moon while light — and `globals.css`
(`.theme-when-dark` / `.theme-when-light`) shows one. State would have to wait
for hydration to learn what the document already knows, which is one frame of
the wrong glyph on every load. Each face carries its own `sr-only` label, so the
accessible name follows the same cascade: a `display: none` face is out of the
tree entirely, where a single `aria-label` would need the state we just avoided.

**The accent is two colours, deliberately.** `#00ffe5` is ~15:1 on the dark
ground and ~1.3:1 on white, and it is used as *text*. Light mode gets a teal
(`#0b6d63`, ~5.2:1). Watch alphas on it — `text-active/80` drops the light-mode
label below AA, which is why the account heading uses full opacity.

`--font-display` maps `--font-geist-sans` and `--font-mono` maps
`--font-geist-mono`, both loaded in `layout.tsx`. Geist Mono was dropped once
for being loaded and mapped by nothing; it is back because the tools console's
readout, key legends and labels ask for it — the test is a reader, not the
file's presence.

`.lab-anim` marks anything decorative that moves, so the
`prefers-reduced-motion` rule can stop all of it at once. It uses `!important`
because those animations are set inline.

## The app icon

Until this landed the tab carried Next's own default `favicon.ico` — the app had
a mark everywhere except the one place a reader sees it before the page paints.
The design bundle is the `FlaskMark` set on a plate, and it is five files in
`src/app/`, all of them Next's static metadata conventions rather than anything
this repo wires by hand.

**The names are the wiring**, and two of the five had to be renamed to get it.
`app-icons.md` in the bundled docs is the reference, and the rule that decides
this is in `next/dist/lib/metadata/is-metadata-route.js`: the variant matcher is
`\d?` — **one optional digit**, not a suffix. So the export's `icon-32.png` and
`icon-512.png` match nothing and would have shipped as dead bytes in the app
directory, silently, because an unmatched file in `app/` is not an error. They
are `icon1.png` and `icon2.png`. The other three (`favicon.ico`, `icon.svg`,
`apple-icon.png`) are already conventional and were copied under their own names.

What that buys, read off the built HTML rather than assumed:

```
<link rel="icon" href="/favicon.ico"   sizes="48x48"   type="image/x-icon">
<link rel="icon" href="/icon.svg"      sizes="any"     type="image/svg+xml">
<link rel="icon" href="/icon1.png"     sizes="32x32"   type="image/png">
<link rel="icon" href="/icon2.png"     sizes="512x512" type="image/png">
<link rel="apple-touch-icon" href="/apple-icon.png" sizes="180x180" type="image/png">
```

**The plate is what makes the icon scheme-independent, and that is the design
decision rather than a style.** Everything else in the app is two schemes over
one set of markup; a favicon cannot be. It is painted onto browser chrome this
app does not own, `data-theme` is unreachable from it, and a
`prefers-color-scheme` media query inside an SVG favicon is honoured by Firefox
and Safari and ignored by Chrome — so a mark that inverted would invert on some
readers' machines and not others. The bundle answers that by carrying its own
dark ground (a radial `#16303c → #08090a`, rounded at `rx=7`), so the same file
is correct on a light tab strip and a dark one. `FlaskMark` on the page keeps
drawing on `--active` with no ground, because there it *is* in a scheme.

**The flask geometry is the same three paths as
`features/tools/components/flask-mark.tsx`**, to the digit — the icon is that
component with a plate behind it, not a second drawing of the same idea. Two
copies of the path data now exist and cannot be made one: the component is JSX
reading Tailwind classes off the theme, and the icon is a static file Next hashes
at build time. The thing to know is which way a change travels — a redrawn mark
is a redrawn *icon set*, re-exported, because nothing here regenerates the five
files from the component.

**`icon1.png` is deliberate redundancy and worth naming as such**, since the
`.ico` already carries 16/32/48 as PNG-encoded entries and the 32 in it is the
same image. It is the raster fallback in the conventional six-file set, and 7KB
served only to a reader whose browser passed on the SVG. `icon2.png` at 512 is
the large-icon slot — an Android home-screen shortcut with no manifest to read
takes the largest declared `rel="icon"`.

**No web manifest**, and that is the one thing in the bundle left unspent.
`icon2.png`'s canonical consumer is a manifest's `icons` array, and Next has
`app/manifest.ts` for it — but a manifest is an *installability* claim (`display`,
`start_url`, `theme_color`, `background_color`) and none of those four is
answerable from an icon export. `theme_color` is the sharp one: the app has two
schemes with a persisted choice, and a manifest names one colour. It arrives with
a decision about whether this app wants to be installed.

**The SVG is the export minus its C2PA manifest; the three rasters are the
export whole.** The split is not a position on content credentials, it is where
the arithmetic falls. In the SVG the `<metadata>` block was 7.7KB of 8.6KB — the
provenance was ninety per cent of the asset and the drawing was the other ten —
and it is 848 bytes now, small enough to read in a diff beside
`flask-mark.tsx`, which is the second thing that buys: this is the one icon
whose source a person will ever open. The `caBX` chunk in each PNG is 5758 bytes
against a 21KB and a 105KB file, where the same edit would be re-encoding a
signed export to shave five per cent nobody measures.

Two things went, not one: the manifest and the `xmlns:c2pa` declaration that was
its only user. Nothing else in the file was touched — not reformatted, not
minified — so a re-export still diffs against it in one hunk.

### Verified

`npm run build` lists `/icon.svg`, `/icon1.png`, `/icon2.png` and
`/apple-icon.png` as static routes and emits the five tags above into every
prerendered page, which is the check that the rename was the whole of the wiring.
Rendered through headless Chrome at 16, 32, 64, 128 and 512: the SVG is legible
at tab size, and against `icon2.png` at 512 the ink measures 50.0% of the plate's
width against 47.7% and sits centred to within 1.2% — a rasteriser's rounding,
not two different drawings. The `.ico`'s own 16 and 32 entries were extracted and
read at 8× and both hold the flask's neck, lip and fluid line. The metadata
strip was checked the only way worth checking it: the same 512 render before and
after hashes to the same SHA-256.
