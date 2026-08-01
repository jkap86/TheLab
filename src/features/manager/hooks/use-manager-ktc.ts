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
 */
export function useManagerKtc(
  searched: string,
  leagues: ManagerLeague[] | null,
): ManagerKtcState {
  const queryKey = useMemo(() => managerQueryKeys.ktc(searched), [searched]);
  return useManagerResource<ManagerKtcResult>(
    queryKey,
    searched,
    leagues,
    "ktc",
    "Failed to load values",
    STALE_TIMES.ktc,
  );
}
