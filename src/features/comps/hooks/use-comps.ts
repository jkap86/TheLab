"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { errorMessage } from "@/shared/util";

import { fetchJson } from "../../shared/api";
import { COMPS_STALE_TIMES, compsQueryKeys } from "../comps-query";

import type { CompsPayload } from "../types";

export type CompsState = {
  data: CompsPayload | null;
  error: string | null;
  loading: boolean;
  /**
   * The rows in `data` answer a *previous* selection, held on screen by
   * `keepPreviousData` while the new one loads — the `useAdp` flag, for the
   * same reason: the one dishonest state is old rows passing as the new
   * weights' answer, so the caller dims them and says "Updating…".
   */
  stale: boolean;
};

/**
 * One comps answer, keyed on the query string alone — a comps board is the
 * same board whoever asked. Null means don't ask (no subject picked yet), and
 * `keepPreviousData` keeps the last board on screen through a re-key rather
 * than blanking a list the reader is looking at.
 */
export function useComps(query: string | null): CompsState {
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

  return {
    data: result.data ?? null,
    error: result.error
      ? errorMessage(result.error, "Something went wrong")
      : null,
    loading: result.isFetching,
    stale: result.isPlaceholderData,
  };
}
