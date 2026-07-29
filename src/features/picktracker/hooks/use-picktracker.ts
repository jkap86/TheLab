"use client";

import { useEffect, useState } from "react";

import { errorMessage } from "@/shared/util";

import { apiFetch, isAbortError } from "@/features/shared";
import type { PicktrackerPayload } from "../types";

export type PicktrackerState = {
  data: PicktrackerPayload | null;
  loading: boolean;
  error: string | null;
};

/**
 * Fetches a league's placeholder draft from `/api/picktracker/[leagueId]`.
 *
 * Bumping `refreshKey` refetches without clearing `data`, so a mid-draft
 * refresh updates the board in place instead of blanking it. A *league* change
 * does need a blank slate — the page keys the component by league id, so that
 * arrives as a fresh mount rather than a state transition here.
 */
export function usePicktracker(
  leagueId: string,
  refreshKey: number,
): PicktrackerState {
  const [data, setData] = useState<PicktrackerPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(
          `/api/picktracker/${encodeURIComponent(leagueId)}`,
          {
            signal: controller.signal,
            fallbackError: "Failed to load the draft",
          },
        );
        const json = (await res.json()) as PicktrackerPayload;
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
  }, [leagueId, refreshKey]);

  return { data, loading, error };
}
