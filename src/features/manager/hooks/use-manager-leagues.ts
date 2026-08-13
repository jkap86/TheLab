"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import {
  cachedLeaguesRevision,
  publishManagerLeagues,
} from "@/features/shared/leagues-cache";
import type { ManagerLeaguesData } from "@/features/shared/leagues-stream";
import { errorMessage } from "@/shared/util";

import { STALE_TIMES } from "../query-config";
import { fetchManagerLeagues } from "../query-fns";
import { managerQueryKeys } from "../query-keys";
import type { LeaguesResult, SyncProgress } from "../types";

export type ManagerLeaguesState = {
  data: LeaguesResult | null;
  progress: SyncProgress | null;
  refreshing: boolean;
  error: string | null;
  /**
   * The fingerprint dependent reads follow — see `leaguesRevision`.
   *
   * Reported, not acted on: what a *change* to it means is settled at the write
   * (`publishManagerLeagues`), so no consumer of this hook has to notice one.
   */
  revision: string | null;
  /**
   * Re-read the stream now, whatever the client cache holds.
   *
   * **It does not force a Sleeper refresh, and it is named for what it does.**
   * It was `refresh`, documented as "sync again, past the server's own freshness
   * gate", and it sent `?refresh=1` — a parameter the route honours only for an
   * internally authorized caller and ignores from a browser. So the promise was
   * never kept: what a reader got was this, a re-read that picks up whatever a
   * background refresh has since written and lets the server decide whether to
   * ask Sleeper at all. That protection stays (a public forced fan-out is the
   * thing this app deliberately has no endpoint for); the name and the request
   * are what changed, so nothing here claims otherwise. Any UI built on it must
   * be labelled the same way — "Reload", not "Force refresh from Sleeper".
   */
  revalidate: () => void;
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
 * `revalidate` re-runs the stream past this query's own stale time. What it
 * cannot do is spend Sleeper budget on demand: forcing a sync past the server's
 * TTL is the full ~11-requests-per-league fan-out, so `?refresh=1` is honoured
 * only for an internally authorized caller (see `app/api/internal-auth.ts`) and
 * this hook no longer sends it. It used to, and the parameter was ignored on
 * every browser request that carried it — a promise made in the name, in the
 * doc comment and in the query string, and kept nowhere. What a re-read *does*
 * buy is real and is what a reader wants from such a control: the server decides
 * whether its own data is due a refresh, and the stream delivers whatever a
 * background sync has since written.
 */
export function useManagerLeagues(searched: string): ManagerLeaguesState {
  const queryClient = useQueryClient();
  // Memoised on the manager alone: a fresh key array every render is a new
  // `useQuery` key object and a rebuilt `revalidate` for nothing.
  const queryKey = useMemo(() => managerQueryKeys.leagues(searched), [searched]);

  // Both entry points — the query and the manual re-read — run the same stream
  // into the same entry. Neither asks the server to force a Sleeper sync; the
  // fetcher keeps that option for the operator path that can actually use it.
  //
  // **Publishing goes through the shared writer, and that is where this tool's
  // dependent reads are told they are behind.** It used to be an effect in
  // `useFilteredLeagues` comparing each revision against the last one *that
  // mount* saw, which is a comparison only made while the manager tool is on
  // screen: the pick tracker and the lineup checker write this same entry, so a
  // refresh either of them ran while this tool was unmounted arrived here as a
  // first sighting and invalidated nothing. See `features/shared/leagues-cache`.
  const run = useCallback(
    (signal?: AbortSignal) =>
      fetchManagerLeagues({
        searched,
        signal,
        // Carried forward so a re-run continues the refresh sequence rather than
        // restarting it, which would read as a dependent-invalidating change.
        previousRevision: cachedLeaguesRevision(queryClient, searched),
        publish: (data) => publishManagerLeagues(queryClient, searched, data),
      }),
    [searched, queryClient],
  );

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => run(signal),
    staleTime: STALE_TIMES.leagues,
  });

  const revalidate = useCallback(
    () => revalidateLeagues(queryClient, queryKey, run),
    [queryClient, queryKey, run],
  );

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
    revalidate,
  };
}

/**
 * Run the stream again past this entry's stale time, and let the *query* own how
 * it went.
 *
 * `revalidate` returns void, so the promise `fetchQuery` hands back has nobody
 * to hand a failure to — and a bare `void` in front of it says "ignore the
 * value", never "ignore the rejection". A re-read fails for the ordinary reasons
 * the first read does (Sleeper unreachable behind the route, the dyno out of
 * budget, the browser offline), so the unhandled rejection was not a theoretical
 * one; what kept it out of production is only that nothing is wired to this yet,
 * which is exactly the state in which it is cheapest to fix.
 *
 * **The rejection is swallowed rather than reported, and that is the whole
 * decision this function names.** `fetchQuery` writes the failure into the same
 * cache entry the hook is already reading — the query's own `error`, or
 * `refreshError` where the stream had leagues to keep — so the reader has been
 * told. Logging here would be the same failure twice, and rethrowing it would be
 * a crash for a control that has already reported itself.
 *
 * Exported so that contract can be driven directly: the hook cannot be, without
 * a renderer this repo deliberately does not carry, and the property worth
 * pinning — a rejected re-read escapes nowhere — is invisible in review and
 * silent in the type.
 */
export function revalidateLeagues(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  run: (signal?: AbortSignal) => Promise<ManagerLeaguesData>,
): void {
  void queryClient
    .fetchQuery({
      queryKey,
      queryFn: ({ signal }) => run(signal),
      staleTime: 0,
    })
    .catch(() => {
      // Deliberately empty: see above. The query state is the report.
    });
}
