import type { ManagerLeague, Trade } from "@/shared/contract";
import { pool } from "@/shared/db";
import { QB_ELIGIBLE_STARTING_SLOTS } from "@/shared/ktc";
import { LEAGUE_COLUMNS_SQL, toManagerLeague } from "@/shared/manager";
import type { LeagueRow } from "@/shared/manager";

import { assembleTrade } from "./assemble";
import type { TradeRow } from "./assemble";
import { BoundedCache, cachedLookup } from "./cache";
import { resolveTradeCircle } from "./circle";
import type { TradeCircleScope } from "./circle";
import { decodeTradeCursor, encodeTradeCursor } from "./cursor";
import type { TradeQuery } from "./params";
import {
  STARTUP_DRAFT_CTE,
  TRADES_POPULATION_SQL,
  TRADE_COLUMNS_SQL,
  TRADE_FACET_SQL,
  TRADE_ORDER_SQL,
  tradeCursorSql,
  tradeFilterSql,
  tradeNarrowingSql,
  tradeScopeSql,
} from "./sql";
import type { TradeFacetBranch } from "./sql";

/**
 * Reading the trades board out of Postgres, a page at a time.
 *
 * **A page is a keyset walk, not a cursor over the season**, and the three
 * costs that shape avoids are worth naming because they are what a "just stream
 * it" version pays:
 *
 * - **a pooled connection held for the length of a walk.** A `DECLARE`d cursor
 *   is server-side state on one backend, and a route interleaving reads of it
 *   with name lookups leaves the connection idle-in-transaction across every
 *   one of them. At a few concurrent readers that is the pool.
 * - **a sort of the whole season, per reader.** No `LIMIT` means the planner
 *   costs the plan for every row and takes a sort; a `LIMIT`-bounded page walks
 *   `transactions_trade_keyset_idx` in order and stops.
 * - **megabytes of JSON**, serialised, transferred, parsed and held live in a
 *   browser, to render a screen of cards.
 *
 * Read-only over what the manager syncs stored: this is the market this
 * database has seen, not one account's corner of it — but also not more than
 * has been looked up. The sync mirrors transactions week by week, so a league's
 * trade history is only as complete as the weeks it has fetched.
 *
 * Pending and vetoed trades are left out (`status = 'complete'` is Sleeper's
 * marker for one that actually went through), as are trades made before a
 * league's startup draft finished — see `./sql` for that boundary, which is
 * shared by every read here so the board's stated size and its contents cannot
 * disagree.
 */

/** One page of the board, newest first. */
export type TradesPage = {
  trades: Trade[];
  /**
   * Where to resume, or null at the end of the board. Null is the *only* signal
   * that the board is exhausted — a page shorter than the limit means the query
   * ran out, but a page exactly the length of the limit that happened to be the
   * last one would otherwise loop forever on an empty next page. So the cursor
   * is null exactly when fewer rows came back than were asked for.
   */
  nextCursor: string | null;
};

/**
 * One page of trades, resumed from `query.cursor`.
 *
 * **The connection is checked out for this query alone.** It is released before
 * the caller resolves a single name: the route enriches a page it is already
 * holding rather than holding a cursor open while it enriches.
 *
 * One extra row is read beyond the limit and dropped, so "is there another
 * page" is answered by the same query rather than by a second one.
 */
export async function listTrades(query: TradeQuery): Promise<TradesPage> {
  // Resolved here rather than in the route, so the reads that share one
  // definition of "the trades on this board" cannot come to different views of
  // it — the guarantee `./sql` exists for, extended to the one narrowing that
  // needs a query of its own to become SQL. It is cached per reader, so this is
  // a map lookup on every page after the first.
  const circle = await resolveTradeCircle(query);
  const params: unknown[] = [query.season];
  const filters = tradeFilterSql(query, params, circle);
  const cursor = decodeTradeCursor(query.cursor);
  const resume = cursor ? tradeCursorSql(cursor, params) : "";
  const limit = `$${params.push(query.limit + 1)}`;

  const { rows } = await pool.query<TradeRow>(
    `${STARTUP_DRAFT_CTE}
      SELECT ${TRADE_COLUMNS_SQL}
      ${TRADES_POPULATION_SQL}${filters}${resume}
      ${TRADE_ORDER_SQL}
      LIMIT ${limit}`,
    params,
  );

  const page = rows.slice(0, query.limit);
  const owners = await getRosterOwners([
    ...new Set(page.map((r) => r.league_id)),
  ]);
  const trades = page.map((row) =>
    assembleTrade(row, owners.get(row.league_id) ?? EMPTY_OWNERS),
  );

  const last = page[page.length - 1];
  return {
    trades,
    nextCursor:
      rows.length > query.limit && last
        ? encodeTradeCursor({
            at: last.status_updated ?? last.created ?? 0,
            transaction_id: last.transaction_id,
          })
        : null,
  };
}

