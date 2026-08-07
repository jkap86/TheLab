"use client";

import { useCallback, useMemo, useState } from "react";

import type { UserInfo } from "@/shared/contract";

import {
  DEFAULT_LEAGUE_FILTERS,
  type LeagueFilters,
  matchesFilters,
  useUserLeagues,
} from "@/features/shared";
import {
  DEFAULT_SUBJECT_FILTERS,
  EMPTY_SUBJECT_INDEX,
  type Subject,
  type SubjectFilters,
  type SubjectIndex,
  type SubjectLabel,
  matchesSubjects,
} from "@/features/shared/subjects";
import type { SubjectView } from "@/features/shared/subject-view";
import { useManagerLeaguemates } from "@/features/shared/use-manager-leaguemates";
import { useManagerPlayers } from "@/features/shared/use-manager-players";

/**
 * The account's leagues plus the two filter selections the page narrows them
 * with — this tool's half of what the shared subject rail needs.
 *
 * **It is the lineup checker's `useFilteredLeagues`, and the differences between
 * the two are exactly the differences between the tools.** That one is keyed on a
 * name in the URL and holds its selections in providers, because the manager tool
 * is three *routes* sharing one selection; this one reads the account resolved on
 * `/tools` and persisted since, and holds both selections in `useState`, because
 * this tool is one page. Neither of those facts reaches the rail: what crosses is
 * {@link SubjectView}, which both satisfy.
 *
 * Three things are worth knowing about the seams it sits on.
 *
 * **The leagues arrive on `useUserLeagues` and the sub-resources on the manager
 * keys, which is not the inconsistency it looks like.** The list comes off the
 * stream keyed by `user_id` — the id is what this page holds, and that hook is
 * already what the pick tracker's picker reads. The rosters and membership behind
 * the subject filter are keyed by `searched`, and `searched` is the account's
 * *username*, so those entries are the same ones the manager tool fills: a reader
 * who has looked themselves up over there pays nothing here, and vice versa. One
 * manager, one spelling, one entry — the rule `managerQueryKeys` exists for.
 *
 * **The two league lists are both kept**, for the reason the manager tool keeps
 * both: `leagueFiltered` is what the subject menus count over, since a menu
 * counted over its own selection collapses to that selection the moment anything
 * is picked and cannot be widened again without being cleared.
 *
 * **While the maps behind a selection load the list is empty, not unnarrowed.** A
 * page that showed all 121 leagues under "owns Bijan" and then dropped to 19
 * would have answered the question wrongly first.
 */
export function useLineupView(user: UserInfo | null): LineupView {
  // Keyed by the id: this page has no username in its URL, and Sleeper resolves
  // an id as readily as a name. Null — no account stored — fetches nothing.
  const stream = useUserLeagues(user?.user_id ?? null);

  const [filters, setFilters] = useState<LeagueFilters>(DEFAULT_LEAGUE_FILTERS);
  const [subjects, setSubjects] = useState<SubjectFilters>(
    DEFAULT_SUBJECT_FILTERS,
  );

  // The cache spelling, which is the manager tool's: the username, so both tools
  // read one set of entries. Empty until an account resolves, which is also when
  // the reads below are gated off.
  const searched = user?.username ?? "";
  const userId = user?.user_id ?? null;
  const leagues = stream.leagues;

  const leagueFiltered = useMemo(
    () => (leagues ?? []).filter((league) => matchesFilters(league, filters)),
    [leagues, filters],
  );

  // Fetched only while a subject is selected. The rail's own search panel asks
  // for the same two query keys when it opens and each shares sheet does the
  // same, so a reader browsing and a reader with a selection cost one request
  // between them — and a page nobody has used the control on costs none.
  const narrowing = subjects.subjects.length > 0;
  const rosters = useManagerPlayers(searched, userId, leagues, narrowing);
  const members = useManagerLeaguemates(searched, userId, leagues, narrowing);

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
   * It answers for *both* kinds, which is why the tokens read it rather than the
   * menu beside them: a shares sheet only builds the option list for the kind it
   * lists, so naming a token from that list would leave a player token in the
   * leaguemates sheet showing a raw Sleeper id.
   */
  const subjectDisplay = useCallback(
    (subject: Subject): SubjectLabel | null => {
      if (subject.kind === "player") {
        const player = rosters.data?.players[subject.id];
        return player
          ? { name: player.name, position: player.position, avatarUrl: null }
          : null;
      }
      const member = members.data?.users[subject.id];
      return member
        ? {
            name: member.display_name || subject.id,
            position: null,
            avatarUrl: member.avatar_url,
          }
        : null;
    },
    [rosters.data, members.data],
  );

  return {
    searched,
    userId,
    leagues,
    leagueFiltered,
    filtered,
    filters,
    setFilters,
    subjects,
    setSubjects,
    subjectDisplay,
    // Until each map has settled, not until either lands: a leaguemate rule
    // judged with only the rosters in reads as a settled empty answer while
    // the membership it needs is still in flight. An errored read counts as
    // settled, so a failure doesn't dim the count forever.
    subjectsLoading:
      narrowing &&
      ((!rosters.data && !rosters.error) || (!members.data && !members.error)),
    /** The season the leagues route resolved — null until the first result. */
    season: stream.season,
    /** True only on a cold load; a background refresh leaves the list up. */
    loading: stream.loading,
    error: stream.error,
  };
}

/**
 * {@link SubjectView} plus the three things the page itself needs off the stream.
 *
 * Spelled as an intersection rather than inferred, so a field dropped from the
 * return above is an error here rather than a shared component quietly receiving
 * `undefined`.
 */
export type LineupView = SubjectView & {
  season: string | null;
  loading: boolean;
  error: string | null;
};
