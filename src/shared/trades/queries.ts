import { pool } from "@/shared/db";

import { assembleTrade } from "./assemble";
import type { TradeRow } from "./assemble";
import type { Trade } from "./types";

/**
 * How many trades one read will return. The page filters on the client over the
 * whole set it is given, so this is the honest bound on that set rather than a
 * page size — and {@link TradesRead.total} travels with it so a truncated board
 * says so instead of passing as the season's whole market.
 *
 * Newest first is what makes truncating coherent: what falls off the end is the
 * oldest part of the season, which is also the part the date filters reach for
 * last.
 */
export const TRADES_READ_LIMIT = 2000;

export type TradesRead = {
  /** Newest first, at most {@link TRADES_READ_LIMIT} of them. */
  trades: Trade[];
  /**
   * How many the season actually holds, before the limit — counted over the
   * same population the rows come from, so startup-draft trades are outside it
   * on both sides. This is the board's population, not a truncation of a bigger
   * one: {@link TRADES_READ_LIMIT} is what truncates, and what it truncates is
   * already this.
   */
  total: number;
};

/**
 * The instant a league's *first* draft last picked, for leagues that have no
 * previous season — the end of the startup, and the boundary
 * {@link getAllTrades} drops trades before.
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
 * - **Null `last_picked` yields no row, so it excludes nothing.** A draft nobody
 *   has picked in, or one stored before the column existed, leaves the league
 *   with every trade it had. Inventing a boundary from `start_time` alone would
 *   hide trades on the strength of a draft that may never have happened.
 */
const STARTUP_END_SQL = `
  SELECT DISTINCT ON (d.league_id) d.league_id, d.last_picked
    FROM drafts d
    JOIN leagues l ON l.league_id = d.league_id
   WHERE l.season = $1
     AND coalesce(l.previous_league_id, '') IN ('', '0')
   ORDER BY d.league_id, d.start_time ASC NULLS LAST, d.draft_id`;

/**
 * Every completed trade in every crawled league for a season, newest first.
 *
 * Read-only over what the league crawl and the manager syncs stored: this is the
 * whole market this database has seen, not one account's corner of it — which is
 * the point of the page, since the leagues a reader plays in are a fraction of
 * the trades worth reading and the "managers involved" filter is what narrows it
 * back to their own. The sync mirrors transactions week by week, so a league's
 * trade history is only as complete as the weeks it has fetched.
 *
 * Pending and vetoed trades are left out. `status = 'complete'` is Sleeper's
 * marker for one that actually went through, and a proposal that never happened
 * would read on the page as a move that did.
 *
 * **Trades made before a league's startup draft finished are left out too**, on
 * the boundary {@link STARTUP_END_SQL} resolves. A startup fills empty rosters
 * from the whole player pool, so everything traded up to its last pick is draft
 * position changing hands — a room full of pick swaps, dozens in a day in one
 * league — and none of it is the market this board is about. Excluding them here
 * rather than on the client is what makes {@link TRADES_READ_LIMIT} worth having:
 * the read is newest-first, so hiding them downstream would still let them spend
 * the budget and push real trades off the end of the season.
 *
 * A league whose first draft has no stored `last_picked` keeps every trade, so
 * this is inert until the crawler has re-visited a league since the column was
 * added rather than wrong in the meantime.
 */
