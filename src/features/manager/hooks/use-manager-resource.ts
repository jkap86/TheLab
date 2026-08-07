"use client";

import { useQuery, type QueryKey } from "@tanstack/react-query";

import { errorMessage } from "@/shared/util";

import { fetchManagerResource } from "../query-fns";
import type { ManagerLeague } from "../types";

export type ManagerResourceState<T> = {
  data: T | null;
  error: string | null;
  /** True while a refresh runs behind data already on screen. */
  refreshing: boolean;
};

/**
 * Reads one of the manager's cached sub-resources from
 * `/api/user/[username]/<path>`.
 *
 * Five routes under that prefix answer the same shape of question — the rosters,
 * the league membership, the projected ranks, the KTC values and the ADP
 * valuation — and each is a read of what the leagues stream has already written.
 * They were five copies of one fetch differing only in the path and the error
 * string; the named hooks beside this file are what they are now.
 *
 * **It takes the leagues, and reads only whether there are any.** That is the
 * change worth knowing about. The old version re-fetched on the array's
 * *identity*, so every render that rebuilt the list cost a request and a refresh
 * that changed nothing cost one too. What actually makes these resources stale is
 * a material change to the manager's leagues, which `leaguesRevision`
 * fingerprints and `useFilteredLeagues` acts on by invalidating exactly these
 * keys. So the argument is here to answer "is there anything to ask about yet" —
 * null means the stream hasn't produced a result, an empty list is a manager with
 * no leagues, and there is nothing to ask for either way.
 *
 * **It also takes the canonical `user_id`, and will not ask without one.** These
 * routes are pure Postgres reads keyed on that id; resolving the searched name
 * through Sleeper to arrive at it is a request per resource per page load, which
 * is what sending it removes (see {@link fetchManagerResource}). Gating on it as
 * well as on the leagues costs nothing — both arrive on the same stream message
 * — and it is what makes "resolve once, then read the database" a rule rather
 * than an optimisation a call site can forget.
 *
 * Data already loaded stays put across a refetch, which is the cache's own
 * behaviour now rather than something each hook has to remember: a failed
 * background refetch leaves the last good answer in place and reports the failure
 * beside it. That is the one thing `useLeagueDetail` does differently, and
 * deliberately — there a changed id means the rows on screen belong to a
 * different league.
 */
export function useManagerResource<T>(
  queryKey: QueryKey,
  searched: string,
  /** The manager's canonical Sleeper id, off the leagues stream. */
  userId: string | null,
  leagues: ManagerLeague[] | null,
  path: string,
  fallbackError: string,
  staleTime: number,
  /**
   * A second gate on top of "are there leagues to ask about".
   *
   * The views that are *about* a resource read it unconditionally; the ones that
   * only reach for it when a control is used pass this. The subject filter is
   * both of those at once — the search panel needs the lists when it opens, and
   * the narrowing needs them whenever a subject is selected — and the two gates
   * resolve to one request either way, because both callers name the same query
   * key and the cache is what deduplicates them.
   */
  enabled = true,
): ManagerResourceState<T> {
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      fetchManagerResource<T>(searched, path, fallbackError, signal, userId),
    enabled: enabled && userId !== null && (leagues?.length ?? 0) > 0,
    staleTime,
  });

  return {
    data: query.data ?? null,
    error: query.error ? errorMessage(query.error, "Something went wrong") : null,
    // `isFetching` with data already in hand: the views show a "showing cached
    // data" note rather than a loader, so the two states stay distinct.
    refreshing: query.isFetching && query.data !== undefined,
  };
}
