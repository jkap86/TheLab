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
`sleeper/missing` reads.

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
copied verbatim; `DEFENSIVE_SLOTS`/`IDP_SLOTS` have no reader yet, on the same
terms as `sleeper.types.ts` above — it is the ported vocabulary of record.
Modules that must resolve under Node's test runner (`adp-value.ts`,
`optimal.ts`, `ktc/roster.ts`) import it relatively with `.ts` rather than
through the folder's barrel, which reaches the network via `ros-read` and is
therefore server-only.

## Rest-of-season lineups

`GET /api/user/[username]/lineups` solves **every stored roster** in every
league into optimal starters and bench and ranks the manager's among them —
one request for the whole page, because the projections span is shared across
every league and per-card requests would refetch nothing but re-enter
everything. The client (`use-manager-lineups`) fetches it after the leagues
stream settles; `!refreshing` flipping true is also the refetch after a cold
sync, which is exactly when the rosters it solves from were written.

**Only the manager's lineup ships; everyone else is reduced to a rank.** Each
league's payload entry is `{ lineup, ranks }` (`LeagueLineupEntry`), and
`manager/league-ranks.ts` is the pure module behind it: one `solveLeagueLineup`
per roster, all five metric totals read off that one solve
(`lineupMetricTotals` — the solver already prices `points` *and* `adp_value`
onto every player, so there is no second valuation pass to drift from the
first). Ranks are standard competition ranking — ties share the better rank,
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
cannot drift; a league where the manager holds no roster has nothing to rank,
where `getManagerLeagues` still lists it.

The metric ids are a type-only union in the contract (`LineupMetricId`), and
the runtime lists live as exhaustive `Record<LineupMetricId, …>`s on each side
of the seam — the server's ranks literal, the client's `METRIC_ORDER` in
`features/shared/lineup-columns.ts` — so adding an id breaks both compiles
until it is placed. A value export from `contract/` would break that folder's
zero-runtime character, and the client cannot read a list out of
`shared/manager` without dragging `pg` into the bundle.

On the page, each league card is the league name plus up to four rank columns
("2nd of 12"), with the season line, team/record and `LineupBreakdown` behind
a `<details>` disclosure — `league-card.tsx` stays hook-free on purpose. The
column choice is a *set*, rendered in canonical order and persisted under
`thelab:lineup-columns` by `lineup-columns.ts`, a wrapper over the internal
`local-store.ts` on the same terms as `account.ts`. The picker is a native
`<dialog>`/`showModal()` (focus trap, Esc and backdrop for free — no
dependency), and it enforces its bounds by disabling rather than correcting:
the fifth box greys out at four, the last checked box at one, so an invalid
selection cannot be made rather than being repaired after.

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

`shared/ktc/` exists as `roster.ts` only — the superflex predicate, trimmed
from TheLabX's KTC pricing the way `adp-value.ts` was from its board half —
because ADP boards and lineup pricing both split on it and a second spelling is
the drift it prevents.

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
