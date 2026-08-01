import type { PoolClient } from "pg";

import { bulkInsert, jsonb as j, pool, withTransaction } from "@/shared/db";

import type { LeagueGraph } from "./graph";

/** Persist one league graph inside an open transaction. */
async function writeLeagueGraph(client: PoolClient, g: LeagueGraph): Promise<void> {
  const l = g.league;

  await bulkInsert(client, {
    table: "leagues",
    columns: [
      "league_id", "name", "season", "sport", "status", "total_rosters", "avatar",
      "previous_league_id", "draft_id", "roster_positions", "settings",
      "scoring_settings", "metadata",
    ],
    rows: [l],
    values: (x) => [
      x.league_id, x.name, x.season, x.sport, x.status, x.total_rosters, x.avatar,
      x.previous_league_id, x.draft_id, j(x.roster_positions), j(x.settings),
      j(x.scoring_settings), j(x.metadata),
    ],
    trailing: { column: "updated_at", sql: "now()" },
    onConflict: `(league_id) DO UPDATE SET
        name = EXCLUDED.name, season = EXCLUDED.season, sport = EXCLUDED.sport,
        status = EXCLUDED.status, total_rosters = EXCLUDED.total_rosters,
        avatar = EXCLUDED.avatar, previous_league_id = EXCLUDED.previous_league_id,
        draft_id = EXCLUDED.draft_id, roster_positions = EXCLUDED.roster_positions,
        settings = EXCLUDED.settings, scoring_settings = EXCLUDED.scoring_settings,
        metadata = EXCLUDED.metadata, updated_at = now(),
        -- Sleeper just answered for this league, so any crawler tombstone is
        -- stale — clearing it puts the league back in the refresh queue.
        gone_at = NULL`,
  });

  // Child collections are replaced wholesale so the DB mirrors Sleeper.
  await client.query(`DELETE FROM league_users WHERE league_id = $1`, [l.league_id]);
  await bulkInsert(client, {
    table: "league_users",
    columns: [
      "league_id", "user_id", "display_name", "avatar", "team_name", "is_owner",
      "is_bot", "metadata",
    ],
    rows: g.users,
    values: (u) => [
      l.league_id, u.user_id, u.display_name, u.avatar,
      u.metadata?.team_name ?? null, u.is_owner, u.is_bot, j(u.metadata),
    ],
  });

  await client.query(`DELETE FROM rosters WHERE league_id = $1`, [l.league_id]);
  await bulkInsert(client, {
    table: "rosters",
    columns: [
      "league_id", "roster_id", "owner_id", "players", "starters", "reserve",
      "taxi", "settings", "metadata",
    ],
    rows: g.rosters,
    values: (r) => [
      l.league_id, r.roster_id, r.owner_id, j(r.players), j(r.starters),
      j(r.reserve), j(r.taxi), j(r.settings), j(r.metadata),
    ],
  });

  await client.query(`DELETE FROM traded_picks WHERE league_id = $1`, [l.league_id]);
  await bulkInsert(client, {
    table: "traded_picks",
    columns: ["league_id", "season", "round", "roster_id", "owner_id", "previous_owner_id"],
    rows: g.tradedPicks,
    values: (p) => [l.league_id, p.season, p.round, p.roster_id, p.owner_id, p.previous_owner_id],
  });

  // Deleting drafts cascades to draft_picks, so re-insert both.
  await client.query(`DELETE FROM drafts WHERE league_id = $1`, [l.league_id]);
  await bulkInsert(client, {
    table: "drafts",
    columns: [
      "draft_id", "league_id", "season", "status", "type", "start_time",
      "last_picked", "draft_order", "settings", "metadata",
    ],
    rows: g.drafts,
    values: (d) => [
      d.draft_id, l.league_id, d.season, d.status, d.type, d.start_time,
      // Coalesced because Sleeper's draft shape is not versioned: a build that
      // stopped sending `last_picked` must store null (no cutoff, every trade
      // kept) rather than `undefined`, which bulkInsert would bind as a
      // parameter the column can't take.
      d.last_picked ?? null,
      j(d.draft_order), j(d.settings), j(d.metadata),
    ],
  });
  await bulkInsert(client, {
    table: "draft_picks",
    columns: ["draft_id", "pick_no", "round", "roster_id", "player_id", "picked_by", "metadata"],
    rows: g.draftPicks,
    values: (p) => [p.draft_id, p.pick_no, p.round, p.roster_id, p.player_id, p.picked_by, j(p.metadata)],
  });

  // Replace only the weeks we re-fetched; earlier weeks (frozen once past) stay.
  await client.query(
    `DELETE FROM transactions WHERE league_id = $1 AND week BETWEEN $2 AND $3`,
    [l.league_id, g.txWeeks.from, g.txWeeks.to],
  );
  await bulkInsert(client, {
    table: "transactions",
    columns: [
      "transaction_id", "league_id", "type", "status", "week", "creator", "created",
      "status_updated", "roster_ids", "consenter_ids", "adds", "drops",
      "draft_picks", "waiver_budget", "settings", "metadata",
    ],
    rows: g.transactions,
    values: (t) => [
      t.transaction_id, l.league_id, t.type, t.status, t.leg, t.creator,
      t.created, t.status_updated, j(t.roster_ids), j(t.consenter_ids),
      j(t.adds), j(t.drops), j(t.draft_picks), j(t.waiver_budget),
      j(t.settings), j(t.metadata),
    ],
  });
}

/** Persist one league graph in its own transaction (atomic per league). */
export function persistLeagueGraph(g: LeagueGraph): Promise<void> {
  return withTransaction((client) => writeLeagueGraph(client, g));
}

/**
 * Highest transaction week already stored per league, for the given league ids.
 * Leagues with no transactions yet are absent from the map (→ full backfill).
 */
export async function getStoredMaxWeekByLeague(
  leagueIds: string[],
): Promise<Map<string, number>> {
  if (leagueIds.length === 0) return new Map();
  const { rows } = await pool.query<{ league_id: string; max_week: number }>(
    `SELECT league_id, max(week) AS max_week
       FROM transactions
      WHERE league_id = ANY($1::varchar[]) AND week IS NOT NULL
      GROUP BY league_id`,
    [leagueIds],
  );
  return new Map(rows.map((r) => [r.league_id, Number(r.max_week)]));
}
