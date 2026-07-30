"use client";

import type { ManagerAdpValueResult, ManagerLeague } from "../types";
import { useManagerResource } from "./use-manager-resource";
import type { ManagerResourceState } from "./use-manager-resource";

export type ManagerAdpValueState = ManagerResourceState<ManagerAdpValueResult>;

/**
 * What the manager's roster in each league is worth valued off crawled ADP — the
 * card's ADP-value column. Batched like the rank and KTC chips beside it and for
 * the same reason: a collapsed card costs no request, so a hundred of them each
 * fetching a value would undo that. See {@link useManagerResource} for why it
 * takes the leagues themselves.
 */
export function useManagerAdpValue(
  searched: string,
  leagues: ManagerLeague[] | null,
): ManagerAdpValueState {
  return useManagerResource<ManagerAdpValueResult>(
    searched,
    leagues,
    "adp-value",
    "Failed to load draft values",
  );
}
