/** A manager's league with summary counts, as rendered on the leagues page. */
export type ManagerLeague = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
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

/** A `result` message from the leagues stream (see the leagues route handler). */
export type LeaguesResult = {
  user: { username: string; display_name: string; avatar_url: string | null };
  season: string;
  leagues: ManagerLeague[];
  stale: boolean;
  refreshing: boolean;
  summary?: { total: number; leagues: number; failed: number };
};

/** A `progress` message from the leagues stream. */
export type SyncProgress = {
  phase: "initial" | "refresh";
  loaded: number;
  total: number;
  failed: number;
};
