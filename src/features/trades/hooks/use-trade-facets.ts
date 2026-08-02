"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { TradeFacetsPayload } from "@/shared/contract";

import { fetchTradeCount, fetchTradeFacets } from "../query-fns";
import { tradesQueryKeys } from "../query-keys";
import { tradeQueryKey } from "../trade-query";
import type { TradeRequest } from "../trade-query";

/**
 * The two things the trade filter dialog asks for, and they are two hooks
 * because they move at different rates.
 *
 * **Both are gated on the dialog being open**, which is what makes a
 * season-wide aggregate affordable at all: a reader who never opens the dialog
 * never asks for it, and that is most visits. `enabled` is the mechanism — a
 * null request means don't ask, the same shape `useAdp` uses to keep a closed
 * drawer from costing a request — and it is also why the dialog is dynamically
 * imported, so the same reader doesn't download it either.
 */

/**
 * How long the menus are reused. They are a fact about the season's trades, and
 * keyed by the scope they were counted over, so the common gesture — open,
 * adjust, close, reopen — is served from cache.
 */
export const TRADE_FACETS_STALE_TIME = 10 * 60 * 1000;

export type TradeFacetsState = {
  data: TradeFacetsPayload | null;
  loading: boolean;
  error: string | null;
};

/**
 * The three option lists.
 *
 * `request` should carry the **league scope and window only** — the caller
 * strips the draft selection, because these counts are taken without it and a
 * key that moved with it would re-run a grouped aggregate over the season on
 * every checkbox.
 *
 * `keepPreviousData` covers the one thing that *does* legitimately change the
 * key: the window. The menus are counted over the dates the draft describes, so
 * pressing a date chip re-asks — and without this every list would empty and
 * refill on each press, which reads as the dialog breaking. Holding the previous
 * answer while the next lands is the rule `useAdp` follows for the same reason.
 */
export function useTradeFacets(request: TradeRequest | null): TradeFacetsState {
  const query = useQuery({
    queryKey: tradesQueryKeys.facets(request ? tradeQueryKey(request) : ""),
    queryFn: ({ signal }) => fetchTradeFacets({ request: request!, signal }),
    enabled: request !== null,
    staleTime: TRADE_FACETS_STALE_TIME,
    placeholderData: keepPreviousData,
  });

  return {
    data: query.data ?? null,
    // `isPending` is true for a disabled query too, so a closed dialog would
    // read as loading forever; what this wants is "asked and not answered".
    loading: query.isFetching && !query.data,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

/**
 * How many trades the draft selection leaves — the footer's number.
 *
 * A short stale time relative to the menus, because this is the number a reader
 * is watching move; it is a `count(*)` over an indexed population, so re-asking
 * is cheap in a way the menus are not.
 */
export const TRADE_COUNT_STALE_TIME = 5 * 60 * 1000;

export function useTradeCount(request: TradeRequest | null): number | null {
  const query = useQuery({
    queryKey: tradesQueryKeys.count(request ? tradeQueryKey(request) : ""),
    queryFn: ({ signal }) => fetchTradeCount({ request: request!, signal }),
    enabled: request !== null,
    staleTime: TRADE_COUNT_STALE_TIME,
    // The count is what a checkbox moves, so it is re-asked on nearly every
    // press; holding the last one keeps the footer from flashing an em dash
    // between two numbers that differ by a few dozen.
    placeholderData: keepPreviousData,
  });

  return query.data?.total ?? null;
}
