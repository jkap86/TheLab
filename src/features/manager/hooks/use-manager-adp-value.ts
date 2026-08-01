"use client";

import { useMemo } from "react";

import { STALE_TIMES } from "../query-config";
import { managerQueryKeys } from "../query-keys";
import type { ManagerAdpValueResult, ManagerLeague } from "../types";
import { useManagerResource } from "./use-manager-resource";
import type { ManagerResourceState } from "./use-manager-resource";

export type ManagerAdpValueState = ManagerResourceState<ManagerAdpValueResult>;

/**
 * What the manager's roster in each league is worth valued off crawled ADP — the
 * card's ADP-value column. Batched like the rank and KTC chips beside it and for
 * the same reason: a collapsed card costs no request, so a hundred of them each
 * fetching a value would undo that. See {@link useManagerResource} for why it
 * takes the leagues and reads only whether there are any.
 *
 * `steepness` rides in the path so a change to the value curve re-fetches the
 * whole board — it changes every roster's number, not which leagues are read,
 * and the route re-prices them all with the new curve. It is a number of
 * halvings rather than a preset name, so the slider that sets it re-fetches per
 * notch it lands on and not per pixel it is dragged across.
 *
 * It rides in the **key** for the same reason, which is what makes the slider
 * cheap to explore: every curve already read is still in the cache, so dragging
 * back to one costs nothing. That is also why a change here invalidates nothing
 * — the curves are separate entries, not versions of one.
 */
export function useManagerAdpValue(
  searched: string,
  leagues: ManagerLeague[] | null,
  steepness: number,
): ManagerAdpValueState {
  const queryKey = useMemo(
    () => managerQueryKeys.adpValue(searched, undefined, steepness),
    [searched, steepness],
  );
  return useManagerResource<ManagerAdpValueResult>(
    queryKey,
    searched,
    leagues,
    `adp-value?steepness=${steepness}`,
    "Failed to load draft values",
    STALE_TIMES.adpValue,
  );
}
