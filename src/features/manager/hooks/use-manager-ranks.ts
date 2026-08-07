"use client";

import { useMemo } from "react";

import { STALE_TIMES } from "../query-config";
import { managerQueryKeys } from "../query-keys";
import type { ManagerLeague, ManagerRanksResult } from "../types";
import { useManagerResource } from "./use-manager-resource";
import type { ManagerResourceState } from "./use-manager-resource";

export type ManagerRanksState = ManagerResourceState<ManagerRanksResult>;

/**
 * The manager's projected-points rank in each of their leagues — the collapsed
 * card's rank chip. One batch route rather than a request per card, because
 * ranking a roster needs every *other* team's total, which a card can't derive
 * from anything it already holds; see {@link useManagerResource} for why it takes
 * the leagues and reads only whether there are any.
 *
 * The shortest stale time of the five: the projections behind it move on their
 * own schedule (an injury designation reprices this week), where the leagues the
 * rank is computed over barely move at all.
 */
export function useManagerRanks(
  searched: string,
  /**
   * The manager's canonical Sleeper id, off the leagues stream. Sent with the
   * read so the route needn't resolve the searched name through Sleeper again —
   * see {@link useManagerResource}.
   */
  userId: string | null,
  leagues: ManagerLeague[] | null,
): ManagerRanksState {
  const queryKey = useMemo(() => managerQueryKeys.ranks(searched), [searched]);
  return useManagerResource<ManagerRanksResult>(
    queryKey,
    searched,
    userId,
    leagues,
    "ranks",
    "Failed to load ranks",
    STALE_TIMES.ranks,
  );
}
