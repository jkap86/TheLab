import type {
  ManagerLeague,
  SyncProgress as SyncProgressCounts,
} from "@/shared/manager";

// Re-exported so feature components import league shapes from one place.
export type { ManagerLeague };

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
