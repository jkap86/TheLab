import { pool } from "@/shared/db";

import { assembleTrade } from "./assemble";
import type { TradeRow } from "./assemble";
import type { Trade } from "./types";

/**
 * Every completed trade in the manager's leagues for a season, newest first.
 *
 * Read-only over what the leagues sync stored, like the other manager reads: a
 * manager the leagues stream has never run for gets an empty list rather than a
 * sync of their own. The sync mirrors transactions week by week, so a league's
 * trade history is only as complete as the weeks it has fetched.
 *
 * Every trade in every one of the manager's leagues, not only the ones they were
 * party to: the page is a window on the market they play in — what their
 * leaguemates are doing is most of what is worth reading — and the "managers
 * involved" filter is what narrows it back to their own.
 *
 * Pending and vetoed trades are left out. `status = 'complete'` is Sleeper's
 * marker for one that actually went through, and a proposal that never happened
 * would read on the page as a move that did.
 */
export async function getManagerTrades(
  userId: string,
  season: string,
): Promise<Trade[]> {
  const { rows } = await pool.query<TradeRow>(
    // The epoch columns are BIGINT, which `pg` hands back as strings; cast here
    // rather than converting downstream so they leave the query layer as
    // numbers. float8 is exact well past any millisecond timestamp.
    `SELECT
        t.transaction_id, t.league_id, t.week,
        t.created::float8         AS created,
        t.status_updated::float8  AS status_updated,
        t.roster_ids, t.adds, t.draft_picks, t.waiver_budget
       FROM transactions t
       JOIN leagues l ON l.league_id = t.league_id
       JOIN league_users lu
         ON lu.league_id = t.league_id AND lu.user_id = $1
      WHERE l.season = $2 AND t.type = 'trade' AND t.status = 'complete'
      ORDER BY coalesce(t.status_updated, t.created) DESC NULLS LAST`,
    [userId, season],
  );
  if (rows.length === 0) return [];

  const owners = await rosterOwners([
    ...new Set(rows.map((r) => r.league_id)),
  ]);

  return rows.map((row) =>
    assembleTrade(row, owners.get(row.league_id) ?? EMPTY_OWNERS),
  );
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
