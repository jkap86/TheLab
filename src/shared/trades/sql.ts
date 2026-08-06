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

/** `{season, round}` as the `"2026-1"` token a pick filter holds. */
const PICK_TOKEN_SQL = `((p->>'season') || '-' || (p->>'round'))`;

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
 * The operator follows the match mode for the same reason the sides do: under
 * `all` every named player has to be present, so `?&` is exact; under `any` a
 * side needs only one of its own, so the necessary condition across the whole
 * selection is `?|`. Null where no side named a player, since a filter of
 * `?& '{}'` is a tautology with a cost.
 */
function playersPresentSql(
  query: TradeQuery,
  bind: (value: unknown) => string,
): string | null {
  const players = query.sides.flatMap((side) => side.players);
  if (players.length === 0) return null;
  const op = query.match === "all" ? "?&" : "?|";
  return `t.adds ${op} ${bind([...new Set(players)])}::text[]`;
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
 * 9ms on the identical question; see {@link tradedByOwnersSql}.
 *
 * Three details in the level itself:
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
        SELECT 1 FROM rosters r
         WHERE r.league_id = t.league_id
           AND r.roster_id = (CASE WHEN ${alias} ~ '^[0-9]+$' THEN ${alias}::int END)
           AND r.owner_id = ${bind(side.manager)})`);
    }

    for (let prior = 0; prior < index; prior++) {
      conditions.push(`${alias} <> ri${prior + 1}`);
    }

    if (index + 1 < sides.length) conditions.push(level(index + 1));

    return `EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(${asArray("t.roster_ids")}) ${alias}
       WHERE ${conditions.join(" AND ")})`;
  };

  return level(0);
}

/**
 * Trades one of `owners` was party to, as a subquery body over the trade's own
 * `roster_ids` — the mapping from the rosters a trade names to the people a
 * reader names.
 *
 * **Written from `roster_ids` outwards rather than from `rosters` inwards, and
 * that is a planner decision rather than a stylistic one.** As
 * `FROM rosters r WHERE r.league_id = t.league_id AND r.owner_id = ANY(…)` with
 * the roster id checked by `@>` containment, the subquery is decorrelatable —
 * and the planner takes it, hash-joining `rosters` against the season, so the
 * board's `ORDER BY` no longer comes off `transactions_trade_keyset_idx` and a
 * page becomes a top-N heapsort of the whole population. Measured on 1.2M
 * transactions holding 59k trades for the season: **347ms that way, 30ms this
 * way** for one page, with 36,850 buffers against 9,652. Unnesting makes the
 * subquery a function of `t`, so it cannot be pulled up.
 *
 * It is one fragment because the circle's `traders` shape asks the identical
 * question of a different id list, and two spellings of "was this manager in
 * this trade" is the drift `./sql` exists to prevent — the managers *filter*
 * was the one that still read it the other way, which is how it came to be the
 * slowest narrowing on the board.
 *
 * Reading roster ids through `jsonb_array_elements_text` is also the more
 * forgiving read of the column, for free: Sleeper has been seen to send them as
 * numbers and as strings, and this flattens both. The regex guard before the
 * cast is the house rule, and it sits **inside the join condition** rather than
 * in a `WHERE` beside it: the cast is what the index lookup is built from, so it
 * is evaluated whatever the planner does with a filter one level up, and `CASE`
 * short-circuits — a junk roster id yields null and matches nothing rather than
 * failing the whole board.
 *
 * `owners` is an already-bound `$n`; `select` is what the caller needs off it.
 */
function tradedByOwnersSql(owners: string, select: string): string {
  return `SELECT ${select}
      FROM jsonb_array_elements_text(${asArray("t.roster_ids")}) ri
      JOIN rosters r
        ON r.league_id = t.league_id
       AND r.roster_id = (CASE WHEN ri ~ '^[0-9]+$' THEN ri::int END)
     WHERE r.owner_id = ANY(${owners}::varchar[])`;
}

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
 *   and this names people, so it reads through {@link tradedByOwnersSql}, which
 *   is the identical question the managers filter asks of a different id list —
 *   see there for why the trade's own roster ids drive it and what the two
 *   spellings cost. Measured over 150k transactions with 850 leaguemates: 205ms
 *   as a decorrelatable subquery, 9.0ms as this one, and only this way is flat
 *   with depth.
 *
 * All three are `EXISTS`/`ANY` filters over `transactions` alone, so the board's
 * `ORDER BY` is still satisfied straight from `transactions_trade_keyset_idx`
 * and a page is still an index walk that stops at the limit.
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
      return `EXISTS (${tradedByOwnersSql(ids, "1")})`;
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

export { asArray as jsonbArraySql, PICK_TOKEN_SQL };
