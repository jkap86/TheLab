"use client";

import { useMemo } from "react";

import type { AdpRead } from "@/features/shared";
import { adpValueDegraded, degradedStaleTime } from "@/features/shared/degraded";

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
 * `board` is the ADP drawer's whole selection as one request (`adpValueRead`):
 * the value curve, and the population it is applied to — the season, the window,
 * the kind of draft, and the leagues its rules resolved to. It used to be the
 * steepness alone, which left the panel narrowable to startup drafts while every
 * card went on being priced off every draft crawled.
 *
 * A request rather than a string because those league ids can outgrow a request
 * line, which is why this route answers a POST as well as a GET. The key is
 * `board.key`, which inlines them regardless — two league sets that differ are
 * two boards whatever transport carried them.
 *
 * It rides in the **key** as well as the path, which is what makes the drawer
 * cheap to explore: every board already read is still in the cache, so dragging
 * the steepness back a notch or widening a window and narrowing it again costs
 * nothing. That is also why a change here invalidates nothing — the boards are
 * separate entries, not versions of one.
 *
 * **`enabled` is what the market columns being off looks like from here**, and it
 * composes with the key rather than fighting it: a reader who turns a column back
 * on re-enables the query against the same board key, so a board already read is
 * answered from the cache exactly as it would have been. See
 * {@link managerDataRequirements} for who decides.
 */
export function useManagerAdpValue(
  searched: string,
  /**
   * The manager's canonical Sleeper id, off the leagues stream. Sent with the
   * read so the route needn't resolve the searched name through Sleeper again —
   * see {@link useManagerResource}.
   */
  userId: string | null,
  leagues: ManagerLeague[] | null,
  board: AdpRead,
  {
    enabled = true,
    /**
     * Which season's *rosters* are being priced — not to be confused with the
     * board's own `board_season` inside `board.search`, which says which drafts
     * the prices come from. The two are independent on purpose: a 2024 roster is
     * legitimately read against this year's market.
     */
    season,
  }: { enabled?: boolean; season?: string } = {},
): ManagerAdpValueState {
  const queryKey = useMemo(
    () => managerQueryKeys.adpValue(searched, season, board.key),
    [searched, season, board.key],
  );
  return useManagerResource<ManagerAdpValueResult>(
    queryKey,
    searched,
    userId,
    leagues,
    "adp-value",
    "Failed to load draft values",
    // Per board, exactly as the key is: a board whose lineup solve failed is the
    // one entry that must not be reused, and every other board already read is
    // untouched.
    degradedStaleTime(STALE_TIMES.adpValue, adpValueDegraded),
    enabled,
    board,
    season,
  );
}
