"use client";

import { useEffect, useState } from "react";

import type { ManagerLeague } from "@/shared/manager";
import { errorMessage } from "@/shared/util";

import { apiFetch, isAbortError } from "@/features/shared";
import type { TradesResult } from "../types";

export type TradesState = {
  data: TradesResult | null;
  /** True until the first answer for this account arrives. */
  loading: boolean;
  error: string | null;
};

/** An account with no leagues has no trades to ask about — a real answer. */
const NO_TRADES: TradesResult = {
  season: "",
  trades: [],
  players: {},
  managers: {},
};

/**
 * Every completed trade in the account's leagues, from
 * `/api/user/[username]/trades`.
 *
 * Takes the leagues rather than a ready flag, for the reason the manager tool's
 * sub-resource hooks do: this route reads what the *leagues stream* wrote, so
 * each `result` that stream produces — including the second one a background
 * refresh sends — is exactly when the trades are worth re-reading, and the new
 * array identity is what re-runs the fetch. Null means the stream hasn't
 * answered yet; an empty list is an account with no leagues, and neither is
 * something to ask the route about.
 *
 * Loaded data is not blanked on a refetch — it is the same cache the page is
 * showing, and clearing several hundred trades to redraw them nearly unchanged
 * is worse than a moment of staleness. A changed *account* is the exception, and
 * it is handled by stamping the fetched result with the account it belongs to
 * rather than by clearing state in an effect: a result for someone else is
 * simply not this account's answer, so it reads as "not loaded yet" the render
 * the account changes, with no cascading state update to get there.
 */
export function useTrades(
  userId: string | null,
  leagues: ManagerLeague[] | null,
): TradesState {
  const [state, setState] = useState<{
    userId: string;
    data: TradesResult | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!userId || !leagues || leagues.length === 0) return;

    let active = true;
    const controller = new AbortController();

    (async () => {
      try {
        const res = await apiFetch(
          `/api/user/${encodeURIComponent(userId)}/trades`,
          { signal: controller.signal, fallbackError: "Failed to load trades" },
        );
        const json = (await res.json()) as TradesResult;
        if (active) setState({ userId, data: json, error: null });
      } catch (err: unknown) {
        if (active && !isAbortError(err)) {
          setState((prev) => ({
            userId,
            data: prev?.userId === userId ? prev.data : null,
            error: errorMessage(err, "Something went wrong"),
          }));
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [userId, leagues]);

  if (!userId) return { data: null, loading: false, error: null };
  if (leagues?.length === 0) {
    return { data: NO_TRADES, loading: false, error: null };
  }

  const mine = state?.userId === userId ? state : null;
  return {
    data: mine?.data ?? null,
    loading: !mine,
    error: mine?.error ?? null,
  };
}
