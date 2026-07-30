"use client";

import { createContext, useContext, useState } from "react";

import { DEFAULT_LEAGUE_FILTERS, type LeagueFilters } from "./filters";

type LeagueFiltersValue = {
  filters: LeagueFilters;
  setFilters: (filters: LeagueFilters) => void;
};

const LeagueFiltersContext = createContext<LeagueFiltersValue | null>(null);

/**
 * Holds the league-list filters for one manager, shared by the Leagues, Players
 * and Leaguemates tabs.
 *
 * The three tabs are separate routes, so a filter chosen on one would snap back
 * to the default on the next without a store that outlives the navigation. This
 * provider is mounted once in the manager layout and keyed there by the searched
 * manager: the selection follows you between tabs, but still starts fresh when
 * you look at someone else — the per-manager reset the pages get from their own
 * `key`. It backs {@link useFilteredLeagues}, which reads it in place of the
 * per-view state each tab used to keep.
 */
export function LeagueFiltersProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [filters, setFilters] = useState<LeagueFilters>(DEFAULT_LEAGUE_FILTERS);
  return (
    <LeagueFiltersContext.Provider value={{ filters, setFilters }}>
      {children}
    </LeagueFiltersContext.Provider>
  );
}

/** The shared league filters. Throws outside the manager layout's provider. */
export function useLeagueFilters(): LeagueFiltersValue {
  const value = useContext(LeagueFiltersContext);
  if (!value) {
    throw new Error(
      "useLeagueFilters must be used within a LeagueFiltersProvider",
    );
  }
  return value;
}
