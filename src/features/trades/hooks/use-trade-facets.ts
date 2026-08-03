"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { TradeFacetsPayload } from "@/shared/contract";

import { fetchTradeFacets } from "../query-fns";
import { tradesQueryKeys } from "../query-keys";
import { tradeQueryKey } from "../trade-query";
import type { TradeRequest } from "../trade-query";

/**
 * The option lists the trade filter ledge is built on.
 *
 * **It is gated on the ledge being open**, which is what makes a season-wide
 * grouped aggregate affordable at all: a reader who never opens it never asks
 * for it, and that is most visits. The gate used to be `enabled` against a null
 * request, because the dialog existed whether or not it was showing; the panel
 * is unmounted while the ledge is closed, so **mounting is the gate** and the
 * request is unconditional. `enabled` is kept anyway, since a hook that cannot
 * express "don't ask" is one a second caller has to work around.
 *
 * There was a second hook here, `useTradeCount`, for the dialog footer's "N
 * trades match". The ledge commits live, so the board's own `total` *is* that
 * number — one route fewer, and no way for the two to disagree.
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
