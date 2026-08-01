"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { errorMessage } from "@/shared/util";

import { fetchJson } from "../query-fns";
import { STALE_TIMES } from "../query-config";
import { boardQueryKeys } from "../query-keys";
import type { AdpPayload } from "../types";

export type AdpState = {
  data: AdpPayload | null;
  error: string | null;
  loading: boolean;
};

/**
 * The ADP board for a query, off the global `/api/adp`.
 *
 * Unlike the manager sub-resources, this is *not* keyed to the manager: ADP
 * describes the drafts in the whole database narrowed by settings, so the same
 * filters are the same board whoever is being looked at, and the key is the
 * query alone (normalised, so two callers spelling the same filters in a
 * different order still land on one entry).
 *
 * **That is what removes the duplicate board request.** Two consumers ask for it
 * — the Players tab's own ADP column and the drawer's board — and while the
 * drawer was up they were two fetches of an identical query, because each hook
 * held its own state. Sharing a key makes concurrent consumers one request, and
 * makes opening the drawer over a board the page has already loaded cost none at
 * all: `enabled` gates the *fetch*, never the read, so a cached board is on
 * screen the moment the drawer opens.
 *
 * `keepPreviousData` is the old "loaded data stays put" rule, now stated rather
 * than hand-rolled: changing a filter shows the previous board with `loading`
 * set until the next one lands, instead of blanking every ADP cell to an em dash
 * and back. A filter *returned* to is a cache hit, so it doesn't blank either.
 */
export function useAdp(
  query: string | null,
  options: { enabled?: boolean } = {},
): AdpState {
  const { enabled = true } = options;
  const queryKey = useMemo(
    // A null query means the board isn't asked for at all; the placeholder key
    // is never fetched under, since `enabled` is false with it.
    () => (query ? boardQueryKeys.adp(query) : boardQueryKeys.adp("")),
    [query],
  );

  const board = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      fetchJson<AdpPayload>(`/api/adp?${query}`, "Failed to load ADP", signal),
    enabled: enabled && query !== null,
    staleTime: STALE_TIMES.adp,
    placeholderData: keepPreviousData,
  });

  return {
    data: board.data ?? null,
    error: board.error ? errorMessage(board.error, "Something went wrong") : null,
    loading: board.isFetching,
  };
}
