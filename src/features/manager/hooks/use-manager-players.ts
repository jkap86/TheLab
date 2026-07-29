"use client";

import type { ManagerLeague, ManagerPlayersResult } from "../types";
import { useManagerResource } from "./use-manager-resource";
import type { ManagerResourceState } from "./use-manager-resource";

export type ManagerPlayersState = ManagerResourceState<ManagerPlayersResult>;

/**
 * The manager's roster in each of their leagues — what a player share is counted
 * over. The sibling `leagues` route is what fills those rosters in, so this reads
 * whatever that stream has written; see {@link useManagerResource} for why it
 * takes the leagues themselves.
 */
export function useManagerPlayers(
  searched: string,
  leagues: ManagerLeague[] | null,
): ManagerPlayersState {
  return useManagerResource<ManagerPlayersResult>(
    searched,
    leagues,
    "players",
    "Failed to load rosters",
  );
}
