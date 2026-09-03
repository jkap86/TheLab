"use client";

import { useEffect, useRef, useState } from "react";

import type { TradeFacetsPayload } from "@/shared/contract";
import { isAbortError } from "@/features/shared";

import { fetchTradeFacets } from "../query-fns";
import type { TradeRequest } from "../trade-query";

/**
 * The search panel's menus and their counts.
 *
 * **Being mounted is the gate.** The panel unmounts when it closes, so a reader
 * who never opens it never asks for three grouped aggregates — which is what
 * makes them affordable. There is no `enabled` flag to get wrong.
 *
 * The `request` handed in should carry the league scope and the window but
 * **not** the selection: a menu counted over its own selection collapses to
 * that selection the moment you make one. The route strips it either way
 * (`facetsQuery`), so sending it would only re-fetch on every press for an
 * answer that cannot change.
 */
export type TradeFacetsState = {
  data: TradeFacetsPayload | null;
  loading: boolean;
  error: string | null;
};

export function useTradeFacets(
  request: TradeRequest,
  key: string,
): TradeFacetsState {
  const [state, setState] = useState<TradeFacetsState>({
    data: null,
    loading: true,
    error: null,
  });
  const inFlight = useRef<AbortController | null>(null);

  // The request object is rebuilt every render by the page that owns the
  // filters; the *key* is what says whether it changed, so the effect below
  // depends on the key and reads the request through a ref. Synced in an
  // effect of its own rather than during render — a ref written mid-render is
  // a value React cannot see — and declared first, so it is current by the
  // time the fetching effect runs.
  const latest = useRef(request);
  useEffect(() => {
    latest.current = request;
  });

  const [renderedKey, setRenderedKey] = useState(key);
  if (renderedKey !== key) {
    setRenderedKey(key);
    setState({ data: null, loading: true, error: null });
  }

  useEffect(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    void (async () => {
      try {
        const data = await fetchTradeFacets({
          request: latest.current,
          signal: controller.signal,
        });
        setState({ data, loading: false, error: null });
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        setState({
          data: null,
          loading: false,
          error:
            err instanceof Error ? err.message : "Failed to load filter options",
        });
      }
    })();

    return () => controller.abort();
  }, [key]);

  return state;
}
