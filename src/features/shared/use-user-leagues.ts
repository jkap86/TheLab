"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import type { ManagerLeague } from "@/shared/manager";
import { errorMessage } from "@/shared/util";

import { cachedLeaguesRevision, publishManagerLeagues } from "./leagues-cache";
import { fetchManagerLeagues } from "./leagues-stream";
import { MANAGER_STALE_TIMES, managerQueryKeys } from "./manager-query";

export type UserLeaguesState = {
  leagues: ManagerLeague[] | null;
  /**
   * The season those leagues are for, as the route resolved it — null until the
   * first `result` lands.
   *
   * It rides on the stream and was simply discarded here, which was fine while
   * the only consumer was a menu of league names. The lineup checker's plate
   * states the season it is reading, and the honest source for that is the
   * answer itself: re-deriving it on the client would be a guess about when
   * Sleeper rolls a league year over, and reading it off a *second* payload
   * would be two answers to one question.
   */
  season: string | null;
  loading: boolean;
  error: string | null;
};

/**
 * A user's leagues off `/api/user/[username]/leagues`, for the pick tracker's
 * league picker and the lineup checker's list — just the list, none of the
 * progress-bar machinery the manager tool's own `useManagerLeagues` carries.
 *
 * **It is a query now, and that is the whole of the change.** It used to hold
 * its answer in `useState` behind a `useEffect`, which meant this — the single
 * most expensive route in the app, a blocking manager sync behind an advisory
 * lock — was re-streamed in full on *every mount*: a trip out to `/tools` and
 * back, a hop between the two tools that read it, or simply pressing back. Both
 * of those tools are separate routes, so that is the ordinary way they are used.
 * Filed in the cache it is one read per {@link MANAGER_STALE_TIMES.leagues}
 * window however many times it is mounted, and two tools open on one account are
 * one request rather than two.
 *
 * **It stays a separate hook from `useManagerLeagues`**, for the reason the four
 * manager sub-resource hooks *are* one hook: the two differ in what they
 * guarantee. That one reports per-league sync progress and a manual refresh,
 * because its header is built around them; this one wants the list, and clears
 * `loading` on the first `result` rather than waiting out a background refresh
 * that may still be syncing — a menu is fillable from the cached copy. Two hooks
 * that differ in what they promise are two hooks. What they no longer differ in
 * is the *protocol*: {@link fetchManagerLeagues} is one decoder for one stream,
 * the same line `takeLines` was already drawn along.
 *
 * That shared fetcher is what makes the mid-stream states work here, and they
 * are the reason `loading` is not `isPending`. The stream is
 * stale-while-revalidate, so the fetcher publishes each state it reaches
 * straight into this entry and only *resolves* at the end; the query is still
 * pending when the cached leagues arrive. Reading "have we a result yet" off the
 * published data is what keeps this hook's promise — the menu fills at the first
 * message, exactly as it did when this was `useState`.
 *
 * **Keyed by the account's username, which is what makes it the manager tool's
 * own entry rather than a second one beside it.** These two pages hold a
 * resolved account and could ask by either half of it; the manager tool has only
 * the name searched in its URL, so the name is the one spelling the three can
 * share — and `managerQueryKeys.leagues` lower-cases it, so `Jkap` typed into a
 * URL and the canonical `jkap` off a resolved profile are one entry. A reader
 * who has looked themselves up in the manager tool arrives here with the list
 * already loaded, and the same holds in reverse. It asks by name for the same
 * reason it files by name: Sleeper resolves a name as readily as an id, so
 * splitting the two would be two requests for one answer with nothing gained.
 *
 * Passing null — no account stored yet — fetches nothing and reports an empty,
 * idle state, which is the whole no-account path on the pick tracker's page (the
 * id form still works).
 *
 * `retry: false` keeps what this hook has always done. The manager tool takes
 * the client-wide single retry because its header can show a partial list behind
 * a failure; here a failed stream is the whole page, and a second round trip
 * only makes the error take longer to appear.
 */

/**
 * The query's options, as a value rather than an inline literal.
 *
 * Separated so the cache's own behaviour can be driven by a `QueryObserver` in a
 * test rather than through a renderer — the same argument `tradesBoardQuery`
 * rests on, and the reason the assertions in `user-leagues-cache.test.ts` are
 * about *request counts*. What it pins is that the config a test exercises is
 * the config the two pages run.
 *
 * It takes the client rather than reading one from context because that is the
 * only thing in here that is React's: `publish` writes each mid-stream state
 * into this very entry, and `previousRevision` reads the last one back out.
 *
 * **Both of those go through {@link publishManagerLeagues}, which is not a
 * convenience.** This tool and the manager tabs share the entry, so they share
 * what a new revision *means*: the rosters, membership, ranks, values and ADP
 * valuation derived from it are behind. Writing the entry here and leaving the
 * comparison to the manager tool made that comparison conditional on the manager
 * tool being mounted — so a refresh started from this page, while it wasn't,
 * invalidated nothing. See `leagues-cache.ts`.
 */
export function userLeaguesQuery(
  /** The account's username — the spelling the manager tool files under too. */
  username: string | null,
  queryClient: QueryClient,
) {
  const searched = username ?? "";
  return {
    queryKey: managerQueryKeys.leagues(searched),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchManagerLeagues({
        searched,
        signal,
        // Carried forward so a re-read continues the refresh sequence rather
        // than restarting it — which every reader of the entry would see as a
        // dependent-invalidating change.
        previousRevision: cachedLeaguesRevision(queryClient, searched),
        // Every state the stream reaches, published as it is learned. This is
        // what fills the menu at the first `result` instead of at the last —
        // and, where the revision moved, what tells the manager-derived reads.
        publish: (data) => publishManagerLeagues(queryClient, searched, data),
      }),
    enabled: username !== null,
    staleTime: MANAGER_STALE_TIMES.leagues,
    retry: false,
  };
}

export function useUserLeagues(username: string | null): UserLeaguesState {
  const queryClient = useQueryClient();
  // Memoised on the name: the options carry the key the fetcher's `publish`
  // closes over, and rebuilding them per render would rebuild that for nothing.
  const options = useMemo(
    () => userLeaguesQuery(username, queryClient),
    [username, queryClient],
  );

  const query = useQuery(options);

  const data = query.data ?? null;
  const result = data?.result ?? null;

  return {
    leagues: result?.leagues ?? null,
    season: result?.season ?? null,
    // "Asked, and no leagues to show yet" — deliberately not `isPending`, which
    // is wrong at both ends. A disabled query is pending forever, so a page with
    // no account would read as loading rather than idle; and publishing *any*
    // mid-stream state settles the query, so a cold account whose stream has so
    // far sent only `progress` would read as loaded with an empty menu. The
    // state this hook promises is about the payload, so it is read off the
    // payload.
    loading: username !== null && result === null && query.error === null,
    // A refresh that failed behind a payload worth keeping is a field on the
    // data; only a failure with nothing to show reaches the query's own error.
    error:
      data?.refreshError ??
      (query.error ? errorMessage(query.error, "Something went wrong") : null),
  };
}
