"use client";

import type { ManagerKtcResult, ManagerLeague } from "../types";
import { useManagerResource } from "./use-manager-resource";
import type { ManagerResourceState } from "./use-manager-resource";

export type ManagerKtcState = ManagerResourceState<ManagerKtcResult>;

/**
 * What the manager's roster in each league is worth on KeepTradeCut — the card's
 * KTC chip. Batched like the rank chip beside it and for the same reason: a
 * collapsed card costs no request, so a hundred of them each fetching a value
 * would undo that. See {@link useManagerResource} for why it takes the leagues
 * themselves.
 */
export function useManagerKtc(
  searched: string,
  leagues: ManagerLeague[] | null,
): ManagerKtcState {
  return useManagerResource<ManagerKtcResult>(
    searched,
    leagues,
    "ktc",
    "Failed to load values",
  );
}
