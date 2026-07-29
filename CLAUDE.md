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
  missed the warning.
- A module owns its tables. If you need data from another concern, add a query
  to *that* module and call it — don't write SQL against a table your module
  doesn't own. (`ktc/match` used to query `players` directly; it doesn't now.)
- **A cache-backed route reads and nothing else.** `/api/projections`,
  `/api/league/[leagueId]` and `/api/adp` answer from what the background syncs
  have stored; a slice that hasn't been synced comes back empty rather than
  fetched on demand. (`/api/user/[username]` and `…/leagues` are the deliberate
  exception — resolving a manager and syncing their leagues is what they are
  *for*, which is why the leagues one streams progress. `…/players` shares that
  prefix and is *not* an exception: it reads the rosters that stream writes, so a
  manager it has never run for gets an empty answer rather than a second sync of
  their own.) Where a read needs to know what week it is, derive it from
  stored data too: `projections/queries`
  takes the weeks still ahead from `game_date` rather than `state/nfl`, so it can
  only ever name weeks that are actually here to read.
- A route that needs several independent reads should `Promise.all` them, and
  decide per read whether a failure is fatal. `/api/league/[leagueId]` catches
  its projections read and sends `outlook: null` — the rosters are the point of
  that route and the lineups are a bonus on top.
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

## Database

Use the helpers in `@/shared/db` rather than hand-rolling:

| Need | Use |
| --- | --- |
| A transaction | `withTransaction(client => …)` — never write `BEGIN`/`COMMIT`/`ROLLBACK` yourself |
| Work that must not run twice | `withAdvisoryLock(LOCK_KEYS.x, …)`, returns `null` if someone else holds it |
| Multi-row insert/upsert | `bulkInsert` — chunks and parameterises |
| Cache freshness gate (whole table) | `isFresh(table, ttlMs)` / `countRows(table)` |
| JSONB parameter | `jsonb(value)` |
| A TTL bound against `now() - $n::interval` | `msInterval(ttlMs)` |

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

A slice's TTL should match how fast *that slice* moves, not the table's. The same
projections sync runs two: this week and next are gated at an hour because an
injury designation changes them, and the rest of the season at a day because it
doesn't. One gate for both would have to choose between a stale lineup and 90MB an
hour. Where the slow tier is also large, cap how many slices a tick will fetch
(`HORIZON_WEEKS_PER_TICK`) and report what the cap deferred — a skipped slice that
reads as "fresh" is how a backfill silently stops advancing.

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

`projections/filters` follows it. The `list`/`integer`/`enumList` primitives
both filter modules use live once, in `shared/query` — a pure module they import
relatively with a `.ts` extension, the same mechanism the tests use, so sharing
costs no runtime dependency. (They used to be copied into each filter module to
avoid pulling a barrel's database code into a tested file; the copies had
already drifted, which is how `booleanFlag` and `booleanFilter` came to be two
named functions — absence means "off" for a flag like `?stats=1` and "don't
filter" for a population filter like `?best_ball=`, and one function silently
serving both meanings is the bug the split names.)

`manager/shares` is that shape on the client: `playerShares` takes the leagues,
the rosters and the players cache as arguments and counts, so the rules that
decide what a share is out of can be read and tested without a fetch behind them.
It sits beside `filters` because the two compose — the caller filters the league
list, then counts over what's left.

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
- **Every `/manager/[searched]/…` view renders one `ManagerHeader`.** Who is
  being looked at, the season and the sync state are the same facts on all of
  them; only the count line under them differs, which is what `children` is. The
  tabs live there because that is the only thing making a second view reachable —
  there is no global nav — and they link with the URL's own spelling of the
  manager rather than the resolved username, since Sleeper resolves a user id as
  readily as a name.
- **A player share is out of the leagues that hold a roster of yours, not the
  leagues listed.** They are different numbers — 121 leagues, 113 rosters for the
  account this was built against — because Sleeper keeps you in `league_users`
  after you stop holding a team (a guillotine league you were knocked out of, one
  you left). Counting membership would quietly deflate every share on the page,
  so `playerShares` counts only leagues that contributed a roster, and an empty
  roster (pre-draft) still counts: holding nobody is a real answer.
