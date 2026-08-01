"use client";

import { useMemo } from "react";

import { STALE_TIMES } from "../query-config";
import { managerQueryKeys } from "../query-keys";
import type { ManagerLeague, ManagerPlayersResult } from "../types";
import { useManagerResource } from "./use-manager-resource";
import type { ManagerResourceState } from "./use-manager-resource";

export type ManagerPlayersState = ManagerResourceState<ManagerPlayersResult>;

/**
 * The manager's roster in each of their leagues — what a player share is counted
 * over. The sibling `leagues` route is what fills those rosters in, so this reads
 * whatever that stream has written; see {@link useManagerResource} for why it
 * takes the leagues and reads only whether there are any.
 */
export function useManagerPlayers(
  searched: string,
  leagues: ManagerLeague[] | null,
): ManagerPlayersState {
  const queryKey = useMemo(() => managerQueryKeys.players(searched), [searched]);
  return useManagerResource<ManagerPlayersResult>(
    queryKey,
    searched,
    leagues,
    "players",
    "Failed to load rosters",
    STALE_TIMES.players,
  );
}