/** The two denominators a first page states, from one pass over the population. */
export type TradeTotals = {
  /** Matching the whole query — the `N` of "N of M trades". */
  total: number;
  /** Matching the league filters and the circle alone — the `M`. */
  scopeTotal: number;
};

/**
 * Both of a first page's denominators, counted together.
 *
 * Two separate counts — the query, and the query with the window and the
 * selection lifted out — would be two scans of the population, two
 * `startup_draft` derivations and two pooled connections held for the length of
 * them, for two numbers over *nearly the same rows*. The scope population is a
 * strict superset of the query's by construction (see `leagueScopeQuery`: it
 * only ever removes narrowings), so the narrower number is an aggregate
 * `FILTER` over the wider one's scan rather than a scan of its own.
 *
 * **What that buys is a connection and the work, not wall clock** — run in
 * parallel the request already waited on the slower of the two, and the slower
 * is always the scope count. Merging removes the *other* scan, and the pool is
 * what runs out first here.
 *
 * The two halves come off the same builder as the board's own `WHERE`
 * (`tradeFilterSql` is their concatenation), so the count and the rows cannot
 * come to different views of the population.
 *
 * An unnarrowed query counts one number and reports it twice, which is the one
 * place that knows the two are equal. **TheLabX reads that unnarrowed number
 * out of a precomputed `trade_market_stats` row instead**; there is no such
 * table here, because that read exists for a crawled corpus of millions of
 * transactions and this one is fed by manager lookups — the count is a walk of
 * the partial keyset index, which holds the trades and nothing else.
 */
export async function countTradeTotals(query: TradeQuery): Promise<TradeTotals> {
  const circle = await resolveTradeCircle(query);
  const params: unknown[] = [query.season];
  const scope = tradeScopeSql(query, params, circle);
  const narrowing = tradeNarrowingSql(query, params);

  const { rows } = await pool.query<{ total: string; scope_total: string }>(
    `${STARTUP_DRAFT_CTE}
      SELECT count(*) AS scope_total,
             ${narrowing ? `count(*) FILTER (WHERE ${narrowing})` : `count(*)`} AS total
      ${TRADES_POPULATION_SQL}${scope}`,
    params,
  );

  return {
    total: Number(rows[0]?.total ?? 0),
    scopeTotal: Number(rows[0]?.scope_total ?? 0),
  };
}

/**
 * Every league that has a trade on this season's board.
 *
 * **The page needs all of them before it can narrow by any of them.** The
 * league filters are a rule engine over Sleeper's `roster_positions` and
 * `scoring_settings` blobs, and re-implementing that in SQL is the kind of
 * second copy that drifts silently and is never noticed, because a filter that
 * disagrees with itself looks like a league that simply wasn't in the data. So
 * the rules stay in one place, on the client, and this is what they run over:
 * the client evaluates them and sends the resulting ids back as `?leagues=`.
 *
 * It is also what every card names its league from, so it is one request per
 * season rather than league columns on every page.
 *
 * Restricted to leagues that actually have a trade: a season's leagues that
 * traded nothing would otherwise appear in the filter dialog's counts and
 * change what its breakdown says about the board.
 *
 * **`team_name` and `record` are null on every row, and that is the answer
 * rather than a gap.** Both are a manager's in a league, and there is no
 * manager in this question — see {@link toManagerLeague}, which this shares
 * with `getManagerLeagues` precisely so a field added to `ManagerLeague`
 * arrives on both or on neither.
 */
export async function getSeasonTradeLeagues(
  season: string,
): Promise<ManagerLeague[]> {
  const { rows } = await pool.query<LeagueRow>(
    `${STARTUP_DRAFT_CTE},
          traded AS (
            SELECT DISTINCT t.league_id ${TRADES_POPULATION_SQL}
          )
      SELECT ${LEAGUE_COLUMNS_SQL}
        FROM leagues l
        JOIN traded ON traded.league_id = l.league_id
       ORDER BY l.name`,
    [season],
  );

  return rows.map((r) => toManagerLeague(r));
}

