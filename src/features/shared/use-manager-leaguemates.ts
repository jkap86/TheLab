"use client";

import { useMemo } from "react";

import type { ManagerLeaguematesPayload } from "@/shared/contract";
import type { ManagerLeague } from "@/shared/manager";

import { MANAGER_STALE_TIMES, managerQueryKeys } from "./manager-query";
import { useManagerResource } from "./use-manager-resource";
import type { ManagerResourceState } from "./use-manager-resource";

export type ManagerLeaguematesState =
  ManagerResourceState<ManagerLeaguematesPayload>;

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
  return useManagerResource<ManagerLeaguematesPayload>(
    queryKey,
    searched,
    userId,
    leagues,
    "leaguemates",
    "Failed to load leaguemates",
    MANAGER_STALE_TIMES.leaguemates,
    enabled,
  );
}
