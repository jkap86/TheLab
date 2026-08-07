"use client";

import { useMemo } from "react";

import type { ManagerPlayersPayload } from "@/shared/contract";
import type { ManagerLeague } from "@/shared/manager";

import { MANAGER_STALE_TIMES, managerQueryKeys } from "./manager-query";
import { useManagerResource } from "./use-manager-resource";
import type { ManagerResourceState } from "./use-manager-resource";

export type ManagerPlayersState = ManagerResourceState<ManagerPlayersPayload>;

/**
 * The manager's roster in each of their leagues — what a player share is counted
 * over. The sibling `leagues` route is what fills those rosters in, so this reads
 * whatever that stream has written; see {@link useManagerResource} for why it
 * takes the leagues and reads only whether there are any.
 */
export function useManagerPlayers(
  searched: string,
  /**
   * The manager's canonical Sleeper id, off the leagues stream. Sent with the
   * read so the route needn't resolve the searched name through Sleeper again —
   * see {@link useManagerResource}.
   */
  userId: string | null,
  leagues: ManagerLeague[] | null,
  /** Off until a subject filter needs it — see {@link useManagerResource}. */
  enabled = true,
): ManagerPlayersState {
  const queryKey = useMemo(() => managerQueryKeys.players(searched), [searched]);
  return useManagerResource<ManagerPlayersPayload>(
    queryKey,
    searched,
    userId,
    leagues,
    "players",
    "Failed to load rosters",
    MANAGER_STALE_TIMES.players,
    enabled,
  );
}
