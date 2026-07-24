"use client";

import { useEffect, useState } from "react";

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
 * unmount or when the league id changes.
 */
export function useLeagueDetail(
  leagueId: string,
  enabled: boolean,
): LeagueDetailState {
  const [data, setData] = useState<LeagueDetailResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || data) return;

    let active = true;
    const controller = new AbortController();

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/league/${encodeURIComponent(leagueId)}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "Failed to load league");
        }
        const json = (await res.json()) as LeagueDetailResult;
        if (active) setData(json);
      } catch (err: unknown) {
        if (active && (err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Something went wrong");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [leagueId, enabled, data]);

  return { data, loading, error };
}
