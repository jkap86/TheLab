"use client";

import { useEffect, useState } from "react";

import { errorMessage } from "@/shared/util";

import { apiFetch, isAbortError } from "@/features/shared";
import type { ManagerLeague, ManagerLeaguematesResult } from "../types";

export type ManagerLeaguematesState = {
  data: ManagerLeaguematesResult | null;
  error: string | null;
};

/**
 * Reads the manager's league membership from `/api/user/[username]/leaguemates`.
 *
 * The same contract as `useManagerPlayers`, for the same reasons: that route
 * reads what the leagues stream writes, so each `result` — including the second
 * one a background refresh sends — is exactly when the membership is worth
 * re-reading, and the new array identity is what re-runs the fetch. The lists
 * already loaded stay put across a refetch rather than blanking a page of rows
 * to redraw them nearly unchanged.
 */
export function useManagerLeaguemates(
  searched: string,
  leagues: ManagerLeague[] | null,
): ManagerLeaguematesState {
  const [data, setData] = useState<ManagerLeaguematesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagues || leagues.length === 0) return;

    let active = true;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await apiFetch(
          `/api/user/${encodeURIComponent(searched)}/leaguemates`,
          {
            signal: controller.signal,
            fallbackError: "Failed to load leaguemates",
          },
        );
        const json = (await res.json()) as ManagerLeaguematesResult;
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
