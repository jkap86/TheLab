"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchJson } from "@/features/shared";
import { degradedStaleTime, matchupsDegraded } from "@/features/shared/degraded";
import { errorMessage } from "@/shared/util";

import { MATCHUPS_STALE_TIME, lineupQueryKeys } from "../query-keys";
import type { ManagerMatchupsPayload } from "../types";

// The stale time moved to `features/shared/lineup-query.ts`, beside the key it
// is about — the mover's rule this codebase keeps, and the same arrangement the
// league panel's and the manager tabs' windows already have. Re-exported under
// its old name: this tool's barrel already publishes it from here.
export { MATCHUPS_STALE_TIME };

export type ManagerMatchupsState = {
  data: ManagerMatchupsPayload | null;
  /** True until the first answer arrives; false again while a refresh runs. */
  loading: boolean;
  error: string | null;
  /**
   * True when the pairings answered but the week's lineup solve did not.
   *
   * Distinct from {@link error}, which is the whole read failing and leaves no
   * rows: here every row draws, with its opponent resolved and its numbers
   * blank. Reported so the page can say the blanks are a shortfall rather than
   * a hundred leagues that cannot be projected — and the entry behind it is
   * already stale, so nothing needs pressing.
   */
  degraded: boolean;
};

/**
 * Who this account plays this week, in every league it holds a roster in.
 *
 * Keyed by the account's `user_id` rather than a searched name, because this page
 * has no username in its URL — it reads the account resolved on `/tools` and
 * persisted since. Null means no account is stored, which fetches nothing and
 * reports an idle state: that is the whole no-account path here, the same shape
 * `useUserLeagues` takes for the pick tracker's picker.
 *
 * `week` is which week to ask about, or null to let the route resolve the one
 * the schedule is pointing at. Null is the page's opening state and a real
 * answer rather than a missing one — the payload always says which week it
 * settled on, so the caller reads that back instead of assuming.
 *
 * A failure leaves the opponents unresolved and nothing else — the league list is
 * its own read, so the rows still draw. Ask what a read is load-bearing for
 * before letting its failure take a page down.
 */
export function useManagerMatchups(
  userId: string | null,
  week: number | null = null,
): ManagerMatchupsState {
  const query = useQuery({
    queryKey: lineupQueryKeys.matchups(userId ?? "", week),
    queryFn: ({ signal }) =>
      fetchJson<ManagerMatchupsPayload>(
        // The id rides the query string as well as the path segment, and that is
        // not a duplication: the segment is `[username]`, which Sleeper would
        // have to be asked about because a name and an id are indistinguishable
        // there. `?user_id=` says "this one is already canonical", so a read that
        // is pure Postgres costs no upstream request — see
        // `resolveManagerIdRequest`.
        `/api/user/${encodeURIComponent(userId ?? "")}/matchups` +
          `?user_id=${encodeURIComponent(userId ?? "")}` +
          (week === null ? "" : `&week=${week}`),
        "Failed to load matchups",
        signal,
      ),
    enabled: userId !== null,
    // A week whose solve failed is drawn and immediately stale: the pairings on
    // it are real, and holding its blank projections as a fresh success for five
    // minutes is how one busy second read as "no league can be projected".
    staleTime: degradedStaleTime(MATCHUPS_STALE_TIME, matchupsDegraded),
    // Stepping a week is a *different question*, so it is a different key — and
    // without this every press would replace the whole list with a loading state
    // and back. Holding the previous week's rows while the next lands is the
    // same call the trades board and the four manager hooks make, and it matters
    // more here: the rows either side of a step are the same hundred leagues in
    // the same order, with two columns and a plate about to move.
    placeholderData: (previous) => previous,
  });

  return {
    data: query.data ?? null,
    // `isPending` is "no data yet", which for a disabled query is permanent —
    // hence the gate, so a page with no account reads as idle rather than as
    // forever loading.
    loading: userId !== null && query.isPending,
    error: query.error ? errorMessage(query.error, "Something went wrong") : null,
    degraded: query.data !== undefined && matchupsDegraded(query.data),
  };
}