/** One selectable value in a filter menu, with how many trades carry it. */
export type TradeFacet = { value: string; count: number };

/** The three menus the search panel offers, counted server-side. */
export type TradeFacets = {
  players: TradeFacet[];
  picks: TradeFacet[];
  managers: TradeFacet[];
};

/**
 * The search panel's option lists, counted over the population the caller
 * describes.
 *
 * **This is what lets the menus be read off the trades** rather than from a
 * fixed list — what a season traded is the only honest answer to "who can I
 * filter by". Every player who moved, every pick season on the table, every
 * manager who dealt, in count order.
 *
 * The query arrives **without its own selection** — narrowed by the league
 * filters and the window, but not by what is picked. Counting over the fully
 * narrowed list collapses each menu to its own selection the moment you make
 * one, and it can't be widened again without being cleared. `facetsQuery` in
 * `./params` is that stripping, applied by `./facets` so a caller cannot forget
 * it.
 *
 * Two of the three branches count distinct trades in a subquery rather than
 * `count(DISTINCT …)`, because a trade can name the same asset twice — two 2026
 * firsts, a manager on two sides of a three-way — and the menu's number is
 * "trades in the list that name it". See `TRADE_FACET_SQL` for why the spelling
 * matters to the planner.
 */
export async function getTradeFacets(query: TradeQuery): Promise<TradeFacets> {
  // Resolved once and handed to all three branches: they count over one
  // population, and three resolutions of the same circle would be three chances
  // for the menus to disagree with each other about who is on this board.
  const circle = await resolveTradeCircle(query);

  // **Three queries in parallel rather than one three-branch `UNION ALL`.** As
  // one statement the branches run in sequence and the request waits on their
  // sum; run together it waits on the slowest. What that costs is reading the
  // population three times instead of once, which is worth it precisely because
  // the branches are so unequal.
  const [players, picks, managers] = await Promise.all([
    facetQuery(query, circle, TRADE_FACET_SQL.players),
    facetQuery(query, circle, TRADE_FACET_SQL.picks),
    facetQuery(query, circle, TRADE_FACET_SQL.managers),
  ]);

  return { players, picks, managers };
}

/**
 * One facet aggregate over the population the query describes.
 *
 * The population is a CTE the branch reads as `pop`, materialised so the
 * lateral unnest below it doesn't re-derive it per row — and projected to the
 * columns *that* branch names, because materialising is what makes the
 * projection cost real: see {@link TradeFacetBranch.columns}. Sorting is left
 * to the caller — the client's ordering is by count and then by *label*, which
 * the database has no view of, since a player's name is a row in another table
 * and a pick's label is a formatting of its own token.
 */
async function facetQuery(
  query: TradeQuery,
  circle: TradeCircleScope | null,
  branch: TradeFacetBranch,
): Promise<TradeFacet[]> {
  const params: unknown[] = [query.season];
  const filters = tradeFilterSql(query, params, circle);

  const { rows } = await pool.query<{ value: string; count: string }>(
    `${STARTUP_DRAFT_CTE},
          pop AS MATERIALIZED (
            SELECT ${branch.columns}
            ${TRADES_POPULATION_SQL}${filters}
          )
     ${branch.aggregate}`,
    params,
  );

  return rows
    .map((row) => ({ value: row.value, count: Number(row.count) }))
    .sort((a, b) => b.count - a.count);
}

const EMPTY_OWNERS: ReadonlyMap<number, string> = new Map();

/**
 * How long a league's roster→owner map is reused. Rosters change on the manager
 * sync's TTL at fastest, and an owner changing mid-week costs a side its name
 * for a few minutes rather than being wrong about a trade.
 */
const OWNERS_TTL_MS = 10 * 60 * 1000;

/**
 * Roster owners for every league on the board. A season names a few hundred, so
 * this is sized to hold all of them and then some.
 */
const ownersCache = new BoundedCache<ReadonlyMap<number, string> | null>(
  2000,
  OWNERS_TTL_MS,
);

/**
 * Roster id → owner, per league. A trade names rosters, and a reader thinks in
 * managers; a roster with no stored owner is simply absent, which the assembler
 * reads as an unnamed side rather than a reason to drop the trade.
 *
 * One query for every league in a page rather than one per trade, and cached
 * across pages and readers — a season's trades come from a hundred-odd leagues
 * and every page names most of them, so without the cache this would be the
 * same query on every request.
 */
