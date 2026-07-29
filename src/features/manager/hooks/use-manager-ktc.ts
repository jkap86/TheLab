"use client";

import { useEffect, useState } from "react";

import { errorMessage } from "@/shared/util";

import { apiFetch, isAbortError } from "@/features/shared";
import type { ManagerKtcResult, ManagerLeague } from "../types";

export type ManagerKtcState = {
  data: ManagerKtcResult | null;
  error: string | null;
};

/**
 * Reads what the manager's roster in each league is worth from
 * `/api/user/[username]/ktc`.
 *
 * Takes the leagues for the reason `useManagerRanks` does: the values follow
 * them. That route prices the rosters the leagues stream writes, so each
 * `result` — including the second one a background refresh sends — is exactly
 * when they are worth re-reading, and the new array identity is what re-runs the
 * fetch. Values already showing stay put across a refetch rather than blanking a
 * page of cards to redraw them nearly unchanged.
 */
export function useManagerKtc(
  searched: string,
  leagues: ManagerLeague[] | null,
): ManagerKtcState {
  const [data, setData] = useState<ManagerKtcResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagues || leagues.length === 0) return;

    let active = true;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await apiFetch(
          `/api/user/${encodeURIComponent(searched)}/ktc`,
          { signal: controller.signal, fallbackError: "Failed to load values" },
        );
        const json = (await res.json()) as ManagerKtcResult;
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
