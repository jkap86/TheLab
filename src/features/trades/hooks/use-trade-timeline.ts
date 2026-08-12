"use client";

import { useQuery } from "@tanstack/react-query";

import type { TradeTimelinePayload } from "@/shared/contract";

import { fetchTradeTimeline } from "../query-fns";
import { tradesQueryKeys } from "../query-keys";

/**
 * The league behind one trade, at every moment from that trade to today.
 *
 * **One request buys every stop on the rail**, which is what the payload's shape
 * is for: the browser is handed the league's log and rewinds it, so dragging the
 * timeline is arithmetic rather than a request per notch. There is nothing to
 * gate but the sheet being open.
 *
 * `transactionId` is nullable, so a closed sheet — and a sheet opened from
 * anywhere that isn't a trade card — costs nothing. The read is the heaviest one
 * on this page per request (it walks a league's transactions since the trade), so
 * it must not fire until a card has actually been pressed.
 *
 * **No `keepPreviousData`**, the rule `useTradeRosters` and `useLeagueDetail`
 * both keep: a different key here is a different league at a different moment, so
 * the previous answer is another league's rosters. Showing the wrong league's
 * players under the right league's name is worse than showing none.
 */

/**
 * How long a timeline is reused.
 *
 * **An hour, where nothing else on this board goes past fifteen minutes**, and
 * the asymmetry is the same one the pre-trade snapshot made: what a roster held
 * on a past date does not change once it is right. What *does* change is the
 * present end of the rail — a waiver claimed since the payload was fetched is a
 * move the sheet does not know about, so "now" would be an hour stale. That is
 * bounded rather than wrong: the sheet's own detail panel is a separate read on a
 * separate TTL, and it is the panel that draws the present. The rail's stops are
 * all in the past, which is exactly what an hour is honest about.
 */
export const TRADE_TIMELINE_STALE_TIME = 60 * 60 * 1000;

export type TradeTimelineState = {
  data: TradeTimelinePayload | null;
  loading: boolean;
  error: string | null;
};

export function useTradeTimeline(
  transactionId: string | null,
): TradeTimelineState {
  const query = useQuery({
    queryKey: tradesQueryKeys.timeline(transactionId ?? ""),
    queryFn: ({ signal }) =>
      fetchTradeTimeline({ transactionId: transactionId!, signal }),
    enabled: transactionId !== null,
    staleTime: TRADE_TIMELINE_STALE_TIME,
  });

  return {
    data: query.data ?? null,
    // "Asked and not answered", never `isPending` — that is true of a disabled
    // query forever, which would leave a sheet opened from anywhere else
    // reading as loading.
    loading: query.isFetching && !query.data,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
