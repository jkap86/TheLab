import { pool } from "@/shared/db";

import type { LeagueDetail, LeagueTeam, ManagerLeague } from "./types";

export type { LeagueDetail, LeagueTeam, ManagerLeague };

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

type TeamRow = {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  settings: Record<string, unknown> | null;
  display_name: string | null;
  avatar: string | null;
  team_name: string | null;
};

/** Sleeper stores a whole-point count plus a separate hundredths field. */
function foldPoints(whole: unknown, decimal: unknown): number {
  return Number(whole ?? 0) + Number(decimal ?? 0) / 100;
}

/**
 * A league's rosters, league members, and derived standings for the expanded
 * league view. Teams are returned in standings order (wins desc, then points
 * for desc). Returns null when the league isn't cached. Player ids are returned
 * raw; the API route resolves them to names.
 */
export async function getLeagueDetail(
  leagueId: string,
): Promise<LeagueDetail | null> {
  const league = await pool.query<{
    league_id: string;
    name: string;
    season: string;
    status: string;
    roster_positions: string[] | null;
    scoring_settings: Record<string, number> | null;
  }>(
    `SELECT league_id, name, season, status, roster_positions, scoring_settings
       FROM leagues WHERE league_id = $1`,
    [leagueId],
  );
  if (league.rows.length === 0) return null;
  const l = league.rows[0];

  const { rows } = await pool.query<TeamRow>(
    `SELECT
        r.roster_id, r.owner_id, r.players, r.starters, r.reserve, r.taxi,
        r.settings,
        lu.display_name, lu.avatar, lu.team_name
       FROM rosters r
       LEFT JOIN league_users lu
         ON lu.league_id = r.league_id AND lu.user_id = r.owner_id
      WHERE r.league_id = $1`,
    [leagueId],
  );

  const teams: LeagueTeam[] = rows.map((r) => {
    const s = r.settings ?? {};
    return {
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      manager: r.owner_id
        ? {
            user_id: r.owner_id,
            display_name: r.display_name ?? "",
            avatar: r.avatar,
            team_name: r.team_name,
          }
        : null,
      record: {
        wins: Number(s.wins ?? 0),
        losses: Number(s.losses ?? 0),
        ties: Number(s.ties ?? 0),
      },
      fpts: foldPoints(s.fpts, s.fpts_decimal),
      fpts_against: foldPoints(s.fpts_against, s.fpts_against_decimal),
      players: r.players ?? [],
      starters: r.starters ?? [],
      reserve: r.reserve ?? [],
      taxi: r.taxi ?? [],
    };
  });

  // Standings order: most wins, then most points for as the tiebreaker.
  teams.sort(
    (a, b) => b.record.wins - a.record.wins || b.fpts - a.fpts,
  );

  return {
    league_id: l.league_id,
    name: l.name,
    season: l.season,
    status: l.status,
    roster_positions: l.roster_positions,
    scoring_settings: l.scoring_settings,
    teams,
  };
}
