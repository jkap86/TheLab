"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import { matchesFilters } from "@/features/shared";
import { useLeagueFilters } from "../filters-context";
import { invalidateManagerDependents } from "../query-fns";
import { useManagerLeagues } from "./use-manager-leagues";

/**
 * The leagues stream plus the filter state every manager view sits on.
 *
 * All three tabs — leagues, players, leaguemates — read the same stream and
 * narrow it with the same controls, then each does its own thing with what's
 * left. This is that common half: the stream result, the filter state the
 * {@link LeagueFiltersModal} drives, and the filtered list the views count over.
 *
 * It stays a hook rather than folding into the layout because each page still
 * owns its `filtered` list — the players and leaguemates shares memoise on it, so
 * it has to be a value the page can read, not one buried in the chrome. The
 * chrome that renders around it lives once in {@link LeaguesViewLayout}; this is
 * the state behind that chrome.
 *
 * The filter state itself lives one level up, in the manager layout's
 * {@link LeagueFiltersProvider}, so the selection is shared across the three tabs
 * rather than reset on each navigation between them. The stream's data lives one
 * level further out still — in the query cache, which outlives the layout too.
 *
 * **This is also where a refreshed stream tells the dependent reads they are
 * behind.** The rosters, membership, ranks, values and ADP valuation are all
 * derived from what a sync writes, and they used to re-fetch on the leagues
 * array's identity — five requests per rebuild of a list that may not have
 * changed at all. `revision` is the honest signal (see `leaguesRevision`), and it
 * is compared against the last one *this mount* saw: a first sighting is what
 * every navigation between tabs produces, so it invalidates nothing.
 */
export function useFilteredLeagues(searched: string) {
  const stream = useManagerLeagues(searched);
  const { filters, setFilters } = useLeagueFilters();
  const queryClient = useQueryClient();

  const revision = stream.revision;
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!revision) return;
    const previous = seen.current;
    seen.current = revision;
    // First sighting on this mount — which is what arriving from another tab
    // looks like. The data behind it is exactly what those queries already read.
    if (previous === null || previous === revision) return;
    invalidateManagerDependents(queryClient, searched);
  }, [revision, searched, queryClient]);

  const leagues = stream.data?.leagues;
  const filtered = useMemo(
    () => (leagues ?? []).filter((league) => matchesFilters(league, filters)),
    [leagues, filters],
  );

  // `searched` rides along so the layout can label its loading state and link its
  // tabs without the page threading it in a second time.
  return { ...stream, searched, filters, setFilters, filtered };
}

export type FilteredLeagues = ReturnType<typeof useFilteredLeagues>;
