"use client";

import { useEffect, useRef, useState } from "react";

import type { CompPlayersPayload } from "@/shared/contract";
import { isAbortError } from "@/features/shared";

import { fetchCompPlayers } from "../query-fns";

/**
 * The subjects and the corpus's bounds, asked for once.
 *
 * `useTradeLeagues`' shape: one controller lineage, `loading` derived from
 * the two answers rather than stored, and a failure **reported** — this list
 * is the only thing the search field has to offer, and a field that opens
 * onto nothing with no word saying why is indistinguishable from a corpus
 * with nobody in it.
 */
export type CompPlayersState = {
  payload: CompPlayersPayload | null;
  loading: boolean;
  error: string | null;
};

export function useCompPlayers(): CompPlayersState {
  const [payload, setPayload] = useState<CompPlayersPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    void (async () => {
      try {
        const answer = await fetchCompPlayers({ signal: controller.signal });
        setPayload(answer);
        setError(null);
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        setError(err instanceof Error ? err.message : "Failed to load players");
      }
    })();

    return () => controller.abort();
  }, []);

  return { payload, loading: payload === null && error === null, error };
}
