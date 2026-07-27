"use client";

import { useEffect, useState } from "react";

import { errorMessage } from "@/shared/util";

import { apiFetch, isAbortError } from "@/features/shared";
import type { LeagueDetailResult } from "../types";

export type LeagueDetailState = {
  data: LeagueDetailResult | null;
  loading: boolean;
  error: string | null;
};

/**
 * Fetches a league's standings + rosters from `/api/league/[leagueId]`, lazily:
 * pass `enabled: false` (the collapsed state) to skip the request entirely so a
 * league is only loaded once its card is expanded. The fetch is aborted on
 * unmount and re-issued when the league id changes.
 */
export function useLeagueDetail(
  leagueId: string,
  enabled: boolean,
): LeagueDetailState {
  const [data, setData] = useState<LeagueDetailResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    const controller = new AbortController();

    (async () => {
      // Clear the previous league up front: a slow fetch must never leave the
      // last league's rosters on screen underneath the new id.
      setData(null);
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/league/${encodeURIComponent(leagueId)}`, {
          signal: controller.signal,
          fallbackError: "Failed to load league",
        });
        const json = (await res.json()) as LeagueDetailResult;
        if (active) setData(json);
      } catch (err: unknown) {
        if (active && !isAbortError(err)) {
          setError(errorMessage(err, "Something went wrong"));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [leagueId, enabled]);

  return { data, loading, error };
}
