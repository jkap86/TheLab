"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { errorMessage } from "@/shared/util";

import { fetchJson } from "../../shared/api";
import { compsState } from "../comps-state";
import { COMPS_STALE_TIMES, compsQueryKeys } from "../comps-query";

import type { CompsState } from "../comps-state";
import type { CompsPayload } from "../types";

export type { CompsState };

/**
 * One comps answer, keyed on the query string alone — a comps board is the
 * same board whoever asked. Null means don't ask (no subject picked yet), and
 * `keepPreviousData` keeps the last board on screen through a re-key rather
 * than blanking a list the reader is looking at.
 *
 * **`subjectId` is what that holding is bounded by, and the bound is the point
 * of the second argument.** Holding the previous board is right for a re-key
 * that changed the *comparison* — a weight, a window, a basis, a season — where
 * the rows on screen are still about the player named above them. It is wrong
 * for a re-key that changed the *subject*, where the heading has already moved
 * on. `compsState` is that decision, pure and tested.
 */
export function useComps(
  query: string | null,
  subjectId: string | null,
): CompsState {
  const result = useQuery({
    queryKey: compsQueryKeys.result(query ?? ""),
    queryFn: ({ signal }) =>
      fetchJson<CompsPayload>(
        `/api/comps?${query}`,
        "Failed to compute comps",
        signal,
      ),
    enabled: query !== null,
    staleTime: COMPS_STALE_TIMES.result,
    placeholderData: keepPreviousData,
  });

  return compsState(
    {
      data: result.data,
      error: result.error
        ? errorMessage(result.error, "Something went wrong")
        : null,
      isFetching: result.isFetching,
      isPlaceholderData: result.isPlaceholderData,
    },
    subjectId,
  );
}
