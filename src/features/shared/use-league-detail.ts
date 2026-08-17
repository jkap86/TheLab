"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import type {
  LeagueCorePayload,
  LeagueOutlookPayload,
  LeagueValuesPayload,
  LeagueWeekPayload,
  LeagueWeekViewPayload,
} from "@/shared/contract";
import { errorMessage } from "@/shared/util";

import type { AdpRead } from "./adp-controls";
import { fetchJson, fetchScoped } from "./api";
import { LEAGUE_DETAIL_STALE_TIME, leagueQueryKeys } from "./league-query";

/**
 * One league's panel, as **four** independent reads.
 *
 * **The core is what the panel waits for; nothing else is.** It used to be one
 * query over one route that joined the rosters to the KTC/ADP prices, the
 * rest-of-season outlook and — for the lineup checker — that week's projections
 * and points per game, so opening a league meant waiting on the slowest of four
 * server reads before a single row was drawn. Measured against a seeded corpus,
 * that was ~305–490ms of database work for a payload whose structural half cost
 * ~53ms of it, and ~535–600ms once a week was asked for.
 *
 * Split, the panel renders on the core and the other three fill in:
 *
 *   - `core` — league, rosters, standings, managers, picks, player names.
 *   - `values` — KTC and ADP, keyed on the ADP drawer's board.
 *   - `outlook` — rest-of-season lineups, keyed on the league alone.
 *   - `week` — one week's projections and PPG, keyed on the week alone.
 *
 * **They are combined as state, never awaited together.** Composing them behind
 * a `Promise.all` in a single `queryFn` would recreate exactly the blocking this
 * replaced, with the extra requests as the only difference. What this returns is
 * a snapshot of whichever have answered so far, in the shape the panel already
 * consumed — so the components below it are unchanged and simply see empty
 * prices and a null outlook until those land.
 *
 * **Each fails on its own.** A KTC outage costs the value columns; a projections
 * failure costs the lineups; neither touches the rosters, because they are not
 * on the same response any more. Only the core's error is the panel's error.
 *
 * **And each fails as a failure.** That is a claim about the routes rather than
 * about these hooks — `…/week` and `…/outlook` used to catch a broken read and
 * answer `200 null`, which arrived here as a *successful* query holding nothing.
 * Nothing below could tell it from a league that genuinely has no outlook, the
 * client's one retry never ran (there was no failure to retry), and the empty
 * answer sat in the cache for `LEAGUE_DETAIL_STALE_TIME` — so a database busy
 * for a second cost the panel its lineups for five minutes. They send a 503 or a
 * 500 now (`app/api/read-response.ts`), so the query errors, retries once, and
 * caches nothing; a legitimate null (a league with no slots, no scoring or no
 * weeks left) is still a 200 and still a success. What the components see is
 * unchanged either way — `?? null` below is what makes an em dash of both.
 *
 * **The keys separate what genuinely varies.** Re-tuning the ADP board
 * re-fetches `values` and nothing else; stepping a week re-fetches `week` and
 * nothing else. Before this both were segments of one key, so either press
 * discarded the whole league.
 *
 * `board` is the ADP drawer's own read — the same one the collapsed card's team
 * value is priced on, so a drawer narrowed to startup drafts narrows the number
 * in the row as well as the number on the card. It is a request rather than a
 * string because the board's league rules resolve to ids a request line cannot
 * always carry, which is why `values` answers a POST as readily as a GET.
 *
 * `week` reads the same league as one Sunday, which the lineup checker asks for
 * and the leagues list and trades board do not: null means "as a season", and
 * the request is simply not made.
 */

/**
 * The panel's data, assembled from whichever of the four have answered.
 *
 * **The nulls here are the client's, not the wire's**, which is the distinction
 * the routes stopped blurring: an enrichment that is still in flight, was never
 * asked for, or *failed* all read as "nothing to draw yet" to a component, and
 * that collapse is right — the columns draw an em dash either way. What must not
 * collapse is the layer underneath, where a failed request has to stay a failed
 * request so the retry runs and nothing caches it as an answer. So the query
 * keeps its own status and this is a projection of it.
 */
export type LeagueDetailResult = LeagueCorePayload & {
  /** Empty maps until the values read lands — the columns draw em dashes. */
  values: LeagueValuesPayload;
  /** Null until the outlook lands, if it failed, or if the league has none. */
  outlook: LeagueOutlookPayload;
  /** Null on a season panel, until a week panel's week lands, and if it failed. */
  week_view: LeagueWeekViewPayload | null;
};

export type LeagueDetailState = {
  data: LeagueDetailResult | null;
  /** True only while the **core** has nothing to show — see the note above. */
  loading: boolean;
  /** The core's failure. An enrichment that fails costs its own columns. */
  error: string | null;
};

/**
 * The values a panel shows before its prices arrive: nothing priced, on the
 * board this league would read anyway.
 *
 * A shared constant rather than a fresh object per render, because the standings
 * memoise on it — and empty maps rather than a nullable field, because that is
 * the shape every consumer already handles: `rosterValueTotal` over an empty map
 * is null, which is the em dash a league with nothing priced has always drawn.
 */
const NO_VALUES: LeagueValuesPayload = {
  superflex: false,
  ktc_updated_at: null,
  adp_board: "redraft",
  adp_draft_count: 0,
  ktc: {},
  adp: {},
  adp_position: {},
};

/** `/api/league/[leagueId]` — the structural read the panel renders on. */
export function useLeagueCore(leagueId: string) {
  return useQuery({
    queryKey: leagueQueryKeys.core(leagueId),
    queryFn: ({ signal }) => fetchLeagueCore(leagueId, signal),
    staleTime: LEAGUE_DETAIL_STALE_TIME,
  });
}

