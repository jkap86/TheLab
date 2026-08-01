"use client";

import { useEffect, useState } from "react";

import { errorMessage } from "@/shared/util";

import { apiFetch, isAbortError } from "@/features/shared";
import type { ManagerLeague } from "../types";

export type ManagerResourceState<T> = {
  data: T | null;
  error: string | null;
};

/**
 * Reads one of the manager's cached sub-resources from
 * `/api/user/[username]/<path>`.
 *
 * Four routes under that prefix answer the same shape of question — the rosters,
 * the league membership, the projected ranks and the KTC values — and each is a
 * read of what the leagues stream has already written. They were four copies of
 * this function differing only in the path and the error string, which is four
 * places to fix the abort handling or the staleness rule below; the named hooks
 * beside this file are what they are now.
 *
 * Takes the leagues rather than a ready flag because these resources *follow*
 * them: each `result` the stream produces — including the second one a background
 * refresh sends — is exactly when the resource is worth re-reading, and the new
 * array identity is what re-runs the fetch. Null means the stream hasn't produced
 * a result yet; an empty list is a manager with no leagues. There is nothing to
 * ask for either way.
 *
 * Data already loaded stays put across a refetch — it is the same cache the view
 * is showing, and blanking several hundred rows to redraw them nearly unchanged
 * is worse than a moment of staleness. That is the one thing `useLeagueDetail`
 * does differently, and deliberately: there a changed id means the rows on screen
 * belong to a different league, so leaving them up would be showing the wrong
 * league's roster under the new name.
 */
export function useManagerResource<T>(
  searched: string,
  leagues: ManagerLeague[] | null,
  path: string,
  fallbackError: string,
): ManagerResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagues || leagues.length === 0) return;

    let active = true;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await apiFetch(
          `/api/user/${encodeURIComponent(searched)}/${path}`,
          { signal: controller.signal, fallbackError },
        );
        const json = (await res.json()) as T;
        if (active) {
          setData(json);
          setError(null);
        }
      } catch (err: unknown) {
        if (active && !isAbortError(err)) {
          setError(errorMessage(err, "Something went wrong"));
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [searched, leagues, path, fallbackError]);

  return { data, error };
}