- **The shares list is one line a row, unlike the roster panel's two.** That rule
  is about a panel rendering at half a card's width; this page has the full shell,
  so the name is in no danger and splitting it would only add height to a list
  several hundred rows long. Both numbers are kept — the count is what's actually
  held and compares between players, the share is what it means for a portfolio
  and moves when the filters do.
- **A list of managers is labelled by username, a team by team name.** `ui.tsx`
  has both — `managerLabel` (display_name → team_name → roster number) and
  `teamLabel` (the reverse) — and the column heading says which one it is.
  `standings` is a Manager column, so it uses the username: a team name is a
  nickname someone picked for one league and changes at will, so labelling by it
  makes the same opponent read as a different person in every league they're in.
  The team name isn't dropped, it's demoted — it stays on the row's hover and the
  roster panel beside it still leads with it. Pass the same string to
  `TeamAvatar`'s `label` so its fallback initial matches the name shown next to it.
- **Rows in that panel give the name its own line.** Both lists inside it —
  `standings` and `roster-detail` — put the team or player name alone on the first
  line and everything else (record, points for, position, NFL team, both totals)
  on a second line under it. The name is the field a reader scans for and it lost
  every fight for horizontal space in a panel rendering at half a card's width;
  "Christian McCaffrey" between a slot label, a badge, a team and two numbers
  truncates to nothing. The numbers keep their own grid columns on that second
  line rather than being folded into a sentence, because they are what's worth
  comparing down the list. Row and heading share **one** grid template
  (`SectionLayout` in `roster-layout`, the `columns` string in `standings`) — a
  header laid out separately drifts the moment a width changes, which is why the
  layout lives in its own file: `roster-detail` renders the headings and
  `player-row` lays the cells, and the template they share is the contract
  between them. Every template is written out as a whole class string so
  Tailwind can see it.
- **`roster-detail` shows the optimal lineup only** — there is no current/optimal
  toggle. The current lineup is a click away in Sleeper; what this tool adds is
  the best lineup available, so the starters list *is* that lineup and the bench
  follows it (promoted rows highlighted, sat rows dimmed). The gap against what
  the team is actually starting is stated in words — `+X on the bench · start … ·
  sit …` — rather than made something to find by toggling. `optimal.ts` still
  computes `current` / `current_points`: `points_left`, `start` and `sit` are
  differences against them, so they are load-bearing, not dead.
- **Every roster row carries two numbers, not one: `start` and `bench`.** A
  season total answers the wrong question on both sides of the roster. A backup
  quarterback projected 361 points behind two better starters is worth *nothing* —
  none of it reaches a lineup — while one projected 398 is worth only the 46 he
  scores in the two weeks he is the better start, and a single total calls those
  the same. The columns are labelled once per section (`RosterSection` takes
  `columns`, sized to match the cells so the headings stay over them) rather than
  on every row. IR and taxi get the one `proj` column instead: a player Sleeper
  won't let start has no starting half, so a split there would be two ways of
  writing zero.

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
- **Some of what's in `stats` isn't a projection at all.** `pass_fd`, `rush_fd`
  and `rec_fd` are exactly the yardage over ten — Burrow projects 25.83
  completions and 29.39 passing "first downs" — and the reception splits
  (`rec_0_4` … `rec_40p`) are a fixed 20/20/30/20/10/10 carve-up of `rec`. Both
  hold on every row of both stored seasons. Scoring them is not a small error: 39
  leagues here pay for `rush_fd`, so a league at 0.5 a first down is silently
  adding 0.05 a passing yard on top of its own rate, up to 35% of a starter's
  total. `score`'s `DERIVED` set is the exclusion list, and `derivedScoring`
  reports them so the league is told rather than quietly given a smaller number.
  Check a new bonus key against both seasons before trusting it — `rush_40p` and
  `pass_cmp_40p` look like the same trick and hold to no formula.
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
