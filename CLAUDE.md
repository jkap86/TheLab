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
  fetched on demand. (`/api/user/[username]`, `…/leagues` and
  `/api/picktracker/[leagueId]` are the deliberate exceptions — resolving a
  manager and syncing their leagues is what the user routes are *for*, which is
  why the leagues one streams progress, and the pick tracker follows a draft
  *while it happens*, for any league id whether a sync has seen it or not; a
  cached copy would be behind the room. `…/players`, `…/leaguemates` and
  `…/ranks` share the user prefix and are *not* exceptions: they read the
  rosters and membership that stream writes, so a manager it has never run for
  gets an empty answer rather than a second sync of their own.) Where a read needs to know what week it is, derive it from
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

Two details it carries so callers don't have to. It returns `username` **as
spelled in the URL**, because Sleeper resolves a user id as readily as a name and
that is the string worth putting in a log line (the `ktc` route does). And it
parses `season` for all six including the base route that ignores it — one string
read is cheaper than a second entry point, and the routes that want more of the
query string get `searchParams` itself (`leagues` reads `?refresh=1` off it).

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

**A second and third entry point is how that drift arrives at scale.** Once
`outlook` grew `getWeeklyTeamPoints` and `getOptimalLineups` beside
`getLeagueOutlook`, four rules were retyped once per entry point — the IR/taxi
exclusion, the projectable-league guard, the player-id union, and which slots the
solver recognises — and none of the three copies was tested, because the
composition file deliberately has no test. They live once now:
`projections/candidates` owns `lineupCandidates`, `isProjectable` and
`rosterPlayerIds`, and `optimal` owns `recognisedSlots` (which `compareLineup`
had also spelled out inline, and which can't live in `candidates` without a
cycle). What that buys is not lines — the extraction is roughly line-neutral —
but that `getWeeklyTeamPoints` can no longer disagree with `getLeagueOutlook`
about who is allowed to start, and that a new Sleeper reserve category is one
edit with a test over it rather than three edits and a hope.

Two details worth keeping. `lineupCandidates` takes the scorer as a callback,
because the three callers want different numbers off the same roster — a season
aggregate, a per-league score of it, or nothing at all where the weekly solve
re-scores every candidate itself — and that difference is the only thing that
varied between the copies. And `isProjectable` is a **type predicate**, so
`leagues.filter(isProjectable)` narrows: the three `scoringSettings!` /
`rosterPositions!` assertions that used to re-assert what the filter had just
checked are gone, which is the compiler agreeing that the guard and the use are
now the same fact.

