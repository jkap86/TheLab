"use client";

import { useEffect, useState } from "react";

import { errorMessage } from "@/shared/util";

import { apiFetch, isAbortError } from "@/features/shared";
import type { ManagerLeague, ManagerRanksResult } from "../types";

export type ManagerRanksState = {
  data: ManagerRanksResult | null;
  error: string | null;
};

/**
 * Reads the manager's projected-points rank per league from
 * `/api/user/[username]/ranks`.
 *
 * Takes the leagues for the reason `useManagerPlayers` does: the ranks follow
 * them. That route ranks over the rosters the leagues stream writes, so each
 * `result` — including the second one a background refresh sends — is exactly
 * when they are worth re-reading, and the new array identity is what re-runs
 * the fetch. Ranks already showing stay put across a refetch rather than
 * blanking a page of cards to redraw them nearly unchanged.
 */
export function useManagerRanks(
  searched: string,
  leagues: ManagerLeague[] | null,
): ManagerRanksState {
  const [data, setData] = useState<ManagerRanksResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagues || leagues.length === 0) return;

    let active = true;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await apiFetch(
          `/api/user/${encodeURIComponent(searched)}/ranks`,
          { signal: controller.signal, fallbackError: "Failed to load ranks" },
        );
        const json = (await res.json()) as ManagerRanksResult;
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
