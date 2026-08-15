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
  /**
   * Whether the projected starter and bench ranks are wanted.
   *
   * The record ledge reads the standing off this route whatever the columns say,
   * so it is always asked for — but the *projected* half is a lineup solve per
   * team per remaining week in every projectable league, and four of the
   * catalogue's thirteen metrics read it. With none of them on screen the read
   * asks for `?projections=0` and the server skips the solves entirely; see
   * `managerDataRequirements`.
   */
  options: { projections: boolean; season?: string } = { projections: true },
): ManagerRanksState {
  const { projections, season } = options;
  const queryKey = useMemo(
    () => managerQueryKeys.ranks(searched, season, { projections }),
    [searched, season, projections],
  );
  return useManagerResource<ManagerRanksResult>(
    queryKey,
    searched,
    userId,
    leagues,
    // Only ever narrowed, never widened: the parameter's absence reads as *on*,
    // so an older client and a bookmark answer exactly as they always did.
    projections ? "ranks" : "ranks?projections=0",
    "Failed to load ranks",
    STALE_TIMES.ranks,
    true,
    null,
    season,
  );
}
