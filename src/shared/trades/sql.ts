import type { TradeCircleScope } from "./circle.ts";
import type { TradeQuery, TradeSideQuery } from "./params.ts";

/**
 * The SQL the trades board is read through, as fragments rather than as
 * finished statements.
 *
 * It is a module of its own because five reads share one definition of "the
 * trades on this board" — the page, the total, the league-scope total, the
 * league list and the filter facets — and the guarantee that matters is that
 * they cannot come to different views of it. That used to be enforced by a
 * single `TRADES_POPULATION_SQL` constant two queries interpolated; with server
 * side filtering there are more consumers and a *builder*, so the constant grew
 * into this.
 *
 * Every value still arrives as a bound parameter. The builder pushes onto a
 * params array and binds the index it returns (`` `$${params.push(value)}` ``),
 * the same habit `shared/manager/adp` follows: the validated query decides which
 * fragments exist, and nothing a caller sent is ever spliced into a string.
 */

/**
 * A league's *first* draft, for leagues that have no previous season — the
 * startup, whose status and last pick are the boundary trades are dropped
 * before.
 *
 * Three decisions are packed into this, and each one is a way of getting it
 * wrong:
 *
 * - **The first draft, not the latest.** An inaugural dynasty league can run a
 *   rookie draft after its startup in the same league year, and taking the later
 *   draft's last pick would hide months of real trades between the two. Ordering
 *   by `start_time` with nulls last picks the startup and leaves an undated stray
 *   draft as the fallback rather than the answer.
 * - **No previous league is what makes a draft a startup.** A continuing dynasty
 *   league's draft is a rookie draft — additive to rosters that already exist —
 *   so it bounds nothing and the league is simply absent here. Sleeper spells the
 *   empty case as null, `''` and `'0'` depending on vintage, so all three read as
 *   "no previous season".
 * - **The row is selected whatever it holds, and the reading happens in the
 *   `WHERE`.** `last_picked` alone can't say whether the startup is over, so the
 *   status has to travel with it; filtering the unusable rows out here is what
 *   left an unfinished startup looking like a league with no boundary at all.
 *
 * `$1` is the season.
 */
export const STARTUP_DRAFT_SQL = `
  SELECT DISTINCT ON (d.league_id) d.league_id, d.last_picked, d.status
    FROM drafts d
    JOIN leagues l ON l.league_id = d.league_id
   WHERE l.season = $1
     AND coalesce(l.previous_league_id, '') IN ('', '0')
   ORDER BY d.league_id, d.start_time ASC NULLS LAST, d.draft_id`;

/**
 * {@link STARTUP_DRAFT_SQL} as the `WITH` header every read here opens with.
 *
 * Four queries wrote out the same clause, which is four chances for one of them
 * to name the CTE differently from the population fragment that reads it — and
 * that failure is a syntax error in only one of the two directions. The facets
 * read appends a second CTE to it, so this is the header and not the whole
 * `WITH`.
 */
export const STARTUP_DRAFT_CTE = `WITH startup_draft AS (${STARTUP_DRAFT_SQL})`;

/**
 * The season/status/startup half of the `WHERE` — what is on this board before
 * a reader narrows anything.
 *
 * `$1` is the season. See {@link STARTUP_DRAFT_SQL} for what each half of the
 * boundary is doing and why both columns stay inert when they say nothing.
 *
 * **Written as correlated `EXISTS` subqueries rather than as joins, and that is
 * the difference between a page being an index walk and being a scan of the
 * season.** With a `JOIN leagues` and a `LEFT JOIN startup_draft` above it, the
 * `ORDER BY` sits over a join tree and the planner cannot satisfy it from
 * `transactions_trade_keyset_idx` — it hash-joins, collects the whole
 * population and takes a top-N heapsort, which costs the same on page 40 as on
 * page 1. As `EXISTS` filters the ordering is over `transactions` alone, so the
 * plan is an ordered index scan with the filters applied per row and a `LIMIT`
 * that stops it. Measured on 320k transactions holding 20k trades for the
 * season: **23.2ms and 518 buffers as joins, 0.33ms and 21 buffers as `EXISTS`**
 * for the first page — and the join form's cost grows with the season while the
 * `EXISTS` form's does not.
 *
 * The rewrite is exact rather than approximate, which is worth checking against
 * the join form it replaced: a trade was kept when there was no startup row *or*
 * the row permitted it, so it is dropped exactly when a startup row exists and
 * rejects it — which is what the `NOT EXISTS` says. Both halves keep their
 * null-inertness, spelled the other way up.
 *
 * The counting queries lose nothing by sharing it (measured at 9.0ms against
 * 9.8ms for the join form over the same data), so there is one population and
 * not two — which is the guarantee this constant exists for.
 */