export async function getRosterOwners(
  leagueIds: string[],
): Promise<Map<string, ReadonlyMap<number, string>>> {
  return cachedLookup(ownersCache, leagueIds, async (misses) => {
    const { rows } = await pool.query<{
      league_id: string;
      roster_id: number;
      owner_id: string | null;
    }>(
      `SELECT league_id, roster_id, owner_id
         FROM rosters
        WHERE league_id = ANY($1::varchar[]) AND owner_id IS NOT NULL`,
      [misses],
    );

    const byLeague = new Map<string, ReadonlyMap<number, string>>();
    for (const r of rows) {
      if (!r.owner_id) continue;
      let league = byLeague.get(r.league_id) as Map<number, string> | undefined;
      if (!league) byLeague.set(r.league_id, (league = new Map()));
      league.set(r.roster_id, r.owner_id);
    }
    return byLeague;
  });
}

/**
 * How long a league's draft order is reused.
 *
 * A draft order is set once and then holds for the season — the slowest-moving
 * thing this route resolves — so the TTL is about a commissioner setting or
 * re-rolling one, not about a value drifting. The cost of being stale is a pick
 * named by its round for a few minutes rather than by a slot.
 */
const DRAFT_ORDER_TTL_MS = 15 * 60 * 1000;

/**
 * Roster → draft slot per `(league, season)`. A season's board names a few
 * hundred leagues and a pick two or three seasons out for each, so this is
 * sized well past what one board can ask for.
 */
const draftOrderCache = new BoundedCache<ReadonlyMap<number, number> | null>(
  4000,
  DRAFT_ORDER_TTL_MS,
);

/**
 * Where each roster picks in a league's draft for a season, for the
 * `(league, season)` pairs the page's picks name — see `./pick-slots` for the
 * key and for why this rides beside a page rather than on the picks themselves.
 *
 * Four decisions are packed into the query:
 *
 * - **The order is read through `draft_order`, which is user → slot**, joined
 *   back to rosters by owner. Sleeper's own `slot_to_roster_id` would be one
 *   hop shorter and is not stored; the join gives the same answer off columns
 *   the sync already writes, and a roster whose owner has left the league
 *   simply resolves to nothing, which is the honest answer rather than a
 *   guessed slot.
 * - **A null `draft_order` is a draft whose order isn't set**, which is exactly
 *   the case the card falls back to naming a round for. It is left out here
 *   rather than sent as a null, so an absent key means "no order" everywhere.
 * - **An auction has no slots at all** — its `pick_no` is nomination order — so
 *   its `draft_order` is not a pick order and is excluded rather than formatted
 *   as one.
 * - **The latest draft in a season wins.** An inaugural dynasty league runs a
 *   startup and a rookie draft under one season label, and a traded "2026 1st"
 *   is a pick in the later of the two. `DISTINCT ON` with `start_time DESC`
 *   picks it and leaves an undated stray draft as the fallback.
 */
export async function getDraftSlots(
  keys: readonly string[],
): Promise<Map<string, ReadonlyMap<number, number>>> {
  return cachedLookup(draftOrderCache, keys, async (misses) => {
    const { rows } = await pool.query<{
      key: string;
      roster_id: number;
      slot: number;
    }>(
      `WITH want AS (
         SELECT k AS key,
                split_part(k, '|', 1) AS league_id,
                split_part(k, '|', 2) AS season
           FROM unnest($1::text[]) AS k
       ),
       -- The season's draft is chosen **before** its order is looked at, so a
       -- rookie draft that hasn't been ordered yet reports nothing rather than
       -- falling through to the startup above it and handing back that draft's
       -- slots for a pick in this one.
       chosen AS (
         SELECT DISTINCT ON (w.key)
                w.key, d.league_id, d.type, d.draft_order
           FROM want w
           JOIN drafts d
             ON d.league_id = w.league_id AND d.season = w.season
          ORDER BY w.key, d.start_time DESC NULLS LAST, d.draft_id
       )
       SELECT c.key, r.roster_id, (c.draft_order ->> r.owner_id)::int AS slot
         FROM chosen c
         JOIN rosters r ON r.league_id = c.league_id
        WHERE jsonb_typeof(c.draft_order) = 'object'
          AND coalesce(c.type, '') <> 'auction'
          AND r.owner_id IS NOT NULL
          AND c.draft_order ? r.owner_id
          -- Regex-guarded before the cast, like every other numeric read off a
          -- Sleeper blob: one league holding a junk slot would otherwise fail
          -- the whole query.
          AND (c.draft_order ->> r.owner_id) ~ '^[0-9]+$'`,
      [misses],
    );

    const byDraft = new Map<string, ReadonlyMap<number, number>>();
    for (const r of rows) {
      let slots = byDraft.get(r.key) as Map<number, number> | undefined;
      if (!slots) byDraft.set(r.key, (slots = new Map()));
      slots.set(r.roster_id, r.slot);
    }
    return byDraft;
  });
}

