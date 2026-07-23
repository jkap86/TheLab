/**
 * A manager's league with summary counts — the shape read from Postgres by
 * {@link getManagerLeagues} and sent to the client on the leagues stream. Single
 * source of truth for both the DB layer and the `manager` feature.
 */
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
