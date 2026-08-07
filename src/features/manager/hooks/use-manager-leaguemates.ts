"use client";

import { useMemo } from "react";

import { STALE_TIMES } from "../query-config";
import { managerQueryKeys } from "../query-keys";
import type { ManagerLeague, ManagerLeaguematesResult } from "../types";
import { useManagerResource } from "./use-manager-resource";
import type { ManagerResourceState } from "./use-manager-resource";

export type ManagerLeaguematesState =
  ManagerResourceState<ManagerLeaguematesResult>;

/**
 * Every member of every league the manager is in — what a leaguemate share is
 * counted over. The sibling `leagues` route is what fills `league_users` in, so
 * this reads whatever that stream has written; see {@link useManagerResource} for
 * why it takes the leagues and reads only whether there are any.
 */
export function useManagerLeaguemates(
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
): ManagerLeaguematesState {
  const queryKey = useMemo(
    () => managerQueryKeys.leaguemates(searched),
    [searched],
  );
  return useManagerResource<ManagerLeaguematesResult>(
    queryKey,
    searched,
    userId,
    leagues,
    "leaguemates",
    "Failed to load leaguemates",
    STALE_TIMES.leaguemates,
    enabled,
  );
}
