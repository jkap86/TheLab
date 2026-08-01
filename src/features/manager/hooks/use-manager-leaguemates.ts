"use client";

import type { ManagerLeague, ManagerLeaguematesResult } from "../types";
import { useManagerResource } from "./use-manager-resource";
import type { ManagerResourceState } from "./use-manager-resource";

export type ManagerLeaguematesState =
  ManagerResourceState<ManagerLeaguematesResult>;

/**
 * Every member of every league the manager is in — what a leaguemate share is
 * counted over. The sibling `leagues` route is what fills `league_users` in, so
 * this reads whatever that stream has written; see {@link useManagerResource} for
 * why it takes the leagues themselves.
 */
export function useManagerLeaguemates(
  searched: string,
  leagues: ManagerLeague[] | null,
): ManagerLeaguematesState {
  return useManagerResource<ManagerLeaguematesResult>(
    searched,
    leagues,
    "leaguemates",
    "Failed to load leaguemates",
  );
}
