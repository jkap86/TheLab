"use client";

import { useQuery } from "@tanstack/react-query";

import type { TradeRostersPayload } from "@/shared/contract";

import { fetchTradeRosters } from "../query-fns";
import { tradesQueryKeys } from "../query-keys";

/**
 * One trade's pre-trade rosters, asked for only once a card has been opened.
 *
 * **Mounting is the gate**, the rule `useTradeFacets` arrived at: the panel this
 * feeds is rendered only while a card's disclosure is open, so there is no state
 * to check and the request is unconditional. `transactionId` is nullable anyway,
 * since a hook that cannot express "don't ask" is one a second caller has to work
 * around.
 *
 * **No `keepPreviousData`, which is where it parts company with every other query
 * on this page.** The board holds its previous pages through a filter change
 * because the rows are about to be *narrowed* and a flash of the loading flask is
 * worse than a moment of staleness. Here a different key is a different trade, so
 * the previous answer is another trade's rosters — the one case `useLeagueDetail`
 * already refuses a placeholder for, and for the same reason: showing the wrong
 * league's players under the right league's name is worse than showing none.
 */

/**
 * How long a snapshot is reused.
 *
 * **An hour, where nothing else on this page goes past fifteen minutes**, and the
 * asymmetry is honest rather than lax: what a roster held before a past trade does
 * not change once it is right. The one thing that *does* change is a snapshot
 * going from absent to written, which happens when the crawler first reaches the
 * league — so this is bounded rather than infinite, and the empty answer a reader
 * may briefly get corrects itself within the hour without a reload.
 */
export const TRADE_ROSTERS_STALE_TIME = 60 * 60 * 1000;

export type TradeRostersState = {
  data: TradeRostersPayload | null;
  loading: boolean;
  error: string | null;
};

export function useTradeRosters(
  transactionId: string | null,
): TradeRostersState {
  const query = useQuery({
    queryKey: tradesQueryKeys.rosters(transactionId ?? ""),
    queryFn: ({ signal }) =>
      fetchTradeRosters({ transactionId: transactionId!, signal }),
    enabled: transactionId !== null,
    staleTime: TRADE_ROSTERS_STALE_TIME,
  });

  return {
    data: query.data ?? null,
    // "Asked and not answered", never `isPending` — that is true of a disabled
    // query forever, which would leave a closed card reading as loading.
    loading: query.isFetching && !query.data,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
