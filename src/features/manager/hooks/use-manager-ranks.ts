"use client";

import type { ManagerLeague, ManagerRanksResult } from "../types";
import { useManagerResource } from "./use-manager-resource";
import type { ManagerResourceState } from "./use-manager-resource";

export type ManagerRanksState = ManagerResourceState<ManagerRanksResult>;

/**
 * The manager's projected-points rank in each of their leagues — the collapsed
 * card's rank chip. One batch route rather than a request per card, because
 * ranking a roster needs every *other* team's total, which a card can't derive
 * from anything it already holds; see {@link useManagerResource} for why it takes
 * the leagues themselves.
 */
export function useManagerRanks(
  searched: string,
  leagues: ManagerLeague[] | null,
): ManagerRanksState {
  return useManagerResource<ManagerRanksResult>(
    searched,
    leagues,
    "ranks",
    "Failed to load ranks",
  );
}
