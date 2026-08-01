"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { fetchTrades } from "../query-fns";
import { tradesQueryKeys } from "../query-keys";
import type { TradesStreamState } from "../stream";
import type { TradesResult } from "../types";

export type TradesState = {
  /** What has arrived so far — a real prefix of the season, newest first. */
  data: TradesResult | null;
  /** True until the first message arrives. */
  loading: boolean;
  /** True while trades are still arriving, i.e. after the first chunk. */
  streaming: boolean;
  error: string | null;
};

/**
 * How long a loaded season is worth reusing before the stream is opened again.
 *
 * The longest stale time in the app, and it earns that twice over. The data
 * moves at the league crawl's pace — trades arrive with the syncs, so a season
 * is barely different a quarter of an hour later — and re-asking is not a
 * request, it is the whole season read, serialised, gzipped and re-parsed.
 * Everywhere else a stale client read costs a request the server answers from
 * its cache; here it costs the most expensive read this app does.
 */
export const TRADES_STALE_TIME = 15 * 60 * 1000;

/**
 * Every completed trade in every crawled league, from the `/api/trades` stream.
 *
 * It takes a season and nothing else — unlike the manager tool's sub-resource
 * hooks, which take the leagues array because they read what that stream wrote.
 * This route is not scoped to an account at all, so there is nothing to wait for
 * and the leagues it names come back with it.
 *
 * **It is a query rather than a `useEffect` with `useState`, and that is the
 * whole of the change.** As an effect it was correct and had one property it
 * could not shed: the state lived in the component, so leaving `/trades` and
 * coming back re-read the season from the first byte — the most expensive read
 * in the app, repeated for a navigation. As a query it lands in the one client
 * cache the app shares, keyed by season and nothing else, so the second visit is
 * a hit and there is exactly one stream per page (React Query dedupes
 * concurrent observers of a key, which the effect had no way to do — two
 * components mounting this hook opened two streams).
 *
 * The streaming survives that move intact, which is the part worth
 * understanding. A query normally resolves once, at the end — which here would
 * mean a loading screen through a response the page could already be drawing.
 * So {@link fetchTrades} publishes each state it reaches straight into this
 * entry and *then* resolves with the last of them: the newest trades appear at
 * the first chunk, the rest fill in behind them, and the resolution is the value
 * the cache is already holding. It publishes on a cadence rather than per
 * network chunk, which is where most of the client-side saving is.
 *
 * Loaded data is not blanked on a refetch, the rule the manager hooks keep: it
 * is the list the page is showing, and clearing thousands of trades to redraw
 * them nearly unchanged is worse than a moment of staleness. A changed *season*
 * needs no handling at all now — it is a different key, so it is a different
 * entry, and the old season's trades are simply not this query's data.
 */
export function useTrades(season: string): TradesState {
  const queryClient = useQueryClient();
  // Memoised on the season alone: the key is what the fetcher below depends on,
  // and a fresh array every render would rebuild it for nothing.
  const queryKey = useMemo(() => tradesQueryKeys.season(season), [season]);

  const run = useCallback(
    ({ signal }: { signal: AbortSignal }) =>
      fetchTrades({
        season,
        signal,
        publish: (state) => queryClient.setQueryData(queryKey, state),
      }),
    [season, queryClient, queryKey],
  );

  const query = useQuery<TradesStreamState>({
    queryKey,
    queryFn: run,
    staleTime: TRADES_STALE_TIME,
    // A failed season read is expensive to retry and fails the same way twice —
    // a database that is down, a season nothing has been crawled for. The
    // client-wide default of one retry would double the wait before the error
    // appears, for a read this long.
    retry: false,
  });

  // The published states and the resolved one are the same shape, so whichever
  // the cache is holding reads identically — there is no window where a
  // mid-stream publish and a settled query disagree about what has arrived.
  const state = query.data ?? null;

  return {
    data: state?.data ?? null,
    loading: !state && query.isPending,
    // Fetching with something already in hand is the stream still running. It
    // is also what a background refetch of a stale season looks like, which is
    // the honest reading either way: more trades are on their way.
    streaming: query.isFetching && !query.isError,
    error:
      state?.error ??
      (query.error instanceof Error ? query.error.message : null),
  };
}
