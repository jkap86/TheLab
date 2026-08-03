import { pool } from "@/shared/db";
import type { ManagerLeague } from "@/shared/manager";

import { assembleTrade } from "./assemble";
import type { TradeRow } from "./assemble";
import { BoundedCache, cachedLookup } from "./cache";
import { resolveTradeCircle } from "./circle";
import type { TradeCircleScope } from "./circle";
import { decodeTradeCursor, encodeTradeCursor } from "./cursor";
import type { TradeQuery } from "./params";
import {
  jsonbArraySql,
  PICK_TOKEN_SQL,
  STARTUP_DRAFT_SQL,
  TRADES_POPULATION_SQL,
  TRADE_COLUMNS_SQL,
  TRADE_ORDER_SQL,
  TRADE_SORT_SQL,
  tradeCursorSql,
  tradeFilterSql,
} from "./sql";
import type { Trade } from "./types";

/**
 * Reading the trades board out of Postgres, a page at a time.
 *
 * **This module used to stream a whole season through one Postgres cursor, and
 * the change away from that is the largest performance decision in the app.**
 * The old shape was a sound answer to the wrong constraint: the page applied
 * every filter in the browser, so it needed the unnarrowed season in hand, so
 * the only thing left to optimise was how *progressively* ~20MB could arrive.
 * Once the filters moved to the server that constraint is gone, and with it the
 * three costs it forced —
 *
 * - **a pooled connection held for the length of a walk.** A `DECLARE`d cursor
 *   is server-side state on one backend, and the route interleaved reading it
 *   with four enrichment lookups per chunk, so the connection sat idle-in-
 *   transaction across every one of them. At a few concurrent readers that is
 *   the pool.
 * - **a sort of the whole season, per reader.** No `LIMIT` means the planner
 *   costs the plan for every row and takes a sort; a `LIMIT`-bounded page walks
 *   `transactions_trade_keyset_idx` in order and stops.
 * - **tens of megabytes of JSON**, serialised, gzipped, transferred, parsed and
 *   held live in a browser, to render twenty cards.
 *
 * The measurement that argued *for* the cursor is still true and is now beside
 * the point: keyset pagination loses badly when you walk a whole season through
 * it (529ms against 232ms, because the resume predicate stops being selective
 * and the plan flips to a bitmap scan and a top-N heapsort), and wins the first
 * page hands down (8ms against 117ms). The board reads a page and stops, so the
 * case it wins is the only one that happens.
 *
 * Read-only over what the league crawl and the manager syncs stored: this is the
 * whole market this database has seen, not one account's corner of it. The sync
 * mirrors transactions week by week, so a league's trade history is only as
 * complete as the weeks it has fetched.
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
   * that the board is exhausted — a short page is not, since a page shorter than
   * the limit still means the query ran out, but a page exactly the length of
   * the limit that happened to be the last one would otherwise loop forever on
   * an empty next page. So the cursor is null exactly when fewer rows came back
   * than were asked for.
   */
  nextCursor: string | null;
};

/**
 * One page of trades, resumed from `query.cursor`.
 *
 * **The connection is checked out for this query alone.** It is released before
 * the caller resolves a single name, which is the whole of Priority 2: the route
 * enriches a page it is already holding rather than holding a cursor open while
 * it enriches.
 *
 * One extra row is read beyond the limit and dropped, so "is there another page"
 * is answered by the same query rather than by a second one — the standard
 * trick, and worth naming because the alternative (`count`, or a speculative
 * next page) is a round trip per page.
 */
