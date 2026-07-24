import type {
  LeagueTeam,
  ManagerLeague,
  SyncProgress as SyncProgressCounts,
} from "@/shared/manager";
import type { PlayerSummary } from "@/shared/players";

// Re-exported so feature components import league shapes from one place.
export type { ManagerLeague, PlayerSummary };

/** A team as sent to the client: manager avatar id is resolved to a URL. */
export type LeagueTeamView = Omit<LeagueTeam, "manager"> & {
  manager:
    | (Omit<NonNullable<LeagueTeam["manager"]>, "avatar"> & {
        avatar_url: string | null;
      })
    | null;
};

/** The `/api/league/[leagueId]` response consumed by the expanded league view. */
export type LeagueDetailResult = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  roster_positions: string[] | null;
  teams: LeagueTeamView[];
  /** Player ids → resolved name/position/team, for rendering rosters. */
  players: Record<string, PlayerSummary>;
};

/** A `result` message from the leagues stream (see the leagues route handler). */
export type LeaguesResult = {
  user: { username: string; display_name: string; avatar_url: string | null };
  season: string;
  leagues: ManagerLeague[];
  stale: boolean;
  refreshing: boolean;
  summary?: { total: number; leagues: number; failed: number };
};

/**
 * A `progress` message from the leagues stream: the server's sync counts plus the
 * `phase` the route tags each message with.
 */
export type SyncProgress = SyncProgressCounts & {
  phase: "initial" | "refresh";
};
