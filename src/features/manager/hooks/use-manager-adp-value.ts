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
 * `board` is the ADP drawer's whole selection as a query string
 * (`adpValueQueryString`): the value curve, and the population it is applied to
 * — the season, the window, the kind of draft, the league size and the format.
 * It used to be the steepness alone, which left the panel narrowable to startup
 * drafts while every card went on being priced off every draft crawled.
 *
 * It rides in the **key** as well as the path, which is what makes the drawer
 * cheap to explore: every board already read is still in the cache, so dragging
 * the steepness back a notch or widening a window and narrowing it again costs
 * nothing. That is also why a change here invalidates nothing — the boards are
 * separate entries, not versions of one.
 */
export function useManagerAdpValue(
  searched: string,
  leagues: ManagerLeague[] | null,
  board: string,
): ManagerAdpValueState {
  const queryKey = useMemo(
    () => managerQueryKeys.adpValue(searched, undefined, board),
    [searched, board],
  );
  return useManagerResource<ManagerAdpValueResult>(
    queryKey,
    searched,
    leagues,
    `adp-value?${board}`,
    "Failed to load draft values",
    STALE_TIMES.adpValue,
  );
}
