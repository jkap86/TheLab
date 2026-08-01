"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { errorMessage } from "@/shared/util";

import { STALE_TIMES } from "../query-config";
import { fetchManagerLeagues, type ManagerLeaguesData } from "../query-fns";
import { managerQueryKeys } from "../query-keys";
import type { LeaguesResult, SyncProgress } from "../types";

export type ManagerLeaguesState = {
  data: LeaguesResult | null;
  progress: SyncProgress | null;
  refreshing: boolean;
  error: string | null;
  /** The fingerprint dependent reads follow — see `leaguesRevision`. */
  revision: string | null;
  /** Sync again, past the server's own freshness gate. */
  refresh: () => void;
};

/**
 * A manager's leagues, off the stale-while-revalidate stream at
 * `/api/user/[username]/leagues`.
 *
 * The decoding is unchanged and lives in {@link fetchManagerLeagues}; what moved
 * is where the result goes. It used to be `useState` inside this hook, which
 * meant the three manager tabs — three routes, so three mounts — each opened
 * their own stream: Leagues → Players → Leaguemates → Leagues was four reads of
 * the same account. It is a query now, so the second tab reads what the first
 * one loaded and only asks again once that has gone stale.
 *
 * The streaming survives that move intact, which is the part worth understanding.
 * A query normally resolves once, at the end — which here would mean sitting on a
 * loading screen through a refresh whose cached half the server had already sent.
 * So the fetcher publishes every state it reaches straight into this entry, and
 * *then* resolves with the last of them: the cached leagues appear at the first
 * message, the refreshed ones replace them at the last, and the resolution is the
 * value the cache is already holding.
 *
 * `refresh` re-runs the stream with `?refresh=1` rather than appending a
 * cache-busting parameter. Invalidating alone would not do: it re-asks the same
 * question, and the server answers a fresh manager from its own cache — forcing
 * the sync past that TTL is the one thing the client cannot decide for itself.
 */
export function useManagerLeagues(searched: string): ManagerLeaguesState {
  const queryClient = useQueryClient();
  // Memoised on the manager alone: the key is what the callbacks below depend
  // on, and a fresh array every render would rebuild all of them for nothing.
  const queryKey = useMemo(() => managerQueryKeys.leagues(searched), [searched]);

  // Both entry points — the query and the manual refresh — run the same stream
  // into the same entry, differing only in whether they force a sync.
  const run = useCallback(
    (refresh: boolean, signal?: AbortSignal) =>
      fetchManagerLeagues({
        searched,
        refresh,
        signal,
        // Carried forward so a re-run continues the refresh sequence rather than
        // restarting it, which would read as a dependent-invalidating change.
        previousRevision:
          queryClient.getQueryData<ManagerLeaguesData>(queryKey)?.revision,
        publish: (data) => queryClient.setQueryData(queryKey, data),
      }),
    [searched, queryClient, queryKey],
  );

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => run(false, signal),
    staleTime: STALE_TIMES.leagues,
  });

  const refresh = useCallback(() => {
    void queryClient.fetchQuery({
      queryKey,
      queryFn: ({ signal }) => run(true, signal),
      staleTime: 0,
    });
  }, [queryClient, queryKey, run]);

  const data = query.data ?? null;
  return {
    data: data?.result ?? null,
    progress: data?.progress ?? null,
    refreshing: data?.refreshing ?? false,
    // A refresh that failed behind a payload worth keeping is a field on the
    // data; only a failure with nothing to show reaches the query's own error.
    error:
      data?.refreshError ??
      (query.error ? errorMessage(query.error, "Something went wrong") : null),
    revision: data?.revision ?? null,
    refresh,
  };
}
