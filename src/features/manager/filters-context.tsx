"use client";

import { createContext, useContext, useState } from "react";

import { type AdpControls, defaultAdpControls } from "./adp-controls";
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

type AdpControlsValue = {
  controls: AdpControls;
  setControls: (controls: AdpControls) => void;
};

const AdpControlsContext = createContext<AdpControlsValue | null>(null);

/**
 * Holds the ADP drawer's selection for one manager, shared by all three tabs —
 * the board filters that drive the Players-tab per-player ADP and the
 * value-curve steepness that drives the Leagues-tab team value.
 *
 * Mounted once in the manager layout beside {@link LeagueFiltersProvider} and
 * reset per manager the same way (the layout keys the subtree on the searched
 * name), so a board or curve chosen on one tab carries to the next but starts
 * fresh when you look at someone else.
 *
 * It holds a real selection from the start, unlike the league filters' sibling
 * history here: the board used to open on the viewed season, which this provider
 * doesn't know, so `controls` was null until a tab filled it in. A date range
 * needs no season, so the default is season-independent and the null — with the
 * `?? defaultAdpControls(season)` each consumer carried — is gone.
 */
export function AdpControlsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [controls, setControls] = useState<AdpControls>(defaultAdpControls);
  return (
    <AdpControlsContext.Provider value={{ controls, setControls }}>
      {children}
    </AdpControlsContext.Provider>
  );
}

/** The shared ADP controls. Throws outside the manager layout's provider. */
export function useAdpControls(): AdpControlsValue {
  const value = useContext(AdpControlsContext);
  if (!value) {
    throw new Error("useAdpControls must be used within an AdpControlsProvider");
  }
  return value;
}
