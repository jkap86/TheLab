"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { AdpPayload } from "@/shared/contract";
import { errorMessage } from "@/shared/util";

import type { AdpRead } from "./adp-controls";
import { fetchScoped } from "./api";
import { ADP_STALE_TIMES, boardQueryKeys } from "./adp-query";

export type AdpState = {
  data: AdpPayload | null;
  error: string | null;
  loading: boolean;
  /**
   * The rows in `data` belong to a *previous* filter set, held on screen by
   * `keepPreviousData` while the newly-selected board loads. Distinct from
   * `loading`, which is also true during a background refetch of the *same*
   * board — where the rows on screen are the right answer and nothing should
   * dim. This is the trades board's own `stale` flag, for the same reason: the
   * one dishonest state is old rows passing as the new selection's answer.
   */
  stale: boolean;
};

/**
 * The ADP board for a query, off the global `/api/adp`.
 *
 * Unlike the manager sub-resources, this is *not* keyed to the manager: ADP
 * describes the drafts in the whole database narrowed by settings, so the same
 * filters are the same board whoever is being looked at, and the key is the
 * request alone (normalised, so two callers spelling the same filters in a
 * different order still land on one entry).
 *
 * **It takes an {@link AdpRead} rather than a query string**, because a board's
 * league rules resolve to a list of ids that can outgrow a request line. The key
 * is `read.key`, which inlines those ids whatever transport carried them — two
 * league sets that differ are two boards, and a key that dropped them would
 * serve one board's rows under another's filters.
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
  read: AdpRead | null,
  options: { enabled?: boolean } = {},
): AdpState {
  const { enabled = true } = options;
  const queryKey = useMemo(
    // A null read means the board isn't asked for at all; the placeholder key
    // is never fetched under, since `enabled` is false with it.
    () => boardQueryKeys.adp(read?.key ?? ""),
    [read?.key],
  );

  const board = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      fetchScoped<AdpPayload>("/api/adp", read!, "Failed to load ADP", signal),
    enabled: enabled && read !== null,
    staleTime: ADP_STALE_TIMES.board,
    placeholderData: keepPreviousData,
  });

  return {
    data: board.data ?? null,
    error: board.error ? errorMessage(board.error, "Something went wrong") : null,
    loading: board.isFetching,
    stale: board.isPlaceholderData,
  };
}