The shared *reads* behind those two batch entry points sit in `readBatchInputs`,
still inside the composition file and private to it. That is the right side of
the line: it is I/O and nothing else, so there is nothing in it to test.

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
- **Keyframes live in `globals.css`, not beside the component that uses them.**
  Tailwind v4 has no per-component keyframe mechanism, so `FlaskLoader`'s four
  animations are named there once and the component references them through
  inline `animation`. Two habits travel with that. Per-element timing (a
  bubble's duration and delay) stays in the component as data, since a keyframe
  can't carry it and a class per bubble would be four near-identical rules. And
  an SVG shape animated with `transform` needs `transform-box: fill-box`
  (`.flask-bub`) or `translateY`/`scale` pivot on the SVG root rather than the
  shape — the bubbles would fly across the flask instead of rising in it.
- **A decorative animation freezes under `prefers-reduced-motion`, it doesn't
  disappear.** The media query in `globals.css` kills `animation` on
  `.flask-loader *`, which leaves a static flask that still reads as a loading
  mark — the bubbles rest at their keyframe start (opacity 0), so what remains
  is the glass. Dropping the whole indicator would take the *status* away from
  the reader who asked for less motion, which is not what they asked for.
- **The flask's glass is the `active` token; its liquid is literal hex, and that
  is the exception rather than a lapse.** `@theme` registers exactly two colors,
  `active` and `foreground`, so a two-stop gradient — a lighter top and a darker
  bottom, plus a surface and a bubble tint — has no token to read, and the
  logo's magenta isn't registered at all. Those five values live in one `TONES`
  table in the component instead of being sprinkled through the markup, which is
  what keeps the exception containable. Anything that isn't a gradient stop still
  takes the token: the outline, the fill wash and the highlight all resolve
  `var(--color-active)` / `var(--color-foreground)` so a retheme reaches them.
- **A pure-SVG component is not a client component.** `FlaskLoader` has no
  interactivity, so it renders on the server too and stays out of the bundle;
  what makes that safe is `useId` for its gradient and clip ids, so two loaders
  on one page can't collide over a hardcoded `id`. Reach for `"use client"`
  when there's state or a handler, not because a component draws.
- **The tools page's account section resolves in place; the other two searches
  navigate.** `ManagerSearch` and `PicktrackerSearch` hand what you typed to a
  route and let the destination resolve it, so a typo is only discovered as a
  failed page. `UserLookup` *is* the destination: it asks `/api/user/[username]`
  who that is and shows the avatar and canonical `@username` back, because
  Sleeper resolves a user id as readily as a name — what you typed is not proof
  of who you meant, which is what makes the extra request worth making before a
  tool is picked. A resubmit aborts the lookup still in flight, or the slower
  response wins whichever was asked for last. That resolved identity is now what
  the section is *for*: `ToolsHome` holds it and hands it down, so the extra
  request buys the grid below something and not just a confirmation.
- **That account is the app's only client-side persistence, and it is a
  `useSyncExternalStore` over one `localStorage` key.** A reload, or a trip out
  to a tool and back, used to drop you at an empty search box — with the grid
  gated on the account, that made the gate feel like a wall. Three details are
  load-bearing and easy to undo by "simplifying" the store away. The server has
  no storage, so `getServerSnapshot` returns null and the account appears only
  after hydration — reading `localStorage` during render is the hydration
  mismatch this shape exists to avoid. The snapshot is the **raw string**, parsed
  in a `useMemo` keyed on it, because `useSyncExternalStore` compares snapshots
  by identity and a fresh `JSON.parse` per read looks like a change every render
  and loops. And `storeUser` notifies its own listeners by hand, since the
  `storage` event fires in *other* tabs but never the one that wrote. Only the
  resolved `UserInfo` is kept; leagues re-derive from `user_id`. Writes are
  wrapped in `try`/`catch` because storage can be blocked — persistence here is a
  convenience, never correctness.
- **The account is the key to the whole grid: every card is inert until one
  resolves.** Each tool reads that account, so `ToolGrid` passes `disabled={!user}`
  and `ToolLinkCard` renders an `aria-disabled`, dimmed `div` instead of a
  `Link` — there is nothing useful behind any of these cards without knowing
  whose leagues to read. What resolving unlocks differs by tool, which is where
  the two overrides come in: the manager card takes an `href` override straight
  to `/manager/<username>/leagues`, skipping the username search it would
  otherwise land you on (you just typed that name — asking twice is the drift
  `UserLookup` exists to prevent), and the pick tracker gets `PicktrackerCard`
  instead, listing the account's leagues inline because a league *id* is the one
  thing a username does **not** give you and the account already knows every one.
  Its picker is its own gate — there is no way to the tracker without choosing a
  league — so it needs no `disabled` state of its own once an account is in hand.
- **The tools grid no longer links to manual league-id entry, but the page is
  still there.** `/picktracker` (the `page.tsx`, distinct from
  `/picktracker/[leagueId]`) takes a raw id and still answers; gating the grid
  only took away the *link* to it. That path is worth remembering before treating
  the route as dead code: it is how the tracker opens from a league chat
  mid-draft, where there is a league id in the URL bar and no Sleeper account in
  hand. If the no-account state should reach it again, that is a deliberate
  exception to the gate above and not a bug in it.
- **`useUserLeagues` is not `useManagerLeagues`, for the reason the four manager
  sub-resource hooks *are* one hook.** Both decode the same NDJSON stream off
  `/api/user/[username]/leagues`, but the picker wants the list and none of the
  progress-bar machinery the manager tool's header is built around, and it clears
  `loading` on the first `result` rather than waiting out a background refresh
  that may still be syncing — a menu is fillable from the cached copy. Two hooks
  that differ in what they guarantee are two hooks; two that differ only in a URL
  are one.
- **The three manager tabs are one scaffold, `LeaguesViewLayout`, over one hook,
  `useFilteredLeagues`.** Leagues, players and leaguemates were line-for-line
  copies of the same chrome — wide shell, cold-load state, header and count line,
  filter bar, the note that stands in when the filters match nothing — and three
  copies of that are one edit away from disagreeing about how a failed refresh or
  an empty account looks, which reads as a bug in whichever tab didn't get
  edited. Only three things ever varied: the count line, the body, and that the
  leagues tab says "X of Y" when narrowed. The body is `children` rendered
  *below* the empty-filter check, so a tab only ever reasons about a non-empty
  list. The split between the two is deliberate: the layout is the chrome, the
  hook is the state behind it, and `filtered` stays a value the page can read
  because the players and leaguemates shares memoise on it — buried in the chrome
  it would be out of reach.
- **The filter selection outlives the tab you chose it on, because the three tabs
  are three routes.** Held in each view, a filter snapped back to the default the
  moment you moved between Leagues, Players and Leaguemates — the same league set
  narrowed three ways, re-narrowed by hand each time. So `LeagueFiltersProvider`
  is mounted once in `app/manager/[searched]/layout.tsx` and `useFilteredLeagues`
  reads it through `useLeagueFilters` instead of holding `useState` of its own.
  What makes the shared state safe is where it is mounted: the layout is keyed by
  the searched manager, so the selection follows you across tabs but still starts
  fresh when you look at someone *else* — a per-manager reset, not a global one.
  `useLeagueFilters` throws outside that provider rather than falling back to the
  defaults, since a silent fallback is a filter bar that renders fine and quietly
  moves nothing.
- The expanded league panel uses container queries (`@lg:`), not viewport
  breakpoints, because it renders at half width inside a card.
- **Every `/manager/[searched]/…` view renders one `ManagerHeader`.** Who is
  being looked at, the season and the sync state are the same facts on all of
  them; only the count line under them differs, which is what `children` is. The
  tabs live there because they are what makes a second view reachable, and they
  link with the URL's own spelling of the manager rather than the resolved
  username, since Sleeper resolves a user id as readily as a name.
- **`SiteHeader` is the only global chrome, and it is one link.** Every tool is
  reached by navigating away from `/tools`, which used to leave the back button
  as the only way home; the slim bar in `app/layout.tsx` closes that loop. It
  hides itself on `/tools` — a link to the page you are on is noise, and that
  page leads with its own header — which is the whole reason it reads
  `usePathname` and therefore the whole reason it is a client component. Its
  container matches `PageShell`'s so the wordmark lines up with the content under
  it. This does **not** make it a nav: the manager tabs still carry movement
  between manager views, and adding routes here would put two navigation systems
  on the same page.
- **The four manager sub-resource hooks are one hook, bound four ways.**
  `useManagerPlayers`, `useManagerLeaguemates`, `useManagerRanks` and
  `useManagerKtc` read `/api/user/[username]/{players,leaguemates,ranks,ktc}`,
  and they were four line-for-line copies differing only in the path and the
  error string. They delegate to `useManagerResource` now, with each file keeping
  its name, its result type and a note on what its route is for. The shared body
  is not boilerplate — it carries two rules worth having in one place: every one
  of these resources reads what the *leagues stream* wrote, so the hook takes the
  leagues array and its identity is what re-runs the fetch (a ready flag couldn't
  re-trigger on the second `result` a background refresh sends); and `data` is
  never reset to null on refetch, because blanking several hundred rows to redraw
  them nearly unchanged is worse than a moment of staleness. `useLeagueDetail`
  looks like a fifth copy and is not one: it *does* clear on change, since a new
  league id means the rows on screen belong to a different league, and it tracks
  `loading` because its panel mounts on expand. `useManagerLeagues` is not one
  either — it decodes an NDJSON stream. Two hooks that differ in what they
  guarantee are two hooks.
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
- **A leaguemate is shared by membership, though a player share is counted by
  roster — the opposite choices on purpose.** The ghost `league_users` rows that
  would deflate a player share are exactly who this page is for: someone
  knocked out of your guillotine league is still someone you know, and dropping
  them because they no longer hold a team answers a different question. So
  `leaguemateShares` (pure, beside `shares`) counts co-membership over the
  filtered leagues, and its denominator is leagues that contributed a member
  list. The manager's own row is *kept* in `members` — every synced league has
  it, so its presence is what separates "shared with nobody" from "not cached" —
  and dropped by the counting, which takes the self id as an argument for it.
  Rows are labelled by `display_name` per the standings rule (recognising the
  same person across leagues is the page), and the list itself is the player
  shares list with a person in the player column: same grid, same two numbers,
  same expansion.
- **Both share views *are* `ShareList`.** The grid template, the heading row, the
  count-and-percent cells and the expansion were copied between
  `player-shares` and `leaguemate-shares` — only the heading word and the first
  column's contents ever differed — so they live once in `share-list.tsx` and each
  view is now ~30 lines naming its own column. Two copies of a grid template is
  one width change away from the headings sitting over the wrong numbers in
  whichever file didn't get edited, and that would look like a data bug rather
  than a CSS one. What a caller supplies is `icon` (a position pill, an avatar)
  and an optional `note` — the dim trailing detail, which is the NFL team on a
  player row and nothing on a person. The name span and its truncation stay in
  `ShareList`, since losing the name is the failure both lists are laid out to
  avoid. `Chevron` and `SharedLeagueRow` remain in `ui.tsx`: the standings and the
  roster panel use them too, so they are atoms rather than part of this table.
- **The expanded standings are ordered by projected points, not by record.**
  What the panel adds over Sleeper is the projection, so the Proj column is the
  one the rows are ranked on — the numbers descend down the page, and the `#`
  column numbers the same ranking the collapsed card's chip quotes. The record
  isn't lost, it keeps its grid column on every row's second line. The sort
  (`orderByProjectedPoints` in `shared/manager/rank.ts`, pure and tested) is
  stable over the standings order the server sends, so ties, unprojected teams
  and a league with no outlook at all degrade to the standings rather than to a
  shuffle.
- **The collapsed card's stat columns are four slots the reader aims, not four
  fixed rankings.** `league-metrics.ts` is the catalogue of what a slot can hold
  and how to read it off the cached ranks and KTC value — the card hard-coded
  record, points, KTC starters and projected points, which answers where a roster
  places on four axes and nothing about the shape behind them. Three things to
  keep. The list holds **two shapes on purpose**: a `rank` metric is `#N of M`,
  tinted and metered against its league, while a `value` metric is a bare number
  with no field to place it in (bench value, the raw points behind a rank) — same
  menu, different cells, because "3rd of 12" and "41,200" are not comparable
  claims. The selection lives in `ManagerLeagues`, not per card, so the columns
  line up down the list and one picker moves them all — per-card columns would
  make the list unreadable vertically, which is the axis it is scanned on. And
  the module keeps the pure-and-tested bar its neighbours `shares` and `filters`
  hold: everything from `./types` arrives as an erased `import type`, so the
  accessors test without a fetch (`league-metrics.test.ts`).
- **The rank metrics come from one batch route,
  `/api/user/[username]/ranks`.** A collapsed league costs no request — the
  panel loads on expand — and a hundred cards each fetching a league detail to
  learn one number would undo that; ranking also needs every *other* team's
  total, which is why the client can't derive it from anything it already has.
  The batch (`getManagerLeagueRosters` → `getWeeklyTeamPoints`) reads the
  remaining weeks, stat lines and positions once for the union of every roster
  and runs only what genuinely differs per league — scoring and lineup solves —
  so it isn't `getLeagueOutlook` in a loop. The numbers ranked are
  `weekly_optimal_points` and `weekly_bench_points` under each league's own
  scoring, through the same pure modules as the panel's Proj column, so card and
  table can't disagree. Ties share the better rank (two at 250.0 are both #1),
  and a league where every total is zero gets *no* rank — pre-draft, "1st of 12"
  would dress an empty league up as a lead (`projectedRank`, tested).
- **The bench half rides along because the solve already had it.**
  `getWeeklyTeamPoints` returns `bench` beside `points` from one weekly solve, so
  ranking a roster by depth costs nothing beyond carrying the map — it was being
  discarded in the batch path. It is worth ranking for the reason the KTC chip
  splits into three: two teams level on projected starters are not the same team
  when one carries twice the production it isn't playing. `proj_bench` is null on
  exactly the terms `proj` is, which includes the case that matters — a shallow or
  undrafted league where every bench prices at zero gets no rank rather than an
  arbitrary #1. Note the two views read it differently on purpose: `standings`
  still shows bench as dimmer *context* beside `Proj`, while a card column ranks
  it outright. A number can be context in a table that is already ranked on
  something else, and the answer in its own column.
- **The card's KTC chip is three numbers, and the bench one is a subtraction.**
  A total says nothing about shape: two rosters worth 40k are not the same roster
  when one can start 30k of it and the other is depth behind a thin lineup. So
  `/api/user/[username]/ktc` sends `total`, `starters` and `bench`, with `bench`
  computed as `total − starters` so the three always reconcile — everything not
  in the lineup lands there, IR and taxi included, which is the honest reading of
  "value this roster holds and cannot play" even though the roster panel lists
  those under headings of their own. The starting half is summed by walking the
  *roster* and asking whether each player starts, never by walking the lineup, so
  a lineup naming someone the roster doesn't hold can't hand back a negative
  bench (`rosterKtcValue`, tested). Its cell goes blank when nothing is priced,
  on the same terms as a rank metric: a pre-draft roster is empty and KTC's board
  is skill players only, so "0 ktc" would dress both up as a claim about the
  team.
- **The KTC metrics are batched like the rank ones, and for the same reason.** A
  collapsed card costs no request, so a hundred of them each fetching a value
  would undo that. The route reads `getManagerLeagueRosters` and drops every team
  but the manager's own *before* the projections read — a hundred leagues of
  twelve rosters is twelve times the lineup solving for eleven answers nobody
  asked for. `getOptimalLineups` is the third entry point in `projections/outlook`
  beside `getLeagueOutlook` and `getWeeklyTeamPoints`, and it is the cheapest of
  the three per team: the aggregate lineup is ranked on a season total, so the
  stat lines are summed once for the whole account (scoring is linear, so a
  player's aggregate is league-independent) and each league scores that sum once
  per player, where the weekly totals need a solve per team per week. It returns
  the same lineup the expanded panel lists as Starters, so a chip and the card it
  opens can't disagree about who starts. Its failure costs the split and not the
  value — pricing a roster needs no projection, so the totals still answer, which
  is why `split` is nullable rather than the whole league being dropped.
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
- **KTC prices ~500 dynasty skill players, so a roster total is never the whole
  roster.** 93.7% of the players on rosters here carry a price; the shortfall is
  IDP (LB, DB, DL, DE) plus the deep end of every skill position, and kickers and
  defences are off the board entirely. A total therefore ships with the count
  behind it — `priced` of `rostered` — rather than passing as complete, the same
  habit as sending `outlook.weeks` alongside a projection. It is also a *dynasty*
  board and the only one this app scrapes, which is the wrong lens on the redraft
  leagues sitting in the same list, so anything showing the number says
  "dynasty" rather than leaving it to be inferred.
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
  recommending a lineup Sleeper would reject. Exclude IR and taxi from the
  candidates for the same reason.
- **An optimal lineup that is arbitrary about interchangeable slots reads as a
  mistake.** The matching is free to seat the worse of two backs at RB1, or a
  15-point back in FLEX with a 14-point back at RB — same total, but as advice it
  looks wrong and diffs against a sane current lineup as pointless moves. So the
  answer is canonicalised: better player to the stricter slot, and among equally
  strict slots to the earlier one.
