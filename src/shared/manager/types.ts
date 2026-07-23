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