export async function getAllTrades(season: string): Promise<TradesRead> {
  const { rows } = await pool.query<TradeRow & { total: string }>(
    // The epoch columns are BIGINT, which `pg` hands back as strings; cast here
    // rather than converting downstream so they leave the query layer as
    // numbers. float8 is exact well past any millisecond timestamp.
    //
    // The window count is computed over the whole match before LIMIT applies, so
    // the total the caller reports costs no second query.
    `WITH startup_end AS (${STARTUP_END_SQL})
      SELECT
        t.transaction_id, t.league_id, t.week,
        t.created::float8         AS created,
        t.status_updated::float8  AS status_updated,
        t.roster_ids, t.adds, t.draft_picks, t.waiver_budget,
        count(*) OVER ()          AS total
       FROM transactions t
       JOIN leagues l ON l.league_id = t.league_id
       -- Gated on the join rather than in the WHERE so a league with no startup
       -- boundary — a continuing dynasty, or a first draft Sleeper never dated —
       -- simply fails to match and keeps all of its trades. Comparing above zero
       -- reads a zero as the absent value Sleeper means by it, not as 1970.
       LEFT JOIN startup_end se
              ON se.league_id = t.league_id AND se.last_picked > 0
      WHERE l.season = $1 AND t.type = 'trade' AND t.status = 'complete'
        AND (se.league_id IS NULL
             -- Spelled out rather than left to NULL propagation, because the
             -- undated case is a decision and not a side effect: a trade Sleeper
             -- filed with no timestamp has no honest side of this boundary, so a
             -- league that has one drops it — the same rule the date filters and
             -- /api/adp follow for an undated draft.
             OR (coalesce(t.status_updated, t.created) IS NOT NULL
                 AND coalesce(t.status_updated, t.created) > se.last_picked))
      ORDER BY coalesce(t.status_updated, t.created) DESC NULLS LAST
      LIMIT $2`,
    [season, TRADES_READ_LIMIT],
  );
  if (rows.length === 0) return { trades: [], total: 0 };

  const owners = await rosterOwners([
    ...new Set(rows.map((r) => r.league_id)),
  ]);

  return {
    trades: rows.map((row) =>
      assembleTrade(row, owners.get(row.league_id) ?? EMPTY_OWNERS),
    ),
    total: Number(rows[0].total),
  };
}

const EMPTY_OWNERS: ReadonlyMap<number, string> = new Map();

/**
 * Roster id → owner, per league. A trade names rosters, and a reader thinks in
 * managers; a roster with no cached owner is simply absent, which the assembler
 * reads as an unnamed side rather than a reason to drop the trade.
 *
 * One query for every league rather than one per trade: a season of trades is
 * hundreds of rows over a hundred-odd leagues, and the same roster appears in
 * many of them.
 */
async function rosterOwners(
  leagueIds: string[],
): Promise<Map<string, Map<number, string>>> {
  const { rows } = await pool.query<{
    league_id: string;
    roster_id: number;
    owner_id: string | null;
  }>(
    `SELECT league_id, roster_id, owner_id
       FROM rosters
      WHERE league_id = ANY($1::varchar[]) AND owner_id IS NOT NULL`,
    [leagueIds],
  );

  const byLeague = new Map<string, Map<number, string>>();
  for (const r of rows) {
    if (!r.owner_id) continue;
    let league = byLeague.get(r.league_id);
    if (!league) byLeague.set(r.league_id, (league = new Map()));
    league.set(r.roster_id, r.owner_id);
  }
  return byLeague;
}

/**
 * The league members every one of these trades names, keyed by user id, so the
 * client can label a side with a person rather than a roster number.
 *
 * Resolved through `league_users` rather than the `users` table because a
 * leaguemate is rarely a manager anyone has looked up: the sync writes every
 * member of every league it touches, and that is the only row most of them have.
 * Where the same person was synced under different names across leagues, the
 * newest wins — the same rule {@link getManagerLeaguemates} follows.
 */
export async function getTradeManagers(
  userIds: readonly string[],
): Promise<Map<string, { display_name: string | null; avatar: string | null }>> {
  if (userIds.length === 0) return new Map();

  const { rows } = await pool.query<{
    user_id: string;
    display_name: string | null;
    avatar: string | null;
  }>(
    `SELECT DISTINCT ON (user_id) user_id, display_name, avatar
       FROM league_users
      WHERE user_id = ANY($1::varchar[])
      ORDER BY user_id, updated_at DESC`,
    [[...userIds]],
  );

  return new Map(
    rows.map((r) => [
      r.user_id,
      { display_name: r.display_name, avatar: r.avatar },
    ]),
  );
}
