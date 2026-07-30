"use client";

import { useMemo, useState } from "react";

import {
  DEFAULT_LEAGUE_FILTERS,
  matchesFilters,
  type LeagueFilters,
} from "../filters";
import { useManagerLeagues } from "./use-manager-leagues";

/**
 * The leagues stream plus the filter state every manager view sits on.
 *
 * All three tabs — leagues, players, leaguemates — read the same stream and
 * narrow it with the same controls, then each does its own thing with what's
 * left. This is that common half: the stream result, the filter state the
 * {@link LeaguesFilters} bar drives, and the filtered list the views count over.
 *
 * It stays a hook rather than folding into the layout because each page still
 * owns its `filtered` list — the players and leaguemates shares memoise on it, so
 * it has to be a value the page can read, not one buried in the chrome. The
 * chrome that renders around it lives once in {@link LeaguesViewLayout}; this is
 * the state behind that chrome.
 */
export function useFilteredLeagues(searched: string) {
  const stream = useManagerLeagues(searched);
  const [filters, setFilters] = useState<LeagueFilters>(DEFAULT_LEAGUE_FILTERS);

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
