"use client";

import { useMemo } from "react";

import { STALE_TIMES } from "../query-config";
import { managerQueryKeys } from "../query-keys";
import type { ManagerKtcResult, ManagerLeague } from "../types";
import { useManagerResource } from "./use-manager-resource";
import type { ManagerResourceState } from "./use-manager-resource";

export type ManagerKtcState = ManagerResourceState<ManagerKtcResult>;

/**
 * What the manager's roster in each league is worth on KeepTradeCut — the card's
 * KTC chip. Batched like the rank chip beside it and for the same reason: a
 * collapsed card costs no request, so a hundred of them each fetching a value
 * would undo that. See {@link useManagerResource} for why it takes the leagues
 * and reads only whether there are any.
 *
 * Fifteen minutes, the longest of the manager reads along with the ADP
 * valuation: the scrape behind it refreshes on the order of a day, so a value
 * re-read on every tab switch would be the same number every time.
 *
 * **`enabled` is what the KTC columns being off looks like from here.** Pricing
 * a manager's leagues is not a cheap read — the route solves every team's optimal
 * lineup in each of them — and none of it reaches the screen unless a stat column
 * or the columns editor's preview is showing a KTC metric. See
 * {@link managerDataRequirements} for who decides.
 */
export function useManagerKtc(
  searched: string,
  /**
   * The manager's canonical Sleeper id, off the leagues stream. Sent with the
   * read so the route needn't resolve the searched name through Sleeper again —
   * see {@link useManagerResource}.
   */
  userId: string | null,
  leagues: ManagerLeague[] | null,
  { enabled = true }: { enabled?: boolean } = {},
): ManagerKtcState {
  const queryKey = useMemo(() => managerQueryKeys.ktc(searched), [searched]);
  return useManagerResource<ManagerKtcResult>(
    queryKey,
    searched,
    userId,
    leagues,
    "ktc",
    "Failed to load values",
    STALE_TIMES.ktc,
    enabled,
  );
}