/** Identity as `league_users` stores it — the shape a trade side is labelled from. */
export type TradeManagerRow = {
  display_name: string | null;
  avatar: string | null;
};

/** See {@link getTradeManagers}; managers move at the league sync's pace. */
const MANAGERS_TTL_MS = 15 * 60 * 1000;

const managersCache = new BoundedCache<TradeManagerRow | null>(
  20000,
  MANAGERS_TTL_MS,
);

/**
 * The league members these trades name, keyed by user id, so the client can
 * label a side with a person rather than a roster number.
 *
 * Resolved through `league_users` rather than the `users` table because a
 * leaguemate is rarely a manager anyone has looked up: the sync writes every
 * member of every league it touches, and that is the only row most of them
 * have. Where the same person was synced under different names across leagues,
 * the newest wins.
 *
 * Cached like the rest of the enrichment: the managers a season's trades name
 * are a fixed few thousand, and every page after the first names almost none
 * the cache doesn't hold.
 */
export async function getTradeManagers(
  userIds: readonly string[],
): Promise<Map<string, TradeManagerRow>> {
  if (userIds.length === 0) return new Map();

  return cachedLookup(managersCache, userIds, async (misses) => {
    const { rows } = await pool.query<{
      user_id: string;
      display_name: string | null;
      avatar: string | null;
    }>(
      `SELECT DISTINCT ON (user_id) user_id, display_name, avatar
         FROM league_users
        WHERE user_id = ANY($1::varchar[])
        ORDER BY user_id, updated_at DESC`,
      [misses],
    );

    return new Map(
      rows.map((r) => [
        r.user_id,
        { display_name: r.display_name, avatar: r.avatar },
      ]),
    );
  });
}

/**
 * The two facts a league's KeepTradeCut pricing needs that a trade row does not
 * carry: which of KTC's two QB columns it reads, and how wide its draft board
 * is.
 *
 * **Superflex is asked in SQL against the same derived list `isSuperflexLineup`
 * reads**, bound as a parameter rather than spelled out — the arrangement
 * `getManagerDraftAdp` already uses, so the predicate that picks a league's
 * column here cannot drift from the one that picks it on the manager page.
 *
 * `total_rosters` is the width the round's thirds divide, which is what turns a
 * traded pick's slot into one of KTC's "Early/Mid/Late" rows. The league's own
 * size rather than a count of the draft order, because that order is read
 * through `rosters` and loses a departed user's slot — and a board is as wide as
 * the league, whoever is sitting in it.
 *
 * A league with no stored `roster_positions` is **not** superflex, which is the
 * same fold `isSuperflexLineup` makes of a null: an unread lineup is not
 * evidence of a second quarterback, and the 1QB column is the conservative
 * reading of a league nobody can see.
 */
export type TradeLeagueMarket = { superflex: boolean; total_rosters: number };

export async function getTradeLeagueMarkets(
  leagueIds: readonly string[],
): Promise<Record<string, TradeLeagueMarket>> {
  if (leagueIds.length === 0) return {};

  const { rows } = await pool.query<{
    league_id: string;
    superflex: boolean;
    total_rosters: number | null;
  }>(
    `SELECT l.league_id,
            (SELECT count(*)
               FROM jsonb_array_elements_text(l.roster_positions) slot
              WHERE slot = ANY($2::text[])) > 1 AS superflex,
            l.total_rosters
       FROM leagues l
      WHERE l.league_id = ANY($1)`,
    [leagueIds, [...QB_ELIGIBLE_STARTING_SLOTS]],
  );

  const out: Record<string, TradeLeagueMarket> = {};
  for (const r of rows) {
    out[r.league_id] = {
      superflex: r.superflex,
      // A zero is a row stored before the league answered, not a real size —
      // the distinction the league filters already draw. It reads here as "no
      // board to divide", so every pick in that league falls to the untiered
      // lookup rather than to a tier computed against nothing.
      total_rosters: r.total_rosters ?? 0,
    };
  }
  return out;
}
