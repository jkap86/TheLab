"use client";

import { useEffect, useState } from "react";

import { errorMessage } from "@/shared/util";

import { apiFetch, isAbortError } from "@/features/shared";
import type { TradesResult } from "../types";

export type TradesState = {
  data: TradesResult | null;
  /** True until the first answer arrives. */
  loading: boolean;
  error: string | null;
};

/**
 * Every completed trade in every crawled league, from `/api/trades`.
 *
 * It takes a season and nothing else — unlike the manager tool's sub-resource
 * hooks, which take the leagues array because they read what that stream wrote.
 * This route is not scoped to an account at all, so there is nothing to wait for
 * and the leagues it names come back with it.
 *
 * Loaded data is not blanked on a refetch, the same rule those hooks keep: it is
 * the list the page is showing, and clearing several hundred trades to redraw
 * them nearly unchanged is worse than a moment of staleness. A changed *season*
 * is the exception, and it is handled by stamping the result with the season it
 * belongs to rather than by clearing state in an effect — a result for another
 * season is simply not this one's answer, so it reads as "not loaded yet" the
 * render the season changes, with no cascading state update to get there.
 */
export function useTrades(season: string): TradesState {
  const [state, setState] = useState<{
    season: string;
    data: TradesResult | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await apiFetch(
          `/api/trades?season=${encodeURIComponent(season)}`,
          { signal: controller.signal, fallbackError: "Failed to load trades" },
        );
        const json = (await res.json()) as TradesResult;
        if (active) setState({ season, data: json, error: null });
      } catch (err: unknown) {
        if (active && !isAbortError(err)) {
          setState((prev) => ({
            season,
            data: prev?.season === season ? prev.data : null,
            error: errorMessage(err, "Something went wrong"),
          }));
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [season]);

  const mine = state?.season === season ? state : null;
  return {
    data: mine?.data ?? null,
    loading: !mine,
    error: mine?.error ?? null,
  };
}
