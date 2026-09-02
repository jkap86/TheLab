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
`manager/crawl-ttl`, which arrive with the projections and crawler ports. Twelve
of its fourteen types have no reader yet, and that is deliberate: it is the
ported schema-of-record, and re-transcribing an API by hand is the expensive
half. `Tool` was trimmed the other way, to the five fields anything consumes —
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
background crawler and its scheduler, discovery and claim queue (the freshness
columns are already in the schema for it); the per-league refresh press, its
cooldown gate and the cache-busting token; the in-process read caches and
therefore `persistLeagueGraph`'s `affectedOwnerIds`; the request budget and its
503 taxonomy; players, trades, and projections *storage* — the pure projections
core (solver, scorer, aggregation) arrived with the lineups route below, but
the Postgres tables, the weekly sync and its background loops stay with the
loops that need them.

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
it arrives with `/api/adp` and its filters. **There is no ADP data in this repo:
the curve is the seam, waiting for a source.**

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
lineup, all five metric totals, pick portfolio, label, `is_manager` — because
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
solve-and-rank underneath: one `solveLeagueLineup` per roster, all five metric
totals read off that one solve (the solver already prices `points` *and*
`adp_value` onto every player, so there is no second valuation pass to drift
from the first). Ranks are standard competition ranking — ties share the better rank,
the next distinct total skips — and `of` counts the rosters actually ranked,
orphans and empty rosters included, not `total_rosters`. **A metric ranks
`null` when every roster in the league totals zero on it**: one rule that
covers both `from_week: null` (no projections → both ROS metrics) and an empty
ADP board (all three capital metrics), because "1st of 12" among all-zero
totals is a claim. One subtlety the tests pin: player *identity* (positions)
rides the projections feed, so a wholly absent feed nulls the capital
starters/bench **split** too — nobody can be seated, the roster's capital all
lands on the bench — while `capital_total` keeps ranking. Capital ranks are
invariant to *points*, not to the feed's existence. The query behind it, `getManagerLeagueRosters`, aggregates
the rosters per league row in one round trip and gates on `HOLDS_A_ROSTER_SQL`
— the roster half of `FIELDED_A_TEAM_SQL`, extracted so the two spellings
cannot drift; a league where the manager holds no rostered team — left, chopped
out, or not yet drafted — has nothing to rank, where `getManagerLeagues` still
lists the chopped case.

The metric ids are a type-only union in the contract (`LineupMetricId`), and
the runtime lists live as exhaustive `Record<LineupMetricId, …>`s on each side
of the seam — the server's ranks literal, the client's `METRIC_ORDER` in
`features/shared/lineup-columns.ts` — so adding an id breaks both compiles
until it is placed. A value export from `contract/` would break that folder's
zero-runtime character, and the client cannot read a list out of
`shared/manager` without dragging `pg` into the bundle.

On the page, each league card is the league name plus up to four rank columns
("2nd of 12"), with the season line, team/record and the team browser behind a
`<details>` disclosure — `league-card.tsx` stays hook-free on purpose, and the
state a card does need lives in `league-teams.tsx` below it. The browser is
two panes: every team on the left with one number column, the selected team —
the manager's by default — solved out on the right as `LineupBreakdown` then
`DraftPicks`, Sleeper's team-page order. The panes sit side by side at
*every* width, phones included — stacking put the roster below twelve teams —
so truncation, not wrapping, is what carries a narrow card. The column's metric is a per-card
`<select>` (default ROS starters) and the list is *sorted* by it, because it
is the standings behind the card's "2nd of 12" — the order and the number must
agree — and when every team totals zero on the metric the column shows dashes,
the same all-zero rule the server ranks `null` by. Selection is *resolved*,
not synced (`chosen ?? manager's team`), so a payload refresh under an open
card falls back rather than pointing at a ghost. The breakdown's number column
is one lens at a time, points or capital, flipped by
a per-card toggle (`useState`, deliberately unpersisted, like the metric
select): the two figures never
share a column because they would read as the same unit, and the headline total
follows the lens so it always agrees with the rows beneath it. The
column choice is a *set*, rendered in canonical order and persisted under
`thelab:lineup-columns` by `lineup-columns.ts`, a wrapper over the internal
`local-store.ts` on the same terms as `account.ts`. The picker is a native
`<dialog>`/`showModal()` (focus trap, Esc and backdrop for free — no
dependency), and it enforces its bounds by disabling rather than correcting:
the fifth box greys out at four, the last checked box at one, so an invalid
selection cannot be made rather than being repaired after.

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

`shared/ktc/roster.ts` is the superflex predicate, trimmed from TheLabX's KTC
pricing the way `adp-value.ts` was from its board half — ADP boards and lineup
pricing both split on it and a second spelling is the drift it prevents. The
folder's sync half arrived since; see the KeepTradeCut section below.

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
them. The slug embeds the id, so it is per-board too; nothing links an entry
across formats until the Sleeper matcher ports. `sleeper_id` ships nullable
and unwritten for that port — deliberately absent from both halves of the
upsert, so the matcher's backfilled ids survive every refresh — and must never
go unique: two KTC rows can legitimately resolve to one Sleeper player.

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

The barrel is **server-only** now — the sync drags `pg` in — on the projections
barrel's exact terms: a client module needing `isSuperflexLineup` imports
`./roster` relatively. Deliberately not ported, each with what it arrives with:
`match.ts` and `values.ts` (the Sleeper matcher, with the `players` table),
`queries.ts`, `history-stats.ts`, `picks.ts` and `roster.ts`'s pricing half
(`ktcBoardValue`, `rosterKtcValue`) — readers all, arriving with the surface
that reads them.

## Theme

Two schemes, one set of markup, and `globals.css` is the whole of it: tokens on
`:root`, a `prefers-color-scheme: dark` block that moves them, and `@theme
inline` mapping them into Tailwind's namespace.

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
- **Anything that must name a colour becomes a token.** The header scrim, the
  card shadow, the accent glow and the error text are all `var(--…)` in the
  class string for exactly this reason: an `rgba()` typed into a Tailwind
  arbitrary value cannot invert.

**The accent is two colours, deliberately.** `#00ffe5` is ~15:1 on the dark
ground and ~1.3:1 on white, and it is used as *text*. Light mode gets a teal
(`#0b6d63`, ~5.2:1). Watch alphas on it — `text-active/80` drops the light-mode
label below AA, which is why the account heading uses full opacity.

`--font-display` maps `--font-geist-sans` from `layout.tsx`, which is the only
face loaded. Geist Mono was loaded too and mapped by nothing; it is gone.

`.lab-anim` marks anything decorative that moves, so the
`prefers-reduced-motion` rule can stop all of it at once. It uses `!important`
because those animations are set inline.
