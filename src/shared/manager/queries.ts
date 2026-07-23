import { pool } from "@/shared/db";

import type { ManagerLeague } from "./types";

export type { ManagerLeague };

type Row = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  avatar: string | null;
  wins: string | null;
  losses: string | null;
  ties: string | null;
  settings: Record<string, unknown> | null;
  scoring_settings: Record<string, number> | null;
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
 * Read a manager's leagues for a season from the DB, with the manager's own team
 * record and each league's settings/scoring. Assumes {@link syncManagerLeagues}
 * has run. The `league_users` join also scopes results to the manager's leagues.
 */
export async function getManagerLeagues(
  userId: string,
  season: string,
): Promise<ManagerLeague[]> {
  const { rows } = await pool.query<Row>(
    `SELECT
        l.league_id, l.name, l.season, l.status, l.total_rosters, l.avatar,
        l.settings, l.scoring_settings,
        mr.settings->>'wins'   AS wins,
        mr.settings->>'losses' AS losses,
        mr.settings->>'ties'   AS ties
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
    record:
      r.wins == null && r.losses == null && r.ties == null
        ? null
        : {
            wins: Number(r.wins ?? 0),
            losses: Number(r.losses ?? 0),
            ties: Number(r.ties ?? 0),
          },
    settings: r.settings,
    scoring_settings: r.scoring_settings,
  }));
}