export const TRADES_POPULATION_SQL = `
   FROM transactions t
  WHERE t.type = 'trade' AND t.status = 'complete'
    AND EXISTS (SELECT 1 FROM leagues l
                 WHERE l.league_id = t.league_id AND l.season = $1)
    -- The startup boundary, written as "no startup row *rejects* this trade".
    -- A continuing dynasty has no startup row, so nothing can reject it.
    AND NOT EXISTS (
      SELECT 1 FROM startup_draft sd
       WHERE sd.league_id = t.league_id
         -- An unfinished startup rejects the lot; a status Sleeper didn't send
         -- is unknown, and unknown stays inert rather than hiding a league.
         AND ((sd.status IS NOT NULL AND sd.status <> 'complete')
              -- Inert on an absent bound: no last pick stored is no cutoff.
              -- Comparing above zero reads a zero as the absent value Sleeper
              -- means by it, not as 1970.
              OR (sd.last_picked IS NOT NULL AND sd.last_picked > 0
                  -- The undated case is a decision and not a side effect: a
                  -- trade Sleeper filed with no timestamp has no honest side
                  -- of this boundary, so a league that has one drops it — the
                  -- same rule the date filters and /api/adp follow for an
                  -- undated draft.
                  AND (coalesce(t.status_updated, t.created) IS NULL
                       OR coalesce(t.status_updated, t.created) <= sd.last_picked))))`;

/**
 * The board's sort key, folded so that it is never null.
 *
 * Sleeper stamps a completed trade with `status_updated` and leaves `created` as
 * the only timestamp on some older rows, and files a few with neither. The old
 * route sorted `DESC NULLS LAST`; folding the null to zero puts those rows in
 * exactly the same place while making the ordering a total order on a `bigint`,
 * which is what a keyset resume predicate needs — a row comparison against a
 * null propagates null and silently skips the undated tail.
 *
 * `transactions_trade_keyset_idx` is ordered on this expression, so a page is an
 * ordered index walk rather than a sort.
 */
export const TRADE_SORT_SQL = `coalesce(t.status_updated, t.created, 0)`;

/** The columns `assembleTrade` reads, cast out of `BIGINT`'s string form. */
export const TRADE_COLUMNS_SQL = `
  t.transaction_id, t.league_id, t.week,
  t.created::float8         AS created,
  t.status_updated::float8  AS status_updated,
  t.roster_ids, t.adds, t.draft_picks, t.waiver_budget`;

/** A jsonb column read as an array, or an empty one where it is anything else. */
const asArray = (column: string) =>
  `CASE WHEN jsonb_typeof(${column}) = 'array' THEN ${column} ELSE '[]'::jsonb END`;

/**
 * The same guard for an object, which `adds` is.
 *
 * It is a function for the reason {@link asArray} is: `jsonb_each_text` and
 * `jsonb_object_keys` both error outright on a value that isn't an object, so
 * one league holding junk in that column would fail the whole read rather than
 * cost that trade its players. Two call sites — the players facet and the
 * per-side exhaustiveness check — and two spellings of a guard is how one of
 * them comes to be missing it.
 */
const asObject = (column: string) =>
  `CASE WHEN jsonb_typeof(${column}) = 'object' THEN ${column} ELSE '{}'::jsonb END`;

/** `{season, round}` as the `"2026-1"` token a pick filter holds. */
const PICK_TOKEN_SQL = `((p->>'season') || '-' || (p->>'round'))`;

/**
 * A jsonb roster id as the integer `rosters.roster_id` is, or null where it
 * isn't one.
 *
 * **Guarded with `CASE`, never with a `WHERE` beside the cast**, and the
 * difference is not stylistic: Postgres does not promise to evaluate a `WHERE`
 * predicate before an expression elsewhere in the same query, so
 * `… = ri::int WHERE ri ~ '^[0-9]+$'` can reach the cast with a value the regex
 * was there to remove — and an invalid-input error fails the *whole* read rather
 * than skipping one league. `CASE` short-circuits by definition, so a junk id
 * yields null, matches nothing, and costs that trade its manager rather than
 * costing every reader the board.
 *
 * It is one function because three reads ask it — the sides filter, the circle's
 * `traders` shape and the managers facet — and two spellings of the same guard
 * is how one of them came to be missing it.
 */
export function rosterIdIntSql(alias: string): string {
  return `(CASE WHEN ${alias} ~ '^[0-9]+$' THEN ${alias}::int END)`;
}

/**
 * The reader's narrowing, as `AND`-joined SQL, pushing its values onto `params`.
 *
 * Every fragment is a *narrowing*, so an absent one contributes nothing — which
 * is what makes the unnarrowed board (the state the page opens in) exactly the
 * old query with a `LIMIT` on it.
 *
 * `circle` arrives already resolved (see `./circle`), because it is the one
 * narrowing whose value is a database answer rather than something the caller
 * could hold: "my leagues" is a query, not a list a browser has. It is passed
 * rather than looked up here so this stays a pure function of its arguments.
 *
 * The three selection categories are joined by the query's own `match` mode,
 * which is the one place the fragments are not simply `AND`ed: `all` and `any`
 * are both real questions ("did these two managers trade with each other" against
 * "anything involving any of these three players"), and the mode covers the whole
 * selection rather than one category each. The **window is not one of the
 * alternatives** — it always narrows, because it is a bound rather than a
 * selection — which is the same rule the client-side predicate has always
 * followed.
 */
export function tradeFilterSql(
  query: TradeQuery,
  params: unknown[],
  circle: TradeCircleScope | null = null,
): string {
  // The two halves in the order they have always been emitted, so the string
  // this returns is byte-for-byte what it returned before the split and the
  // params land on the same indices.
  return join([
    ...tradeScopeClauses(query, params, circle),
    ...tradeNarrowingClauses(query, params),
  ]);
}