export async function listTrades(query: TradeQuery): Promise<TradesPage> {
  // Resolved here rather than in the route, so the five reads that share one
  // definition of "the trades on this board" cannot come to different views of
  // it — the same guarantee `./sql` exists for, extended to the one narrowing
  // that needs a query of its own to become SQL. It is cached per reader, so
  // this is a map lookup on every page after the first.
  const circle = await resolveTradeCircle(query);
  const params: unknown[] = [query.season];
  const filters = tradeFilterSql(query, params, circle);
  const cursor = decodeTradeCursor(query.cursor);
  const resume = cursor ? tradeCursorSql(cursor, params) : "";
  const limit = `$${params.push(query.limit + 1)}`;

  const { rows } = await pool.query<TradeRow>(
    `WITH startup_draft AS (${STARTUP_DRAFT_SQL})
      SELECT ${TRADE_COLUMNS_SQL}
      ${TRADES_POPULATION_SQL}${filters}${resume}
      ${TRADE_ORDER_SQL}
      LIMIT ${limit}`,
    params,
  );

  const page = rows.slice(0, query.limit);
  const owners = await rosterOwners([...new Set(page.map((r) => r.league_id))]);
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

/**
 * How many trades this query matches.
 *
 * Run **only on a first page**, and only when the query is narrowed — the
 * unnarrowed count comes off `trade_market_stats` (see `./stats`), which is what
 * Priority 3 is about. A filtered count is still a bitmap scan over the
 * population, so it is a real cost; paying it once per filter set rather than
 * once per page is the difference between it being a rounding error and it being
 * the request.
 */
export async function countTrades(query: TradeQuery): Promise<number> {
  const circle = await resolveTradeCircle(query);
  const params: unknown[] = [query.season];
  const filters = tradeFilterSql(query, params, circle);

  const { rows } = await pool.query<{ total: string }>(
    `WITH startup_draft AS (${STARTUP_DRAFT_SQL})
      SELECT count(*) AS total ${TRADES_POPULATION_SQL}${filters}`,
    params,
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Every league that has a trade on this season's board.
 *
 * **The page needs all of them before it can narrow by any of them.** The league
 * filters are a rule engine over Sleeper's `roster_positions` and
 * `scoring_settings` blobs — slot groups derived from the solver's own tables,
 * scoring keys read off the leagues in hand — and re-implementing that in SQL is
 * the kind of second copy that drifts silently and is never noticed, because a
 * filter that disagrees with itself looks like a league that simply wasn't in
 * the data. So the rules stay in one place, on the client, and this is what they
 * run over: the client evaluates them and sends the resulting ids back as
 * `?leagues=`.
 *
 * That is a much better trade than it sounds. This is a few hundred rows once
 * per season per reader, cached for fifteen minutes, against ~20MB of trades —
 * and it replaces the per-chunk league enrichment the stream used to do
 * entirely, since the page already holds every league a card can name.
 *
 * Restricted to leagues that actually have a trade, which is what the streaming
 * route's league list converged on (it accumulated leagues as their trades
 * arrived). A season's leagues that traded nothing would otherwise appear in the
 * filter dialog's counts and change what its breakdown says.
 */
export async function getSeasonTradeLeagues(
  season: string,
): Promise<ManagerLeague[]> {
  type Row = {
    league_id: string;
    name: string;
    season: string;
    status: string;
    total_rosters: number;
    avatar: string | null;
    settings: Record<string, unknown> | null;
    roster_positions: string[] | null;
    scoring_settings: Record<string, number> | null;
  };

  const { rows } = await pool.query<Row>(
    `WITH startup_draft AS (${STARTUP_DRAFT_SQL}),
          traded AS (
            SELECT DISTINCT t.league_id ${TRADES_POPULATION_SQL}
          )
      SELECT l.league_id, l.name, l.season, l.status, l.total_rosters, l.avatar,
             l.settings, l.roster_positions, l.scoring_settings
        FROM leagues l
        JOIN traded ON traded.league_id = l.league_id
       ORDER BY l.name`,
    [season],
  );

  return rows.map((r) => ({
    league_id: r.league_id,
    name: r.name,
    season: r.season,
    status: r.status,
    total_rosters: r.total_rosters,
    avatar: r.avatar,
    // Not read on this page — a trade card names a league, it doesn't stand it
    // against a record — and the leagues route that does fill it is scoped to a
    // manager, which this one deliberately isn't.
    record: null,
    settings: r.settings,
    roster_positions: r.roster_positions,
    scoring_settings: r.scoring_settings,
  }));
}

/** One selectable value in a filter menu, with how many trades carry it. */
export type TradeFacet = { value: string; count: number };

/** The three menus the trade filter dialog offers, counted server-side. */
export type TradeFacets = {
  players: TradeFacet[];
  picks: TradeFacet[];
  managers: TradeFacet[];
};

/**
 * The filter dialog's option lists, counted over the population the caller
 * describes.
 *
 * **This is what lets the menus stay what they were.** They are read *off the
 * trades* rather than from a fixed list — what a season traded is the only
 * honest answer to "who can I filter by" — and that used to be free because the
 * browser held the season. Counted here instead, the menus are unchanged: every
 * player who moved, every pick season on the table, every manager who dealt, in
 * count order. Computed over a season this is a few hundred milliseconds, which
 * is why the route caches it and the page only asks when the dialog opens.
 *
 * The caller passes the query **without its own selection** — narrowed by the
 * league filters and the window, but not by what is picked. Counting over the
 * fully narrowed list instead collapses each menu to its own selection the
 * moment you make one, and it can't be widened again without being cleared.
 *
 * Each count is `count(DISTINCT transaction_id)` rather than a row count,
 * because a trade can name the same asset twice — two 2026 firsts, a manager on
 * two sides of a three-way — and the menu's number is "trades in the list that
 * name it".
 */
export async function getTradeFacets(query: TradeQuery): Promise<TradeFacets> {
  // Resolved once and handed to all three branches: they count over one
  // population, and three resolutions of the same circle would be three chances
  // for the menus to disagree with each other about who is on this board.
  const circle = await resolveTradeCircle(query);

  // **Three queries in parallel rather than one three-branch `UNION ALL`.**
  // As one statement the branches run in sequence and the request waits on
  // their sum; run together it waits on the slowest. Measured over a 50k-trade
  // season: 2,090ms as one statement, ~850ms as three. What that costs is
  // reading the population three times instead of once, which is ~50ms a piece
  // against branches that cost 270ms, 270ms and 830ms — a trade worth making,
  // and the reason it is worth making is that the branches are so unequal.
  const [players, picks, managers] = await Promise.all([
    facetQuery(
      query,
      circle,
      // `adds` is player id → the roster that received them, so its keys *are*
      // the players who moved, pooled across the sides the way `tradeAssets`
      // used to pool them. Keys are unique within an object, so a plain
      // `count(*)` is already a count of trades.
      `SELECT k AS value, count(*)::bigint AS count
         FROM pop, LATERAL jsonb_object_keys(
                CASE WHEN jsonb_typeof(pop.adds) = 'object'
                     THEN pop.adds ELSE '{}'::jsonb END
              ) k
        GROUP BY k`,
    ),
    facetQuery(
      query,
      circle,
      // Distinctly, because a trade can carry two 2027 firsts and the menu's
      // number is "trades that name it".
      `SELECT ${PICK_TOKEN_SQL} AS value,
              count(DISTINCT pop.transaction_id)::bigint AS count
         FROM pop, LATERAL jsonb_array_elements(${jsonbArraySql("pop.draft_picks")}) p
        WHERE p ? 'season' AND p ? 'round'
        GROUP BY 1`,
    ),
    facetQuery(
      query,
      circle,
      // A trade names rosters and a reader names people, so this is the only
      // branch that has to join. Distinctly again: a manager can hold two
      // rosters in one league, and a three-way trade can name both.
      `SELECT r.owner_id AS value,
              count(DISTINCT pop.transaction_id)::bigint AS count
         FROM pop
         CROSS JOIN LATERAL jsonb_array_elements_text(${jsonbArraySql("pop.roster_ids")}) ri
         JOIN rosters r
           ON r.league_id = pop.league_id AND r.roster_id = ri::int
        WHERE ri ~ '^[0-9]+$' AND r.owner_id IS NOT NULL
        GROUP BY 1`,
    ),
  ]);

  return { players, picks, managers };
}

/**
 * One facet aggregate over the population the query describes.
 *
 * The population is a CTE the branch reads as `pop`, materialised so the
 * lateral unnest below it doesn't re-derive it per row. Sorting is left to the
 * caller — the client's ordering is by count and then by *label*, which the
 * database has no view of, since a player's name is a row in another table and
 * a pick's label is a formatting of its own token.
 */
async function facetQuery(
  query: TradeQuery,
  circle: TradeCircleScope | null,
  aggregate: string,
): Promise<TradeFacet[]> {
  const params: unknown[] = [query.season];
  const filters = tradeFilterSql(query, params, circle);

  const { rows } = await pool.query<{ value: string; count: string }>(
    `WITH startup_draft AS (${STARTUP_DRAFT_SQL}),
          pop AS MATERIALIZED (
            SELECT t.transaction_id, t.league_id, t.adds, t.draft_picks, t.roster_ids
            ${TRADES_POPULATION_SQL}${filters}
          )
     ${aggregate}`,
    params,
  );

  return rows
    .map((row) => ({ value: row.value, count: Number(row.count) }))
    .sort((a, b) => b.count - a.count);
}

const EMPTY_OWNERS: ReadonlyMap<number, string> = new Map();

/**
 * How long a league's roster→owner map is reused. Rosters change on the crawl's
 * seasonal TTL at fastest (15 minutes in-season), and an owner changing mid-week
 * costs a side its name for a few minutes rather than being wrong about a trade.
 */
const OWNERS_TTL_MS = 10 * 60 * 1000;

/**
 * Roster owners for every league on the board, at ~19 bytes a league. A season
 * names a few hundred, so this is sized to hold all of them and then some.
 */
const ownersCache = new BoundedCache<ReadonlyMap<number, string> | null>(
  2000,
  OWNERS_TTL_MS,
);

/**
 * Roster id → owner, per league. A trade names rosters, and a reader thinks in
 * managers; a roster with no cached owner is simply absent, which the assembler
 * reads as an unnamed side rather than a reason to drop the trade.
 *
 * One query for every league in a page rather than one per trade, and cached
 * across pages and readers — a season's trades come from a hundred-odd leagues
 * and every page names most of them, so without the cache this would be the same
 * query on every request.
 */
async function rosterOwners(
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
 * re-rolling one, not about a value drifting. Fifteen minutes is the same bound
 * the managers cache takes, and the cost of being stale is a pick named by its
 * round for a few minutes rather than by a slot.
 */
const DRAFT_ORDER_TTL_MS = 15 * 60 * 1000;

/**
 * Roster → draft slot per `(league, season)`. A season's board names a few
 * hundred leagues and a pick two or three seasons out for each, so this is sized
 * well past what one board can ask for.
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
 *   the sync already writes, and a roster whose owner has left the league simply
 *   resolves to nothing, which is the honest answer rather than a guessed slot.
 * - **A null `draft_order` is a draft whose order isn't set**, which is exactly
 *   the case the card falls back to naming a round for. It is left out here
 *   rather than sent as a null, so an absent key means "no order" everywhere.
 * - **An auction has no slots at all** — its `pick_no` is nomination order, the
 *   same quirk that keeps auctions off the ADP board — so its `draft_order` is
 *   not a pick order and is excluded rather than formatted as one.
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
 * member of every league it touches, and that is the only row most of them have.
 * Where the same person was synced under different names across leagues, the
 * newest wins — the same rule `getManagerLeaguemates` follows.
 *
 * Cached like the rest of the enrichment: the managers a season's trades name
 * are a fixed few thousand, and every page after the first names almost none the
 * cache doesn't hold.
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

/** Exported for the route's own enrichment caches — see `./enrich`. */
export { BoundedCache, cachedLookup };

/** The sort expression, exported so `./stats` counts the same population. */
export { TRADE_SORT_SQL };
