import { pool } from "@/shared/db";

import { LEAGUE_TYPE_CODES } from "./adp-filters";
import type { LeagueType } from "./adp-filters";
import type {
  LeagueDetail,
  Leaguemate,
  LeagueRosterSet,
  LeagueTeam,
  ManagerLeague,
  ManagerLeaguemates,
} from "./types";

export type {
  LeagueDetail,
  Leaguemate,
  LeagueRosterSet,
  LeagueTeam,
  ManagerLeague,
  ManagerLeaguemates,
};

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

/**
 * The manager's own roster in each of their leagues for a season, keyed by
 * league id — every player they hold there, IR and taxi included.
 *
 * Keyed by league rather than returned as rows because the caller is counting a
 * player across leagues and already holds the league list from
 * {@link getManagerLeagues}: everything else about a league would be repeated
 * once per rostered player.
 *
 * A league with no entry is one whose rosters aren't cached, or where the
 * manager holds none; an entry with an empty array is a league they hold a
 * roster in and nobody on it yet (pre-draft). The two are different and the
 * distinction survives into the share denominator.
 */
export async function getManagerRosters(
  userId: string,
  season: string,
): Promise<Record<string, string[]>> {
  const { rows } = await pool.query<{
    league_id: string;
    players: string[] | null;
  }>(
    `SELECT r.league_id, r.players
       FROM rosters r
       JOIN leagues l ON l.league_id = r.league_id
      WHERE r.owner_id = $1 AND l.season = $2`,
    [userId, season],
  );

  const out: Record<string, string[]> = {};
  for (const r of rows) {
    // Concatenated rather than assigned: a manager should hold one roster per
    // league, and if Sleeper ever hands back two, silently dropping one would
    // lose players from the count rather than fail visibly.
    out[r.league_id] = [...(out[r.league_id] ?? []), ...(r.players ?? [])];
  }
  return out;
}

/**
 * Every member of each of the manager's leagues for a season, keyed by league —
 * what a count of leaguemates is built from.
 *
 * The manager's own row is kept in `members` rather than filtered here: every
 * synced league has at least that row, so its presence is what separates "shared
 * with nobody" from "not cached", and the caller knows its own id. Membership,
 * not roster-holding, on purpose — Sleeper keeps a knocked-out or departed
 * manager in `league_users`, and someone you were in a guillotine league with is
 * still someone you know.
 *
 * `users` resolves each id once; where the same user was synced under different
 * names across leagues, the newest row wins.
 */
export async function getManagerLeaguemates(
  userId: string,
  season: string,
): Promise<ManagerLeaguemates> {
  const { rows } = await pool.query<{
    league_id: string;
    user_id: string;
    display_name: string | null;
    avatar: string | null;
  }>(
    `SELECT lu.league_id, lu.user_id, lu.display_name, lu.avatar
       FROM league_users lu
       JOIN league_users me
         ON me.league_id = lu.league_id AND me.user_id = $1
       JOIN leagues l ON l.league_id = lu.league_id
      WHERE l.season = $2
      ORDER BY lu.updated_at`,
    [userId, season],
  );

  const members: Record<string, string[]> = {};
  const users: Record<string, Leaguemate> = {};
  for (const r of rows) {
    (members[r.league_id] ??= []).push(r.user_id);
    users[r.user_id] = {
      user_id: r.user_id,
      display_name: r.display_name,
      avatar: r.avatar,
    };
  }
  return { members, users };
}

/**
 * Every team's roster in each of the manager's leagues for a season, with the
 * league's slots and scoring — the batch input for projecting them all at once.
 *
 * Two queries for the whole account rather than two per league, because the
 * caller is ranking the manager across a hundred-plus leagues in one request.
 * A league whose rosters aren't cached yet comes back with no teams, which
 * downstream reads as "nothing to rank" rather than an error — the leagues
 * stream is what fills rosters in, same as {@link getManagerRosters}.
 */
export async function getManagerLeagueRosters(
  userId: string,
  season: string,
): Promise<LeagueRosterSet[]> {
  const { rows: leagues } = await pool.query<{
    league_id: string;
    roster_positions: string[] | null;
    scoring_settings: Record<string, number> | null;
  }>(
    `SELECT l.league_id, l.roster_positions, l.scoring_settings
       FROM leagues l
       JOIN league_users lu
         ON lu.league_id = l.league_id AND lu.user_id = $1
      WHERE l.season = $2`,
    [userId, season],
  );
  if (leagues.length === 0) return [];

  const byLeague = new Map<string, LeagueRosterSet>(
    leagues.map((l) => [
      l.league_id,
      {
        league_id: l.league_id,
        roster_positions: l.roster_positions,
        scoring_settings: l.scoring_settings,
        teams: [],
      },
    ]),
  );

  const { rows: rosters } = await pool.query<{
    league_id: string;
    roster_id: number;
    owner_id: string | null;
    players: string[] | null;
    starters: string[] | null;
    reserve: string[] | null;
    taxi: string[] | null;
    settings: Record<string, unknown> | null;
  }>(
    `SELECT league_id, roster_id, owner_id, players, starters, reserve, taxi,
            settings
       FROM rosters
      WHERE league_id = ANY($1::varchar[])`,
    [[...byLeague.keys()]],
  );

  for (const r of rosters) {
    const s = r.settings ?? {};
    byLeague.get(r.league_id)?.teams.push({
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      players: r.players ?? [],
      starters: r.starters ?? [],
      reserve: r.reserve ?? [],
      taxi: r.taxi ?? [],
      record: {
        wins: Number(s.wins ?? 0),
        losses: Number(s.losses ?? 0),
        ties: Number(s.ties ?? 0),
      },
      fpts: foldPoints(s.fpts, s.fpts_decimal),
    });
  }

  return [...byLeague.values()];
}

const LEAGUE_TYPE_BY_CODE = new Map<number, LeagueType>(
  (Object.entries(LEAGUE_TYPE_CODES) as [LeagueType, number][]).map(
    ([type, code]) => [code, type],
  ),
);

/**
 * Each league's type — redraft, keeper or dynasty — from Sleeper's numeric
 * `settings.type`, keyed by league id. Regex-guarded before the cast because the
 * settings blob is loosely typed and omits its default, so an absent or junk
 * value reads redraft, matching the `/api/adp` `LEAGUE_TYPE_SQL` and the client
 * filters.
 *
 * Kept out of {@link LeagueRosterSet} because only the ADP-value board needs it:
 * everything else projects a league without caring how it keeps players between
 * seasons.
 */
export async function getLeagueTypes(
  leagueIds: readonly string[],
): Promise<Map<string, LeagueType>> {
  if (leagueIds.length === 0) return new Map();

  const { rows } = await pool.query<{ league_id: string; type_code: number }>(
    `SELECT league_id,
            CASE WHEN settings->>'type' ~ '^[0-9]+$'
                 THEN (settings->>'type')::int ELSE 0 END AS type_code
       FROM leagues
      WHERE league_id = ANY($1::varchar[])`,
    [[...leagueIds]],
  );

  const byLeague = new Map<string, LeagueType>();
  for (const r of rows) {
    byLeague.set(r.league_id, LEAGUE_TYPE_BY_CODE.get(r.type_code) ?? "redraft");
  }
  return byLeague;
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