/**
 * The *scope* half of the narrowing: the league filters' answer and the
 * reader's circle, and nothing they picked off a list of trades.
 *
 * It is the population the page's headline reads "N of M" against — see
 * `leagueScopeQuery` — and it is separated from {@link tradeNarrowingSql} so
 * that both denominators can be counted in one pass over it rather than in two
 * passes over nearly the same rows. Splitting is safe precisely because these
 * clauses already came first: `tradeFilterSql` is the two concatenated.
 */
export function tradeScopeSql(
  query: TradeQuery,
  params: unknown[],
  circle: TradeCircleScope | null = null,
): string {
  return join(tradeScopeClauses(query, params, circle));
}

/**
 * The *selection* half: the window and the player/pick/manager choices, as a
 * bare boolean rather than as an ` AND `-prefixed fragment.
 *
 * Bare because its second caller is a `FILTER (WHERE …)` on an aggregate, where
 * a leading `AND` is a syntax error. Empty means nothing was selected, which the
 * caller reads as "this count is the scope count" rather than binding a
 * tautology.
 */
export function tradeNarrowingSql(query: TradeQuery, params: unknown[]): string {
  return tradeNarrowingClauses(query, params).join(" AND ");
}

/** `AND`-joined and prefixed, or empty where nothing narrows. */
function join(clauses: string[]): string {
  return clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
}

function tradeScopeClauses(
  query: TradeQuery,
  params: unknown[],
  circle: TradeCircleScope | null,
): string[] {
  const clauses: string[] = [];
  const bind = (value: unknown) => `$${params.push(value)}`;

  if (query.leagues !== null) {
    clauses.push(`t.league_id = ANY(${bind(query.leagues)}::varchar[])`);
  }
  if (query.excludeLeagues !== null) {
    clauses.push(`NOT (t.league_id = ANY(${bind(query.excludeLeagues)}::varchar[]))`);
  }

  if (circle !== null) {
    // `AND`ed with everything rather than joined into the selection below, for
    // the reason the window is: it is where the reader is standing, not one of
    // the things they picked out of a list. "Any of these two players, in my
    // leagues" is the only reading of a circle and a selection together.
    clauses.push(circleSql(circle, bind));
  }

  return clauses;
}

function tradeNarrowingClauses(query: TradeQuery, params: unknown[]): string[] {
  const clauses: string[] = [];
  const bind = (value: unknown) => `$${params.push(value)}`;

  // Spelled with the `IS NOT NULL` rather than left to comparison semantics,
  // because an undated trade being dropped by *any* bound is a decision — the
  // same one `/api/adp` makes about an undated draft, and the one the client's
  // `tradeMatches` makes. `coalesce(…, 0)` would put it in 1970 and let a
  // `to` bound keep it.
  //
  // **It is deliberately not {@link TRADE_SORT_SQL}, and that is what keeps
  // `transactions_trade_recency_idx` earning its place.** That index is ordered
  // on this two-argument expression; the keyset index is ordered on the
  // three-argument one, and to the planner those are different expressions, so
  // only the older index can serve a *range* on this. The board itself never
  // needs that — its `ORDER BY` pins it to the keyset walk — but the narrowed
  // counts and the facet aggregates have no `ORDER BY` at all, so a windowed
  // board's denominators read this as an index range rather than as a filter
  // over every trade in the season. Changing the spelling here to match the sort
  // would make the old index droppable and those counts a full scan; see
  // `sql.test.ts`, which pins each expression to the migration that indexes it.
  const at = `coalesce(t.status_updated, t.created)`;
  if (query.from !== null) {
    clauses.push(`(${at} IS NOT NULL AND ${at} >= ${bind(query.from)})`);
  }
  if (query.to !== null) {
    clauses.push(`(${at} IS NOT NULL AND ${at} < ${bind(query.to)})`);
  }

  if (query.sides.length > 0) {
    // The index-friendly half first, so the planner still has something
    // selective to walk before any of the per-side work below runs. See
    // {@link playersPresentSql}.
    const present = playersPresentSql(query, bind);
    if (present !== null) clauses.push(present);
    clauses.push(sidesSql(query.sides, query.match === "all", bind));
  }

  return clauses;
}

/**
 * Every named player is in `adds`, whichever side took them —
 * `transactions_trade_adds_idx` answers this and nothing below it can.
 *
 * **It is redundant with the side predicates and it is what makes them
 * affordable.** The side check compares `adds->>'<id>'` to a roster id, which is
 * a per-row expression the GIN index cannot serve: on its own it would take the
 * whole population and filter it. This narrows to the trades that name the
 * players at all — usually a handful out of a season — and the sides then decide
 * which way they went.
 *
 * **Under `all` it is one exact test; under `any` it is per bay, and only for
 * the bays it can honestly speak for.** `all` requires every named player
 * wherever it sits, so `?&` over the pooled list is exact. `any` satisfies a bay
 * with any *one* of its assets — so a bay that also names a pick can be
 * satisfied without a single one of its players being in `adds` at all, and
 * pooling it into a `?|` made that pre-filter a *wrong* condition rather than
 * merely a loose one: "Nabers or a 2027 first" silently dropped every trade
 * whose side took the pick and not the player. Only a bay naming **no** pick is
 * guaranteed to put one of its own players there, so only those contribute, one
 * clause each — which is also strictly more selective than the pooled form they
 * replace, since the bays are conjunctive.
 *
 * Null where nothing can be claimed, since a filter of `?& '{}'` is a tautology
 * with a cost — and under `any`, a bay that names a pick simply buys no index
 * help, which is the price of the condition being true.
 */
