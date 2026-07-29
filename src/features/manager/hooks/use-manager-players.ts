"use client";

import { useEffect, useState } from "react";

import { errorMessage } from "@/shared/util";

import { apiFetch, isAbortError } from "@/features/shared";
import type { ManagerLeague, ManagerPlayersResult } from "../types";

export type ManagerPlayersState = {
  data: ManagerPlayersResult | null;
  error: string | null;
};

/**
 * Reads the manager's rosters from `/api/user/[username]/players`.
 *
 * Takes the leagues rather than a ready flag because the rosters follow them:
 * that route reads what the leagues stream writes, so each `result` — including
 * the second one a background refresh sends — is exactly when they are worth
 * re-reading, and the new array identity is what re-runs the fetch. Null means
 * the stream hasn't produced a result yet; an empty list is a manager with no
 * leagues, so there is nothing to ask for either way.
 *
 * The rosters already loaded stay put across a refetch. They are the same cache
 * the league list beside them is showing, and blanking several hundred rows to
 * redraw them nearly unchanged is worse than a moment of staleness.
 */
export function useManagerPlayers(
  searched: string,
  leagues: ManagerLeague[] | null,
): ManagerPlayersState {
  const [data, setData] = useState<ManagerPlayersResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagues || leagues.length === 0) return;

    let active = true;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await apiFetch(
          `/api/user/${encodeURIComponent(searched)}/players`,
          { signal: controller.signal, fallbackError: "Failed to load rosters" },
        );
        const json = (await res.json()) as ManagerPlayersResult;
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
  }, [searched, leagues]);

  return { data, error };
}
