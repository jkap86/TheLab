"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { matchesFilters } from "@/features/shared";
import { useLeagueFilters, useSubjectFilters } from "../filters-context";
import { invalidateManagerDependents } from "../query-fns";
import { EMPTY_SUBJECT_INDEX, matchesSubjects } from "../subjects";
import type { Subject, SubjectIndex } from "../subjects";
import { useManagerLeagues } from "./use-manager-leagues";
import { useManagerLeaguemates } from "./use-manager-leaguemates";
import { useManagerPlayers } from "./use-manager-players";

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
  const { subjects } = useSubjectFilters();
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
  const leagueFiltered = useMemo(
    () => (leagues ?? []).filter((league) => matchesFilters(league, filters)),
    [leagues, filters],
  );

  // The rosters and membership the subject filter reads, fetched only while a
  // subject is selected. The search panel asks for the same two query keys when
  // it opens, so a reader browsing the menu and a reader with a selection cost
  // one request between them — and a tab nobody has used this control on costs
  // none. On the Players and Leaguemates tabs the page is already reading its
  // own half, which is the cache doing exactly what it is there for.
  const narrowing = subjects.subjects.length > 0;
  const leaguesForResources = stream.data?.leagues ?? null;
  const rosters = useManagerPlayers(searched, leaguesForResources, narrowing);
  const members = useManagerLeaguemates(searched, leaguesForResources, narrowing);
  const index: SubjectIndex = useMemo(
    () =>
      rosters.data || members.data
        ? {
            rosters: rosters.data?.rosters ?? {},
            members: members.data?.members ?? {},
          }
        : EMPTY_SUBJECT_INDEX,
    [rosters.data, members.data],
  );

  /**
   * The list the page renders — the league filters, then the subjects.
   *
   * Two passes rather than one predicate because the two are counted over
   * different populations: the subject search's per-name counts are read over
   * `leagueFiltered`, since a menu counted over its own selection collapses to
   * that selection the moment anything is picked and can't be widened again
   * without being cleared.
   *
   * While the maps are still loading the index is empty, so every league reads
   * as *unknown* and the list is empty rather than unnarrowed. That is the
   * honest state — a page that showed all 121 leagues under "owns Bijan" and
   * then dropped to 19 would have answered the question wrongly first.
   */
  const filtered = useMemo(
    () =>
      narrowing
        ? leagueFiltered.filter((league) =>
            matchesSubjects(league.league_id, subjects, index),
          )
        : leagueFiltered,
    [leagueFiltered, narrowing, subjects, index],
  );

  /**
   * What a selected subject is called, or null while the maps naming it load.
   *
   * It lives here because this is where those two payloads already are — the
   * header's scope line has to name what its record was counted over, and the
   * alternative was a second pair of reads in the layout for two strings.
   */
  const subjectLabel = useCallback(
    (subject: Subject): string | null =>
      subject.kind === "player"
        ? (rosters.data?.players[subject.id]?.name ?? null)
        : (members.data?.users[subject.id]?.display_name ?? null),
    [rosters.data, members.data],
  );

  // `searched` rides along so the layout can label its loading state and link its
  // tabs without the page threading it in a second time.
  return {
    ...stream,
    searched,
    filters,
    setFilters,
    subjectLabel,
    /** After the league filters, before the subjects — what the menus count over. */
    leagueFiltered,
    filtered,
    /** True while a selected subject's maps are still being read. */
    subjectsLoading: narrowing && !rosters.data && !members.data,
  };
}

export type FilteredLeagues = ReturnType<typeof useFilteredLeagues>;
