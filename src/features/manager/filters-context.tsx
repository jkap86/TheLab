"use client";

import { createContext, useContext, useState } from "react";

import { DEFAULT_LEAGUE_FILTERS, type LeagueFilters } from "@/features/shared";

import { DEFAULT_SUBJECT_FILTERS, type SubjectFilters } from "./subjects";

// The ADP drawer's controls moved to `features/shared` once the trades page
// needed the same board and store; re-exported here because this feature's
// own consumers (`leagues-view-layout`, `manager-players`, `manager-leagues`)
// already import them from `./filters-context`.
export { AdpControlsProvider, useAdpControls } from "@/features/shared/adp-controls-context";

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

type SubjectFiltersValue = {
  subjects: SubjectFilters;
  setSubjects: (subjects: SubjectFilters) => void;
};

const SubjectFiltersContext = createContext<SubjectFiltersValue | null>(null);

/**
 * Holds the *who is in it* selection — the players and leaguemates narrowing the
 * league list — for one manager, across the same three tabs.
 *
 * **A third store rather than a field on the league filters, and the split is
 * the same one the ADP controls sit on.** Those filters describe what a league
 * *is*, they are the type `features/shared` exports, and the trades board runs
 * the identical predicate over a season of leagues it has no account for. A
 * subject is a lookup into this manager's rosters and membership, which that
 * page cannot answer and would never ask. Merging them would put a manager-only
 * field in a shared type and a narrowing in a shared predicate that only one of
 * its two callers can ever satisfy.
 *
 * Mounted beside the other two in the manager layout and keyed there by the
 * searched manager, so a selection follows you between tabs and still starts
 * fresh when you look at someone else.
 */
export function SubjectFiltersProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [subjects, setSubjects] = useState<SubjectFilters>(
    DEFAULT_SUBJECT_FILTERS,
  );
  return (
    <SubjectFiltersContext.Provider value={{ subjects, setSubjects }}>
      {children}
    </SubjectFiltersContext.Provider>
  );
}

/** The shared subject selection. Throws outside the manager layout's provider. */
export function useSubjectFilters(): SubjectFiltersValue {
  const value = useContext(SubjectFiltersContext);
  if (!value) {
    throw new Error(
      "useSubjectFilters must be used within a SubjectFiltersProvider",
    );
  }
  return value;
}

type ManagerSeasonValue = {
  /** The season the page is reading. */
  season: string;
  /**
   * The season the app itself is in — the ladder's ceiling, and the value
   * {@link seasonParam} compares against to decide whether a request names a
   * season at all.
   */
  activeSeason: string;
  setSeason: (season: string) => void;
};

const ManagerSeasonContext = createContext<ManagerSeasonValue | null>(null);

/**
 * Which season's leagues the three tabs are reading, driven by the header
 * plate's season stepper.
 *
 * **A fourth store rather than a field on the league filters, and the split is
 * the one the subject selection already sits on.** Those filters narrow the
 * leagues the page holds; the season decides which leagues it holds at all — it
 * re-keys the stream and every read hanging off it — so it is a population and
 * not a predicate. `LeagueFilters` is also the type the trades board runs over
 * leagues it has no account for, and a manager's *viewing* season means nothing
 * there.
 *
 * Mounted beside the other three in the manager layout and keyed there by the
 * searched manager, so the selection follows you between tabs and starts fresh
 * when you look at someone else — the same reset the filters get, and the right
 * one here: which season you were reading about one manager is not a claim about
 * the next.
 *
 * The current season arrives as a prop rather than being derived from a clock,
 * for the reason the ADP controls take theirs the same way: the layout is a
 * server component and `getActiveSeason()` is a server-side fact, where a client
 * guess would be a guess about when Sleeper rolls a league year over.
 */
export function ManagerSeasonProvider({
  season: activeSeason,
  children,
}: {
  /** The app's current season — the initial selection and the ladder's top. */
  season: string;
  children: React.ReactNode;
}) {
  const [season, setSeason] = useState(activeSeason);
  return (
    <ManagerSeasonContext.Provider value={{ season, activeSeason, setSeason }}>
      {children}
    </ManagerSeasonContext.Provider>
  );
}

/** The season being read. Throws outside the manager layout's provider. */
export function useManagerSeason(): ManagerSeasonValue {
  const value = useContext(ManagerSeasonContext);
  if (!value) {
    throw new Error(
      "useManagerSeason must be used within a ManagerSeasonProvider",
    );
  }
  return value;
}
