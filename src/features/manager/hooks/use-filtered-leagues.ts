"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { matchesFilters } from "@/features/shared";
import type { SubjectView } from "@/features/shared/subject-view";
import { useLeagueFilters, useSubjectFilters } from "../filters-context";
import { invalidateManagerDependents } from "../query-fns";
import { EMPTY_SUBJECT_INDEX, matchesSubjects } from "../subjects";
import type { Subject, SubjectIndex, SubjectLabel } from "../subjects";
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
  const { subjects, setSubjects } = useSubjectFilters();
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
  // The canonical id the stream resolved, which every dependent read sends back
  // so the route it hits needn't ask Sleeper who this name is a second time.
  const userId = stream.data?.user.user_id ?? null;
  const rosters = useManagerPlayers(
    searched,
    userId,
    leaguesForResources,
    narrowing,
  );
  const members = useManagerLeaguemates(
    searched,
    userId,
    leaguesForResources,
    narrowing,
  );
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
   * How a selected subject is drawn, or null while the maps naming it load.
   *
   * It lives here because this is where those two payloads already are — the
   * header's scope line has to name what its record was counted over, and the
   * alternative was a second pair of reads in the layout for two strings.
   *
   * **It answers for *both* kinds, which is the whole reason the tokens read it
   * rather than the menu.** A token is drawn in three places now — the rail's
   * storey and each shares sheet's — and a sheet only builds the option list for
   * the kind it lists, so naming a token from that list left a player token in the
   * leaguemates sheet (and a leaguemate token in the players sheet) showing a raw
   * Sleeper id. These two payloads are exactly the ones a selection already
   * forces, so the cross-kind answer is free: `narrowing` is true whenever there
   * is a token to draw at all.
   */
  const subjectDisplay = useCallback(
    (subject: Subject): SubjectLabel | null => {
      if (subject.kind === "player") {
        const player = rosters.data?.players[subject.id];
        return player
          ? { name: player.name, position: player.position, avatarUrl: null }
          : null;
      }
      const user = members.data?.users[subject.id];
      return user
        ? {
            name: user.display_name || subject.id,
            position: null,
            avatarUrl: user.avatar_url,
          }
        : null;
    },
    [rosters.data, members.data],
  );

  /** That name alone, for the plate's scope line — see {@link subjectSummary}. */
  const subjectLabel = useCallback(
    (subject: Subject): string | null => subjectDisplay(subject)?.name ?? null,
    [subjectDisplay],
  );

  // `searched` rides along so the layout can label its loading state and link its
  // tabs without the page threading it in a second time.
  //
  // **What this returns satisfies {@link SubjectView}**, which is what lets the
  // rail and the two shares sheets be shared components: the lineup checker
  // builds the same shape out of the stored account and plain `useState`, and
  // neither of those parts knows which of the two it is drawing over. The extra
  // fields here are the manager tool's own (the stream's progress, the revision,
  // the tab labelling), and structural typing is what makes carrying them free.
  return {
    ...stream,
    searched,
    /**
     * The manager's canonical Sleeper id, or null before the stream has said.
     *
     * Exposed rather than left inside because every dependent read needs it —
     * the views own their own calls to the rank, KTC and ADP hooks — and one
     * resolution feeding all of them is the whole point (see
     * {@link useManagerResource}).
     */
    userId,
    /**
     * Every league on the account, flat — {@link SubjectView} asks for this
     * rather than reaching through `data`, since the lineup checker's list
     * arrives on a different read and there is no payload for it to reach into.
     */
    leagues: leagues ?? null,
    filters,
    setFilters,
    subjects,
    setSubjects,
    subjectDisplay,
    subjectLabel,
    /** After the league filters, before the subjects — what the menus count over. */
    leagueFiltered,
    filtered,
    /** True while a selected subject's maps are still being read. */
    subjectsLoading: narrowing && !rosters.data && !members.data,
  };
}

export type FilteredLeagues = ReturnType<typeof useFilteredLeagues>;

// The agreement the shared rail rests on, checked here rather than at each of the
// call sites that pass a view: a field renamed on the return above is a type
// error in this file instead of one buried in `features/shared`.
const _satisfiesSubjectView: (view: FilteredLeagues) => SubjectView = (view) => view;
void _satisfiesSubjectView;
