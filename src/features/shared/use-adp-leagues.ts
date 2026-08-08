"use client";

import { useQuery } from "@tanstack/react-query";

import type { AdpLeaguesPayload } from "@/shared/contract";
import type { ManagerLeague } from "@/shared/manager";

import { fetchJson } from "./api";
import { ADP_STALE_TIMES, boardQueryKeys } from "./adp-query";

/** One frozen empty, so a caller's memo isn't invalidated while this is idle. */
const NO_LEAGUES: ManagerLeague[] = [];

export type AdpLeaguesState = {
  leagues: ManagerLeague[];
  loading: boolean;
  error: string | null;
};

/**
 * The crawled leagues behind the ADP board, off `/api/adp/leagues`.
 *
 * **What the board's league rules run over.** They are a predicate engine over
 * Sleeper's blobs — slot groups derived from the solver's own tables, scoring
 * keys read off the leagues in hand, a size — so they cannot be re-implemented
 * in SQL without drifting silently; the browser evaluates them against this list
 * and sends the answer as league ids. The same arrangement the trades board has
 * with `/api/trades/leagues`, and two reads rather than one shared one because
 * the populations genuinely differ: a trade there, a draft here.
 *
 * **Gated, because it is the largest thing either page fetches.** Two callers
 * ask for it and they ask for different reasons — the drawer needs it whenever
 * it is *open*, since the dialog's per-option counts and its scoring-key menu
 * are read off it; the controls store needs it whenever a rule is *set*, since
 * that is when the board is actually narrowed by one. Both name the same key, so
 * the two gates are one request; and a reader who has opened neither pays
 * nothing.
 *
 * Not keyed to any manager, for the reason `useAdp` isn't: this describes the
 * whole crawled corpus, so it is the same answer whoever is being looked at.
 */
export function useAdpLeagues(
  season: string,
  options: { enabled?: boolean } = {},
): AdpLeaguesState {
  const { enabled = true } = options;

  const query = useQuery({
    queryKey: boardQueryKeys.leagues(season),
    queryFn: ({ signal }) =>
      fetchJson<AdpLeaguesPayload>(
        `/api/adp/leagues?season=${encodeURIComponent(season)}`,
        "Failed to load leagues",
        signal,
      ),
    enabled,
    staleTime: ADP_STALE_TIMES.leagues,
  });

  return {
    leagues: query.data?.leagues ?? NO_LEAGUES,
    loading: query.isFetching,
    error: query.error ? String(query.error.message ?? query.error) : null,
  };
}
