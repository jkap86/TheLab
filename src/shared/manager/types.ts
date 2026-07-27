/**
 * A manager's league — the shape read from Postgres by {@link getManagerLeagues}
 * and sent to the client on the leagues stream. Single source of truth for both
 * the DB layer and the `manager` feature.
 */
export type ManagerLeague = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  avatar: string | null;
  record: { wins: number; losses: number; ties: number } | null;
  /** League config (roster slots, waivers, etc.), as stored by Sleeper. */
  settings: Record<string, unknown> | null;
  /** Scoring rules keyed by stat, as stored by Sleeper. */
  scoring_settings: Record<string, number> | null;
};

/**
 * One team within a league: its roster (player ids) plus the standings figures
 * derived from the Sleeper roster settings. `manager` is null for orphan teams
 * (no owner assigned). Read by {@link getLeagueDetail}.
 */
export type LeagueTeam = {
  roster_id: number;
  owner_id: string | null;
  manager: {
    user_id: string;
    display_name: string;
    /** Avatar id (not a URL); null when the manager has no avatar. */
    avatar: string | null;
    team_name: string | null;
  } | null;
  record: { wins: number; losses: number; ties: number };
  /** Points for / against, decimals folded in (e.g. 1234.56). */
  fpts: number;
  fpts_against: number;
  /** Every rostered player id. */
  players: string[];
  /** Starting lineup, positionally aligned with the league's starting slots. */
  starters: string[];
  reserve: string[];
  taxi: string[];
};

/**
 * A league's rosters + standings for the expanded league view. `teams` is
 * pre-sorted into standings order (wins, then points for). Read by
 * {@link getLeagueDetail}.
 */
export type LeagueDetail = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  /** Ordered starting-slot + bench labels (e.g. ["QB","RB","FLEX","BN"]). */
  roster_positions: string[] | null;
  /**
   * Scoring rules keyed by stat, as stored by Sleeper. Needed to project this
   * league's rosters: its numbers, not Sleeper's default PPR.
   */
  scoring_settings: Record<string, number> | null;
  teams: LeagueTeam[];
};
