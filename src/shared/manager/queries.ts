import { pool } from "@/shared/db";

/** A manager's league with summary counts, read from Postgres. */
export type ManagerLeague = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  avatar: string | null;
  team_name: string | null;
  record: { wins: number; losses: number; ties: number } | null;
  counts: {
    rosters: number;
    tradedPicks: number;
    drafts: number;
    draftPicks: number;
    transactions: number;
  };
};

type Row = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  avatar: string | null;
  team_name: string | null;
  wins: string | null;
  losses: string | null;
  ties: string | null;
  roster_count: string;
  traded_pick_count: string;
  draft_count: string;
  draft_pick_count: string;
  transaction_count: string;
};

/**
 * When this manager+season was last synced, or null if never. Used to decide
 * whether cached leagues can be served immediately and refreshed in the
 * background.
 */
export async function getManagerSyncedAt(
  userId: string,
  season: string,
): Promise<Date | null> {
  const { rows } = await pool.query<{ synced_at: Date }>(
    `SELECT synced_at FROM manager_syncs WHERE user_id = $1 AND season = $2`,
    [userId, season],
  );
  return rows[0]?.synced_at ?? null;
}

/**
 * Read a manager's leagues for a season from the DB, with per-league counts and
 * the manager's own team record. Assumes {@link syncManagerLeagues} has run.
 */
export async function getManagerLeagues(
  userId: string,
  season: string,
): Promise<ManagerLeague[]> {
  const { rows } = await pool.query<Row>(
    `SELECT
        l.league_id, l.name, l.season, l.status, l.total_rosters, l.avatar,
        lu.team_name,
        mr.settings->>'wins'   AS wins,
        mr.settings->>'losses' AS losses,
        mr.settings->>'ties'   AS ties,
        (SELECT count(*) FROM rosters r WHERE r.league_id = l.league_id) AS roster_count,
        (SELECT count(*) FROM traded_picks tp WHERE tp.league_id = l.league_id) AS traded_pick_count,
        (SELECT count(*) FROM drafts d WHERE d.league_id = l.league_id) AS draft_count,
        (SELECT count(*) FROM draft_picks dp
           JOIN drafts d ON d.draft_id = dp.draft_id
          WHERE d.league_id = l.league_id) AS draft_pick_count,
        (SELECT count(*) FROM transactions tx WHERE tx.league_id = l.league_id) AS transaction_count
     FROM leagues l
     JOIN league_users lu
       ON lu.league_id = l.league_id AND lu.user_id = $1
     LEFT JOIN rosters mr
       ON mr.league_id = l.league_id AND mr.owner_id = $1
     WHERE l.season = $2
     ORDER BY l.name`,
    [userId, season],
  );

  return rows.map((r) => ({
    league_id: r.league_id,
    name: r.name,
    season: r.season,
    status: r.status,
    total_rosters: r.total_rosters,
    avatar: r.avatar,
    team_name: r.team_name,
    record:
      r.wins == null && r.losses == null && r.ties == null
        ? null
        : {
            wins: Number(r.wins ?? 0),
            losses: Number(r.losses ?? 0),
            ties: Number(r.ties ?? 0),
          },
    counts: {
      rosters: Number(r.roster_count),
      tradedPicks: Number(r.traded_pick_count),
      drafts: Number(r.draft_count),
      draftPicks: Number(r.draft_pick_count),
      transactions: Number(r.transaction_count),
    },
  }));
}
