"use client";

import { useQuery } from "@tanstack/react-query";

import type { AdpDensityPayload } from "@/shared/contract";
import type { DraftDensityMonth } from "@/shared/manager";
import { errorMessage } from "@/shared/util";

import { fetchJson } from "./api";
import { ADP_STALE_TIMES, boardQueryKeys } from "./adp-query";

export type AdpDensityState = {
  /** Ascending by month; empty until the first load lands, and after a failure. */
  months: DraftDensityMonth[];
  error: string | null;
  loading: boolean;
};

/**
 * Crawled drafts per month and season, off `/api/adp/density` — the strip the
 * range scrubber draws under the ADP board's window, and the list of seasons the
 * drawer offers.
 *
 * Unlike {@link useAdp}, which is keyed by the board's query, this takes no query
 * and is one cache entry: the histogram describes the whole crawled population
 * *before* any board filter, deliberately, so it holds still while a window is
 * dragged across it. The season rides on every row rather than being asked for,
 * which is what lets the drawer slice to the season it is showing — and switch
 * seasons — without a second request. `enabled` is the drawer being open, the
 * same gate the board is behind; a tab nobody opened it on costs no request, and
 * a tab that opens it a second time costs none either.
 *
 * A failure leaves `months` empty rather than throwing the control away. The
 * scrubber still works without bars: the presets, the NFL calendar markers and
 * the handles need no density at all, so the strip degrades to an axis and the
 * caption says the activity is unavailable.
 */
export function useAdpDensity(enabled: boolean): AdpDensityState {
  const density = useQuery({
    queryKey: boardQueryKeys.density(),
    queryFn: ({ signal }) =>
      fetchJson<AdpDensityPayload>(
        "/api/adp/density",
        "Failed to load draft activity",
        signal,
      ),
    enabled,
    staleTime: ADP_STALE_TIMES.density,
  });

  return {
    months: density.data?.months ?? [],
    error: density.error
      ? errorMessage(density.error, "Something went wrong")
      : null,
    loading: density.isFetching,
  };
}