function playersPresentSql(
  query: TradeQuery,
  bind: (value: unknown) => string,
): string | null {
  if (query.match === "all") {
    const players = query.sides.flatMap((side) => side.players);
    if (players.length === 0) return null;
    return `t.adds ?& ${bind([...new Set(players)])}::text[]`;
  }

  const clauses = query.sides
    .filter((side) => side.picks.length === 0 && side.players.length > 0)
    .map((side) => `t.adds ?| ${bind([...new Set(side.players)])}::text[]`);
  if (clauses.length === 0) return null;
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(" AND ")})`;
}

/**
 * The sides, as one nested `EXISTS` per side.
 *
 * Each level binds a roster of the trade and asks everything that side claims
 * against it: the assets it received, and whose it is. Nesting rather than
 * `AND`ing separate subqueries is what makes the sides *distinct* — two
 * independent `EXISTS` cannot compare their rosters to each other, so
 * `[jkap] ⇄ [Nabers]` would happily match a trade where jkap received Nabers.
 *
 * **It is driven off the trade's own columns, and that is the planner decision
 * the managers filter already learned.** `roster_ids` unnested, `adds` read as
 * jsonb, `rosters` touched only by primary key when a name is involved — so the
 * subquery is a function of `t` and cannot be pulled up, the board's `ORDER BY`
 * stays on `transactions_trade_keyset_idx`, and a page stays an ordered index
 * walk. Written the other way round — `FROM rosters WHERE league_id = t.league_id`
 * — it decorrelates, the planner hash-joins the season and top-N heapsorts it,
 * and every page costs the same as page forty. That shape measured 205ms against
 * 9ms on the identical question; see {@link circleSql}, which keeps the same
 * correlation over the stored mapping.
 *
 * **The manager half reads `trade_participants`, and it reads the *historical*
 * owner.** It used to look the roster up in `rosters` and compare today's
 * `owner_id`, which made "trades manager A was in" mean "trades made by
 * whoever's roster A happens to hold now" — so a roster changing hands moved
 * every one of its past trades from one manager's filter to another's. The
 * question a bay asks is about the past, so it is answered from the column that
 * records the past; see {@link tradeParticipantsRebuildSql} for how that column
 * is kept immutable, and the `1788000000008` migration for what Sleeper does
 * and does not make knowable.
 *
 * The planner note the old spelling carried survives the switch intact, because
 * the shape did: this is still a single correlated index lookup on a primary
 * key, on the board's hot path. `rosters` is keyed `(league_id, roster_id)` and
 * `trade_participants` `(transaction_id, roster_id)`, both fully bound from `t`
 * and `alias`, so the subquery is still a function of `t` and still cannot be
 * pulled up. What it needs to stay index-only is a covering index carrying
 * `owner_id_at_trade`, which the migration adds — the primary key's own
 * `INCLUDE` list names `owner_id` and cannot be altered.
 *
 * Four details in the level itself:
 *
 * - **Comparisons are text, so nothing is cast.** `jsonb_array_elements_text`
 *   flattens Sleeper's roster ids whether it sent numbers or strings, and
 *   `adds->>` and `p->>'owner_id'` come back in the same form. The one cast is
 *   the roster lookup, and it keeps the house regex guard so a junk id yields
 *   null and matches nothing rather than failing the board.
 * - **A side with a manager and no assets is exactly the old managers filter** —
 *   "a roster of this trade is owned by this person" — which is why that filter
 *   is gone rather than kept beside this.
 * - **Distinctness is against every previous side**, not just the one before, so
 *   a third side cannot quietly be the first one again.
 * - **A bay may also claim it took nothing else**, which is
 *   {@link sideOnlySql} — three `NOT EXISTS` correlated to the same `alias`, so
 *   the exhaustiveness is about the side the assets were checked against rather
 *   than about the trade.
 */
function sidesSql(
  sides: readonly TradeSideQuery[],
  all: boolean,
  bind: (value: unknown) => string,
): string {
  const level = (index: number): string => {
    const side = sides[index];
    const alias = `ri${index + 1}`;
    const conditions: string[] = [];

    const assets: string[] = [
      ...side.players.map((id) => `t.adds->>${bind(id)} = ${alias}`),
      ...side.picks.map(
        (token) => `EXISTS (
        SELECT 1 FROM jsonb_array_elements(${asArray("t.draft_picks")}) p
         WHERE ${PICK_TOKEN_SQL} = ${bind(token)}
           AND p->>'owner_id' = ${alias})`,
      ),
    ];
    if (assets.length > 0) {
      conditions.push(
        assets.length === 1 ? assets[0] : `(${assets.join(all ? " AND " : " OR ")})`,
      );
    }

    if (side.manager !== null) {
      conditions.push(`EXISTS (
        SELECT 1 FROM trade_participants tp${index + 1}
         WHERE tp${index + 1}.transaction_id = t.transaction_id
           AND tp${index + 1}.roster_id = ${rosterIdIntSql(alias)}
           AND tp${index + 1}.owner_id_at_trade = ${bind(side.manager)})`);
    }

    for (let prior = 0; prior < index; prior++) {
      conditions.push(`${alias} <> ri${prior + 1}`);
    }

    // Last of the claims about this roster, and deliberately after the cheap
    // ones: these three say what *didn't* happen, so they have nothing to
    // narrow with and every row reaching them is one the rest already kept.
    conditions.push(...sideOnlySql(side, alias, bind));

    if (index + 1 < sides.length) conditions.push(level(index + 1));

    return `EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(${asArray("t.roster_ids")}) ${alias}
       WHERE ${conditions.join(" AND ")})`;
  };

  return level(0);
}

/**
 * A side's `only` claim: nothing came this way but what the bay named.
 *
 * Three `NOT EXISTS`, one per kind of thing a roster can receive, each
 * correlated to that bay's own bound roster (`alias`) so it is the *same* side
 * the assets above were checked against. Empty where the bay is not making the
 * claim, or where it named no asset to make it about — the parser already drops
 * the flag in that second case, and this repeats the guard because a builder
 * that emits "received nothing at all" from a bay holding one manager is a
 * silently empty board.
 *
 * **Written as "nothing outside the named set", never as a count equality**, and
 * the difference shows up in three places:
 *
 * - It composes with `any` for free. Under `all` the assets above already
 *   require every named token, so this completes the set; under `any` it reads
 *   as "received one of these and nothing else", which is the same sentence and
 *   still a sensible question.
 * - A trade carrying **two** 2027 firsts satisfies `2027-1`. A token names a
 *   season and a round rather than a specific pick (see `pickLabel`), so both
 *   rows are the thing the reader asked for and a count of one would reject a
 *   trade that is exactly what they meant.
 * - An **empty** named list is not a tautology but its opposite: a bay naming
 *   only picks emits `NOT (a.key = ANY('{}'))`, true of every add, so the clause
 *   says "and no players at all" — which is what *only these picks* means.
 *
 * **FAAB counts as something else**, because the card draws it: a side the
 * reader asked to be only Nabers, drawn with `$25` under it, reads as the filter
 * leaking rather than as a sweetener being ignored. The amount is compared at
 * all — rather than any `waiver_budget` line addressed to the roster
 * disqualifying it — so that this and `assembleTrade` agree about what FAAB is,
 * since that sums `amount` into a side's `faab` and the card draws nothing at
 * zero. The cast is regex-guarded and falls back to zero, the house rule for a
 * number read out of one of Sleeper's blobs: an unreadable amount is inert
 * rather than quietly excluding a clean side.
 *
 * Comparisons are text throughout, the reading every other fragment here takes
 * of these columns — `jsonb_each_text` and `->>` both hand back text, and
 * `alias` is already text out of `jsonb_array_elements_text`, so Sleeper sending
 * a roster id as a number or as a string is flattened rather than cast.
 */
function sideOnlySql(
  side: TradeSideQuery,
  alias: string,
  bind: (value: unknown) => string,
): string[] {
  if (!side.only) return [];
  if (side.players.length === 0 && side.picks.length === 0) return [];

  const players = bind([...new Set(side.players)]);
  const picks = bind([...new Set(side.picks)]);

  return [
    `NOT EXISTS (
      SELECT 1 FROM jsonb_each_text(${asObject("t.adds")}) a
       WHERE a.value = ${alias}
         AND NOT (a.key = ANY(${players}::text[])))`,
    `NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(${asArray("t.draft_picks")}) p
       WHERE p->>'owner_id' = ${alias}
         AND NOT (${PICK_TOKEN_SQL} = ANY(${picks}::text[])))`,
    `NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(${asArray("t.waiver_budget")}) w
       WHERE w->>'receiver' = ${alias}
         AND (CASE WHEN w->>'amount' ~ '^-?[0-9]+$'
                   THEN (w->>'amount')::int ELSE 0 END) <> 0)`,
  ];
}

/**
 * Who was party to a trade — the mapping from the rosters a trade names to the
 * people a reader names, and the body of the `trade_participants` table.
 *
 * **This is the one place the mapping is derived, and it is derived on write.**
 * A trade names rosters in a jsonb array, and a jsonb array cannot be joined
 * to: read this way, every reader unnested `roster_ids`, cast each element
 * through the house regex guard and looked the roster up, once per candidate
 * trade — on the leaguemates circle, on the managers facet and on both
 * denominators, none of which has a `LIMIT` to stop the walk. Storing the
 * answer turns all four into an index lookup keyed by the trade, and moves the
 * unnest and the cast to the one place they are actually a fact about the data
 * changing: `writeLeagueGraph`, in the same transaction as the rows they read.
 *
 * Two properties of the derivation carry over unchanged, and both are worth
 * being able to point at:
 *
 * - **The owner is `rosters`' owner *now*.** A roster changing hands changes
 *   who its past trades are attributed to. That is what the join always said,
 *   and it is the only thing that can be said — Sleeper publishes no ownership
 *   history. It is also why the rebuild is not incremental on the new trades:
 *   an owner change rewrites the answer for trades nobody touched.
 * - **An orphan roster is absent rather than null.** It names nobody, which is
 *   what the old `WHERE r.owner_id IS NOT NULL` meant too.
 *
 * `jsonb_array_elements_text` is the forgiving read of the column, for free:
 * Sleeper has been seen to send roster ids as numbers and as strings, and this
 * flattens both. The regex guard sits **inside the join condition** rather than
 * in a `WHERE` beside it — the cast is what the index lookup is built from, so
 * it is evaluated whatever the planner does with a filter one level up, and
 * `CASE` short-circuits: a junk roster id yields null and matches nothing
 * rather than failing the whole statement.
 *
 * `where` is appended as-is by the one caller that narrows it (`$1` is the
 * league id for the per-league rebuild); the backfill migration runs it
 * unnarrowed, and `sql.test.ts` pins the two spellings together — the sync and
 * the backfill disagreeing about who was in a trade is silent in both
 * directions.
 */
export function tradeParticipantsSql(where = ""): string {
  return `SELECT DISTINCT t.transaction_id, t.league_id, r.roster_id, r.owner_id
  FROM transactions t
  CROSS JOIN LATERAL jsonb_array_elements_text(${asArray("t.roster_ids")}) ri
  JOIN rosters r
    ON r.league_id = t.league_id
   AND r.roster_id = ${rosterIdIntSql("ri")}
 WHERE t.type = 'trade' AND t.status = 'complete'
   AND r.owner_id IS NOT NULL${where}`;
}

/**
 * The per-league rebuild: refresh who holds each roster **now**, and write the
 * historical snapshot **once**.
 *
 * **This replaced a `DELETE` followed by an `INSERT`, and the delete was the
 * bug.** The derivation above reads `rosters.owner_id` as it stands, so wiping
 * the league's rows and re-deriving them on every sync meant a roster changing
 * hands re-attributed every trade that roster had ever been in. The old doc
 * comment named that consequence and called it "the only thing that can be
 * said", which was true of a table with one owner column and stopped being true
 * the moment a second one existed: Sleeper publishes no ownership history, but
 * *this database* has been watching, and what it saw when it first met the trade
 * is worth more than what it can see today.
 *
 * So the write is an upsert whose conflict clause names **only** the two facts
 * that are about the present:
 *
 * - `owner_id` — today's holder, refreshed every sync, which is what it always
 *   meant.
 * - `league_id` — carried so a row cannot be stranded under the wrong league,
 *   though nothing moves a trade between leagues.
 *
 * and **never** `owner_id_at_trade` or `owner_provenance`. The protection is
 * that there is no branch for a later edit to flatten — the same shape
 * `stampManagers` takes to keep `synced_at` out of a discovery pass. A row's
 * snapshot is written by its `INSERT` and by nothing else, for as long as the
 * row lives.
 *
 * `'ingest'` is what the insert claims for a new row, and it is a claim about
 * *provenance* rather than about accuracy: this is the roster's owner at the
 * moment the app first observed the trade. For a league that syncs regularly
 * that is the trade-time owner; for one first synced years after the fact it is
 * not, and the value is there so a reader can tell which they are looking at.
 * See the `1788000000008` migration.
 *
 * The derivation is reused verbatim as a subquery rather than restated, so the
 * rebuild and the backfill in `1788000000003` stay one definition of "who was in
 * this trade" — which is what `sql.test.ts` pins.
 */
export function tradeParticipantsRebuildSql(where = ""): string {
  return `INSERT INTO trade_participants
            (transaction_id, league_id, roster_id, owner_id,
             owner_id_at_trade, owner_provenance)
  SELECT d.transaction_id, d.league_id, d.roster_id, d.owner_id,
         d.owner_id, 'ingest'
    FROM (${tradeParticipantsSql(where)}) d
      ON CONFLICT (transaction_id, roster_id) DO UPDATE SET
         league_id = EXCLUDED.league_id,
         owner_id = EXCLUDED.owner_id`;
}

/**
 * Rows this league's trades no longer name, deleted.
 *
 * The reconciliation the upsert cannot do, and it is deliberately **not** the
 * complement of the derivation: it asks `transactions` alone, never `rosters`.
 * A pair drops out of the derivation for two very different reasons — the trade
 * stopped naming that roster (a re-fetched transaction whose `roster_ids`
 * changed, a trade that is no longer `complete`), and the roster is currently
 * orphaned. Only the first is a reason to forget the history; the second is a
 * fact about today, and {@link tradeParticipantsOrphanSql} is what records it
 * without throwing the snapshot away.
 *
 * `$1` is the league id.
 */
export const TRADE_PARTICIPANTS_PRUNE_SQL = `DELETE FROM trade_participants tp
 WHERE tp.league_id = $1
   AND NOT EXISTS (
     SELECT 1
       FROM transactions t
       CROSS JOIN LATERAL jsonb_array_elements_text(${asArray("t.roster_ids")}) ri
      WHERE t.transaction_id = tp.transaction_id
        AND t.league_id = tp.league_id
        AND t.type = 'trade' AND t.status = 'complete'
        AND tp.roster_id = ${rosterIdIntSql("ri")})`;

/**
 * A roster nobody holds any more reads as holding nobody.
 *
 * The derivation requires `r.owner_id IS NOT NULL`, so an orphaned roster
 * simply falls out of the upsert and its row would otherwise keep whichever
 * owner it last had — in a column that means *now*, which is the same wrong
 * claim in miniature that this whole migration is about. Written as its own
 * statement rather than folded into the upsert because it is the one case with
 * nothing to upsert from.
 *
 * `owner_id_at_trade` is untouched, which is the point: who dealt is still
 * known, and only who holds the seat today is not.
 *
 * `$1` is the league id.
 */
export const TRADE_PARTICIPANTS_ORPHAN_SQL = `UPDATE trade_participants tp
   SET owner_id = NULL
 WHERE tp.league_id = $1
   AND tp.owner_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM rosters r
      WHERE r.league_id = tp.league_id
        AND r.roster_id = tp.roster_id
        AND r.owner_id IS NOT NULL)`;

/**
 * Who was party to each trade on a page, as one object per trade.
 *
 * A correlated subquery in the page's `SELECT` list rather than a second round
 * trip, which is what makes historical attribution free: the target list is
 * evaluated after the ordered index walk and its `LIMIT`, so this runs a
 * primary-key lookup for the hundred rows the page actually returns and for
 * nothing else. A separate `getTradeParticipantOwners` read would be another
 * pooled connection on the request's critical path, which is the fan-out this
 * route spends its structure avoiding.
 *
 * `jsonb_object_agg` because a roster id is an integer and JSON keys are text;
 * `assembleTrade` reads it back through the same `asNumber` guard it reads
 * Sleeper's own blobs with. Null where the trade has no participant rows at all
 * — a league synced before the table existed, or one whose rosters were all
 * orphaned — which the assembler folds to "fall back to today's owner".
 */
export const TRADE_PARTICIPANT_OWNERS_SQL = `(
    SELECT jsonb_object_agg(tp.roster_id::text, tp.owner_id_at_trade)
      FROM trade_participants tp
     WHERE tp.transaction_id = t.transaction_id)`;

/**
 * One resolved circle as a `WHERE` fragment.
 *
 * The three shapes are three different questions and only the first is a plain
 * league test, which is the whole reason `resolveTradeCircle` hands back a
 * tagged value rather than a list of league ids:
 *
 * - **`leagues`** — the reader's own leagues, resolved by the manager module, so
 *   a comparison against `t.league_id` is the whole of it.
 * - **`members`** — leagues a leaguemate *belongs to*, whoever traded. Left as a
 *   membership test rather than resolved into league ids upstream because the
 *   id list would be every league of a few thousand people; `league_users`'
 *   primary key is `(league_id, user_id)`, so per candidate trade this is an
 *   index scan over one league's dozen rows.
 * - **`traders`** — trades a leaguemate was *party to*. A trade names rosters
 *   and this names people, and that mapping is now a **stored** one
 *   (`trade_participants`, derived by {@link tradeParticipantsSql} on write),
 *   so the filter is a lookup on that table's primary key rather than a jsonb
 *   unnest and a `rosters` join per candidate trade. That is the whole reason
 *   the table exists: this predicate runs over the *whole season* on the reads
 *   that have no `LIMIT` — the facets and both denominators — where it was the
 *   dominant cost even with `rosters_league_roster_owner_idx` under it.
 *
 *   **It reads `owner_id_at_trade`, not `owner_id`.** "Trades my leaguemates
 *   were in" is a question about the past, and answering it from present-day
 *   ownership meant a roster changing hands silently moved a season of trades
 *   from one person's circle into another's — see
 *   {@link tradeParticipantsRebuildSql}.
 *
 * All three are `EXISTS`/`ANY` filters over `transactions` alone, so the board's
 * `ORDER BY` is still satisfied straight from `transactions_trade_keyset_idx`
 * and a page is still an index walk that stops at the limit. **The `traders`
 * shape keeps its correlation for exactly that reason** — `tp.transaction_id =
 * t.transaction_id` makes the subquery a function of `t`, so it cannot be pulled
 * up. Written the decorrelatable way round (find the trades those owners were
 * in, then join) the planner takes it, hash-joins the season and top-N heapsorts
 * it, which measured 347ms against 30ms for one page on 1.2M transactions and is
 * flat in neither direction. A stored mapping makes that mistake *easier* to
 * make, not harder, since the table is finally joinable — the reads with no
 * `ORDER BY` are the ones free to do it, and `trade_participants_owner_idx` is
 * there for them.
 */
function circleSql(
  circle: TradeCircleScope,
  bind: (value: unknown) => string,
): string {
  const ids = bind(circle.ids);

  switch (circle.kind) {
    case "leagues":
      return `t.league_id = ANY(${ids}::varchar[])`;
    case "members":
      return `EXISTS (
        SELECT 1 FROM league_users lu
         WHERE lu.league_id = t.league_id
           AND lu.user_id = ANY(${ids}::varchar[]))`;
    case "traders":
      return `EXISTS (
        SELECT 1 FROM trade_participants tp
         WHERE tp.transaction_id = t.transaction_id
           AND tp.owner_id_at_trade = ANY(${ids}::varchar[]))`;
  }
}

/**
 * The keyset resume predicate: everything strictly after `(at, transaction_id)`
 * in the board's descending order.
 *
 * Written as a **row comparison** rather than as the expanded
 * `a < x OR (a = x AND b < y)`, because that is the form the planner recognises
 * as an index-ordered start position — the expanded version costs a filter over
 * the whole index range instead. It is safe here precisely because
 * {@link TRADE_SORT_SQL} folds the null away: a row comparison against a null
 * propagates null, and would drop the undated tail without a word.
 */
export function tradeCursorSql(
  cursor: { at: number; transaction_id: string },
  params: unknown[],
): string {
  const at = `$${params.push(cursor.at)}`;
  const id = `$${params.push(cursor.transaction_id)}`;
  return ` AND (${TRADE_SORT_SQL}, t.transaction_id) < (${at}::bigint, ${id}::varchar)`;
}

/** `ORDER BY` for the board — the ordering the keyset index is built on. */
export const TRADE_ORDER_SQL = `ORDER BY ${TRADE_SORT_SQL} DESC, t.transaction_id DESC`;

/** One filter-menu branch: what it reads off the population, and the aggregate. */
export type TradeFacetBranch = {
  /**
   * The `pop` CTE's `SELECT` list for this branch — the columns its aggregate
   * names and no others.
   *
   * **It is per branch because `pop` is `MATERIALIZED`, so the projection is
   * what gets written to a tuplestore.** All three branches used to select the
   * same five columns, two of which are the largest jsonb on the row: a season's
   * trades carry `adds` and `draft_picks` of a few hundred bytes apiece, so each
   * branch was copying tens of megabytes of the season into a tuplestore in
   * order to read one column of it — and past `work_mem` that tuplestore is a
   * temp file, three of them at once, on a read whose whole cost is supposed to
   * be the population filter. The players branch needs `adds`, the picks branch
   * `draft_picks` and its trade id, and the managers branch — the one that was
   * carrying both blobs to look at neither — only the ids it joins on.
   */
  columns: string;
  /** The aggregate over `pop`, which is the only name it may read from. */
  aggregate: string;
};

/**
 * The three filter-menu aggregates, each read over a `pop` CTE the caller
 * builds.
 *
 * They live beside the population they count rather than inside `./queries`
 * because they are SQL with rules in them — which asset a menu is counted by,
 * whether a trade naming something twice counts twice, and how a roster becomes
 * a person — and because the managers branch casts a jsonb roster id, which is
 * the one thing in this module that has to be guarded the same way in three
 * places. Kept as strings the tests can read, for the same reason the rest of
 * this module is: a mistake here is not an error but *the wrong rows*.
 *
 * **Two of the three dedupe in a subquery and count `*` over it, rather than
 * counting `DISTINCT` per group.** The rule is unchanged — the menu's number is
 * trades that name the thing, and a trade can name it twice — but
 * `count(DISTINCT …)` is the one aggregate Postgres cannot hash: it plans a
 * GroupAggregate and sorts the whole lateral output by `(group, trade)` to do
 * it, which on the managers branch is every roster of every trade in the season.
 * Deduplicating first lets both steps be hash aggregates. The rewrite is exact
 * rather than approximate: `SELECT DISTINCT trade, value` and then `count(*) …
 * GROUP BY value` *is* the count of distinct trades per value, spelled so the
 * planner has a choice.
 */
export const TRADE_FACET_SQL: Record<
  "players" | "picks" | "managers",
  TradeFacetBranch
> = {
  /**
   * `adds` is player id → the roster that received them, so its keys *are* the
   * players who moved, pooled across the sides. Keys are unique within an
   * object, so a plain `count(*)` is already a count of trades — this is the one
   * branch that never had a `DISTINCT` to lose, and the reason is a fact about
   * jsonb rather than about the data.
   */
  players: {
    columns: `t.adds`,
    aggregate: `SELECT k AS value, count(*)::bigint AS count
       FROM pop, LATERAL jsonb_object_keys(${asObject("pop.adds")}) k
      GROUP BY k`,
  },

  /**
   * Distinctly, because a trade can carry two 2027 firsts and the menu's number
   * is "trades that name it".
   */
  picks: {
    columns: `t.transaction_id, t.draft_picks`,
    aggregate: `SELECT value, count(*)::bigint AS count
       FROM (
         SELECT DISTINCT pop.transaction_id, ${PICK_TOKEN_SQL} AS value
           FROM pop, LATERAL jsonb_array_elements(${asArray("pop.draft_picks")}) p
          WHERE p ? 'season' AND p ? 'round'
       ) named
      GROUP BY value`,
  },

  /**
   * A trade names rosters and a reader names people, so this is the only branch
   * that has to join — and the only one whose join is now to a table rather than
   * to an unnested jsonb array. `trade_participants` holds that mapping
   * ({@link tradeParticipantsSql}), so this branch's population is the trade
   * *ids* and nothing else: no `league_id`, no `roster_ids`, no regex-guarded
   * cast per row, and the smallest tuplestore of the three by an order of
   * magnitude.
   *
   * Distinctly, still: a manager can hold two rosters in one league and a
   * three-way trade can name both, so the stored mapping has two rows for them
   * exactly as the join had — the key is `(transaction_id, roster_id)`, which is
   * the grain the menu has to collapse.
   *
   * **The value is `owner_id_at_trade`, so the menu lists who *dealt*.** Off
   * today's owner the menu would offer a manager who has never made a trade
   * — because they took over a roster that had — and would omit the manager who
   * actually made them. It is also the column the bay filter it feeds compares
   * against, and a menu counted on one column and applied on another is an
   * option that returns nothing.
   */
  managers: {
    columns: `t.transaction_id`,
    aggregate: `SELECT value, count(*)::bigint AS count
       FROM (
         SELECT DISTINCT pop.transaction_id, tp.owner_id_at_trade AS value
           FROM pop
           JOIN trade_participants tp ON tp.transaction_id = pop.transaction_id
       ) dealt
      GROUP BY value`,
  },
};

export { asArray as jsonbArraySql, asObject as jsonbObjectSql, PICK_TOKEN_SQL };
