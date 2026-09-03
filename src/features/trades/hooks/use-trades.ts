"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TradesPagePayload } from "@/shared/contract";
import { isAbortError } from "@/features/shared";

import { fetchTradesPage } from "../query-fns";
import type { TradeRequest } from "../trade-query";
import { foldTradePages } from "../trades-data";
import type { TradesData } from "../trades-data";

/**
 * The board itself: a keyset walk, one page at a time, appended.
 *
 * **Hand-rolled rather than `useInfiniteQuery`**, which is what TheLabX uses.
 * The runtime dependencies here are React, Next and `pg`, and what a query
 * library would buy over this is a shared cache across mounts and a
 * `keepPreviousData` flag — neither of which is worth a dependency for one
 * page. What it costs is spelled out below.
 *
 * Three things carry it, and each is a house idiom rather than a choice made
 * here:
 *
 * - **`key` is the subject, and the reset happens during render.** The key is
 *   the request's normalised query string (`tradeQueryKey`), so any change to
 *   what is being asked for restarts the board. Resetting in an effect instead
 *   would paint one frame of the old filter's trades under the new filter's
 *   count — the same reason `useManagerLeagues` resets during render.
 * - **One controller lineage.** Every fetch runs under the controller stored in
 *   `inFlight`, so a filter change aborts a `loadMore` that is still in the
 *   air; a response arriving after the key changed is discarded rather than
 *   appended to the wrong board.
 * - **`hasMore` is `nextCursor !== null` and nothing else.** A short page is
 *   the end of the board, but a page that happens to fill the limit exactly
 *   might also be — see `TradesPage.nextCursor`, which is the one signal that
 *   can tell them apart.
 *
 * **What is deliberately not here is `keepPreviousData`.** A filter press
 * blanks the list for one round trip rather than dimming the old rows under
 * the new count. At a hundred rows over a local database that is a flicker; if
 * it ever reads as a stall, the shape to add is a `previous` slot held across
 * the render-reset with a `stale` flag, which this hook's surface already
 * allows.
 */
export type TradesState = {
  /** Null until the first page lands — "no answer yet", never "no trades". */
  data: TradesData | null;
  /** A first page is in flight. */
  loading: boolean;
  /** A `loadMore` is in flight. */
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  error: string | null;
};

type Pages = {
  pages: TradesPagePayload[];
  nextCursor: string | null;
  /** The board is exhausted — a first page has landed and named no cursor. */
  done: boolean;
  error: string | null;
};

const EMPTY: Pages = {
  pages: [],
  nextCursor: null,
  done: false,
  error: null,
};

export function useTrades(
  request: TradeRequest,
  key: string,
  options: { limit?: number } = {},
): TradesState {
  const { limit } = options;
  const [state, setState] = useState<Pages>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  // The request object is rebuilt every render by the page that owns the
  // filters; the *key* is what says whether it changed. Held in a ref so the
  // fetching effect can depend on the key alone, and so `loadMore` reads the
  // current request without being re-created per render.
  const latest = useRef(request);
  // Refs mirroring the values `loadMore` guards on. Synced in an effect rather
  // than during render — a ref written mid-render is a value React cannot see,
  // and the lint rule that says so is right — and declared **first**, so every
  // one of them is current by the time the effects below run.
  const stateRef = useRef(state);
  const loadingRef = useRef(loading);
  const moreRef = useRef(loadingMore);
  useEffect(() => {
    latest.current = request;
    stateRef.current = state;
    loadingRef.current = loading;
    moreRef.current = loadingMore;
  });

  const [renderedKey, setRenderedKey] = useState(key);
  if (renderedKey !== key) {
    setRenderedKey(key);
    setState(EMPTY);
    setLoading(true);
    setLoadingMore(false);
  }

  useEffect(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    void (async () => {
      try {
        const page = await fetchTradesPage({
          request: latest.current,
          cursor: null,
          limit,
          signal: controller.signal,
        });
        setState({
          pages: [page],
          nextCursor: page.nextCursor,
          done: page.nextCursor === null,
          error: null,
        });
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        setState({
          ...EMPTY,
          done: true,
          error: err instanceof Error ? err.message : "Failed to load trades",
        });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
    // `key` is the subject; `request` is read through the ref so that rebuilding
    // an identical request object cannot restart the board.
  }, [key, limit]);

  // Stable across renders, deliberately: it is handed to an
  // IntersectionObserver, and a new identity per render would tear the
  // observer down and rebuild it — which, with the sentinel still on screen,
  // fires it again and walks the whole board in one go.
  const loadMore = useCallback(() => {
    const cursor = stateRef.current.nextCursor;
    if (cursor === null || loadingRef.current || moreRef.current) return;

    const controller = inFlight.current;
    if (!controller || controller.signal.aborted) return;

    setLoadingMore(true);
    void (async () => {
      try {
        const page = await fetchTradesPage({
          request: latest.current,
          cursor,
          limit,
          signal: controller.signal,
        });
        // Appended, never replacing: the first page is the only one carrying
        // the denominators, and the fold reads them off whichever page states
        // them first.
        setState((prev) =>
          // The board may have been reset while this was in the air — a reset
          // empties `pages`, and appending to it would put a later page's
          // trades at the top of a fresh board under the wrong count.
          prev.pages.length === 0
            ? prev
            : {
                pages: [...prev.pages, page],
                nextCursor: page.nextCursor,
                done: page.nextCursor === null,
                error: null,
              },
        );
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        // A failed *later* page leaves what is on screen alone and stops the
        // walk: the alternative is a sentinel that retries forever against a
        // route that is failing.
        setState((prev) => ({
          ...prev,
          done: true,
          error: err instanceof Error ? err.message : "Failed to load trades",
        }));
      } finally {
        if (!controller.signal.aborted) setLoadingMore(false);
      }
    })();
  }, [limit]);

  // The pages array only changes when one is appended, so the fold runs once
  // per page rather than once per render.
  const data = useMemo(() => foldTradePages(state.pages), [state.pages]);

  return {
    data,
    loading,
    loadingMore,
    hasMore: state.nextCursor !== null && !state.done,
    loadMore,
    error: state.error,
  };
}