/**
 * The core read as a plain function, so a prefetch can call it without a hook.
 *
 * It lives apart from the hook for the reason `fetchManagerLeagues` does: a
 * function taking its inputs as arguments is one a test — and
 * `queryClient.prefetchQuery` — can call, where the same fetch inside a hook is
 * only reachable through a renderer.
 */
export function fetchLeagueCore(
  leagueId: string,
  signal?: AbortSignal,
): Promise<LeagueCorePayload> {
  return fetchJson<LeagueCorePayload>(
    `/api/league/${encodeURIComponent(leagueId)}`,
    "Failed to load league",
    signal,
  );
}

/**
 * Warm one league's core read, for a reader who has shown they are about to open
 * it.
 *
 * **Core only.** The three enrichments are exactly the expensive reads, and
 * speculatively running a lineup solve per team per week for every card a
 * pointer crosses would spend far more than the hover could ever save.
 *
 * `prefetchQuery` is a no-op against a fresh entry, so a reader moving back and
 * forth over the same card costs one request rather than one per crossing.
 */
export function prefetchLeagueCore(client: QueryClient, leagueId: string): void {
  void client.prefetchQuery({
    queryKey: leagueQueryKeys.core(leagueId),
    queryFn: ({ signal }) => fetchLeagueCore(leagueId, signal),
    staleTime: LEAGUE_DETAIL_STALE_TIME,
  });
}

/** `…/values` — the two value columns, on the drawer's board. */
export function useLeagueValues(leagueId: string, board: AdpRead) {
  return useQuery({
    queryKey: leagueQueryKeys.values(leagueId, board.key),
    queryFn: ({ signal }) =>
      fetchScoped<LeagueValuesPayload>(
        `/api/league/${encodeURIComponent(leagueId)}/values`,
        board,
        "Failed to price this league",
        signal,
      ),
    staleTime: LEAGUE_DETAIL_STALE_TIME,
    // The prices are two columns of a table already on screen, so a board change
    // dims and replaces them rather than blanking them — the flash every other
    // hook here refuses. Compared against the *league* prefix rather than the
    // whole key, since a different league's prices under this league's rosters
    // is the one thing this must not do.
    placeholderData: (previous: LeagueValuesPayload | undefined, previousQuery) =>
      sameLeague(leagueId, previousQuery?.queryKey) ? previous : undefined,
  });
}

/** `…/outlook` — the rest-of-season lineups. */
export function useLeagueOutlook(leagueId: string) {
  return useQuery({
    queryKey: leagueQueryKeys.outlook(leagueId),
    queryFn: ({ signal }) =>
      fetchJson<LeagueOutlookPayload>(
        `/api/league/${encodeURIComponent(leagueId)}/outlook`,
        "Failed to project this league",
        signal,
      ),
    staleTime: LEAGUE_DETAIL_STALE_TIME,
  });
}

/**
 * `…/week` — one week's projections and points per game.
 *
 * A null week disables the query outright rather than sending a placeholder: a
 * season panel is not asking this question, and a disabled query is how that is
 * spelled.
 */
export function useLeagueWeek(leagueId: string, week: number | null) {
  return useQuery({
    queryKey: leagueQueryKeys.week(leagueId, week ?? 0),
    queryFn: ({ signal }) =>
      fetchJson<LeagueWeekPayload>(
        `/api/league/${encodeURIComponent(leagueId)}/week?week=${week}`,
        "Failed to read this week",
        signal,
      ),
    enabled: week !== null,
    staleTime: LEAGUE_DETAIL_STALE_TIME,
    // Stepping a week keeps the previous week's numbers on screen while the next
    // land, for the reason the values read does — the rows they annotate have not
    // changed. Same league only, on the same terms.
    placeholderData: (previous: LeagueWeekPayload | undefined, previousQuery) =>
      sameLeague(leagueId, previousQuery?.queryKey) ? previous : undefined,
  });
}

/**
 * Keep the previous answer only while it is about **this** league.
 *
 * `keepPreviousData` alone would hold another league's numbers under the new
 * league's rosters, which is the one thing these reads must never do; comparing
 * against the league prefix is what tells "a different board of the league on
 * screen" from "a different league".
 */
function sameLeague(leagueId: string, key: unknown): boolean {
  const prefix = leagueQueryKeys.league(leagueId);
  return Array.isArray(key) && prefix.every((segment, i) => key[i] === segment);
}

/**
 * The four reads as one snapshot — what the panel renders from.
 *
 * The composition is deliberately trivial: it reads whichever have answered and
 * hands the rest their empty forms. Nothing waits on anything.
 */
export function useLeagueDetail(
  leagueId: string,
  board: AdpRead,
  week: number | null = null,
): LeagueDetailState {
  const core = useLeagueCore(leagueId);
  const values = useLeagueValues(leagueId, board);
  const outlook = useLeagueOutlook(leagueId);
  const weekView = useLeagueWeek(leagueId, week);

  const data = useMemo(() => {
    if (!core.data) return null;
    return {
      ...core.data,
      values: values.data ?? NO_VALUES,
      outlook: outlook.data ?? null,
      week_view: weekView.data ?? null,
    } satisfies LeagueDetailResult;
  }, [core.data, values.data, outlook.data, weekView.data]);

  return {
    data,
    // The core alone. An enrichment still in flight is a column of em dashes on
    // a panel the reader is already reading, not a loading screen.
    loading: core.isPending,
    error: core.error ? errorMessage(core.error, "Something went wrong") : null,
  };
}
