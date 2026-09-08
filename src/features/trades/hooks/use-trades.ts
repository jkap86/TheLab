"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isAbortError } from "@/features/shared";

import { fetchTradesPage } from "../query-fns";
import type { TradeRequest } from "../trade-query";
import type { TradesData } from "../trades-data";
import {
  EMPTY_PAGES,
  canLoadMore,
  firstPageFailed,
  firstPageLoaded,
  morePageFailed,
  morePageLoaded,
  pagesHaveMore,
  retryingMore,
} from "../trades-pages";
import type { TradesPages } from "../trades-pages";

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
 *
 * ## The two failures are two different things
 *
 * A first page that fails leaves nothing to show, and the page says so. **A
 * *later* page that fails must not**: the reader is looking at a hundred cards
 * they successfully loaded, and until this split existed one dropped request
 * replaced all of them with an error box — a transient blip, and the board they
 * had scrolled through was gone.
 *
 * So `error` is the first page's and `loadMoreError` is the walk's, and the two
 * want opposite treatments: one replaces the page, the other is a line under
 * the last card with a key beside it. It is the distinction `useManagerLeagues`
 * already draws between `error` and `refreshError`, for the same reason.
 *
 * **A failed page does not end the board, either.** The old code set
 * `done: true` on a load-more failure — which stopped a sentinel from retrying
 * against a failing route forever, and did it by telling the reader they had
 * reached the end of a board they had not. `hasMore` still reflects what the
 * *server* said; what suspends the automatic walk is `loadMoreError` itself,
 * which {@link TradesState.retryLoadMore} clears and the list gates its
 * sentinel on. The cursor is untouched by a failure, so a retry resumes from
 * exactly where the walk stopped.
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
  /**
   * Ask for the failed page again, from the same cursor.
   *
   * Separate from {@link loadMore} because they are two intentions: one is the
   * sentinel scrolling into view, the other is a reader pressing a key after
   * being told something went wrong. `loadMore` refuses while a failure is
   * standing — otherwise the observer, which is still watching, would retry in
   * a loop — and this is what clears it.
   */
  retryLoadMore: () => void;
  /**
   * Ask for the first page again after it failed.
   *
   * The board restarts on a subject change, so before this there was no way to
   * retry a first page except by touching a filter — which is a different
   * question, not a second attempt at the same one.
   */
  retry: () => void;
  /** The first page failed; there is nothing to show. */
  error: string | null;
  /** A later page failed, behind trades that are on screen and stay there. */
  loadMoreError: string | null;
};

// The state and every transition over it live in `../trades-pages`, pure, so
// that "what does a failed second page mean" is a thing a test can ask. What is
// left here is the fetching, the abort lineage and the refs.
type Pages = TradesPages;
const EMPTY = EMPTY_PAGES;

export function useTrades(
  request: TradeRequest,
  key: string,
  options: { limit?: number; enabled?: boolean } = {},
): TradesState {
  // `enabled` is false only while this device's sync stamp is still unread —
  // one render, on a device that has ever synced (see `useTradeDataStamp`).
  // The stamp is part of `key`, so fetching then is a first page the very next
  // render aborts and reissues, with the server already committed to the query.
  const { limit, enabled = true } = options;
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
  useEffect(() => {
    latest.current = request;
    stateRef.current = state;
    loadingRef.current = loading;
  });

  /**
   * Whether a page request is already out.
   *
   * **A ref, not `loadingMore`**, and this is the guard that stops a retry
   * duplicating a page: `loadingMore` is a value a render closed over, so two
   * calls in one frame — an observer firing as a reader presses Retry — both
   * read `false` and both fetch, and both append the same hundred trades. It is
   * written synchronously at the top of the fetch and cleared in its `finally`,
   * so there is no window at all. `loadingMore` remains what the *view* reads.
   */
  const busy = useRef(false);

  /**
   * Bumped to re-run the first page for an unchanged subject.
   *
   * Its own state rather than a segment of the key, because it is not part of
   * what is being asked for: the key is the request, and a retry asks the same
   * request again. Kept out of {@link TradeRequest} for the same reason a
   * cursor is.
   */
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setLoading(true);
    setState(EMPTY);
    setAttempt((n) => n + 1);
  }, []);

  const [renderedKey, setRenderedKey] = useState(key);
  if (renderedKey !== key) {
    setRenderedKey(key);
    setState(EMPTY);
    setLoading(true);
    setLoadingMore(false);
  }

  useEffect(() => {
    if (!enabled) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    // A first page for a new subject supersedes whatever the last one was
    // doing. The abort above already ended it; this is what lets a `loadMore`
    // fire again once this lands, since that fetch's `finally` may not have run
    // yet when a filter changes mid-flight.
    busy.current = false;

    void (async () => {
      try {
        const page = await fetchTradesPage({
          request: latest.current,
          cursor: null,
          limit,
          signal: controller.signal,
        });
        setState(firstPageLoaded(page));
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        // Nothing loaded, so this is the page rather than a note on it.
        setState(
          firstPageFailed(
            err instanceof Error ? err.message : "Failed to load trades",
          ),
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
    // `key` is the subject; `request` is read through the ref so that rebuilding
    // an identical request object cannot restart the board. `attempt` is the
    // retry, which asks the same subject again.
  }, [key, limit, attempt, enabled]);

  /**
   * Fetch the next page from the cursor the board is holding.
   *
   * `force` is a retry: it clears a standing failure and ignores the guard that
   * failure puts on the automatic walk. Everything else about the two paths is
   * identical, which is the point — a retry resumes the *same* cursor through
   * the *same* code, so it cannot land differently from the attempt it repeats.
   */
  const fetchMore = useCallback(
    (force: boolean) => {
      const pages = stateRef.current;
      const cursor = pages.nextCursor;
      // Includes the rule that a standing failure suspends the sentinel:
      // without it the observer — still watching, because `hasMore` is still
      // true — would retry against a failing route on every scroll event.
      if (
        cursor === null ||
        !canLoadMore(pages, {
          loading: loadingRef.current,
          busy: busy.current,
          force,
        })
      ) {
        return;
      }

      const controller = inFlight.current;
      if (!controller || controller.signal.aborted) return;

      busy.current = true;
      setLoadingMore(true);
      if (force) setState(retryingMore);

      void (async () => {
        try {
          const page = await fetchTradesPage({
            request: latest.current,
            cursor,
            limit,
            signal: controller.signal,
          });
          // Drops the page if the board was reset while it was in the air, and
          // skips a trade already on the board so a retry racing a slow
          // response cannot duplicate a row.
          setState((prev) => morePageLoaded(prev, page));
        } catch (err: unknown) {
          if (isAbortError(err)) return;
          // **The cursor and `done` are untouched.** What is on screen stays,
          // the walk is suspended rather than ended, and a retry resumes from
          // exactly here. Marking the board done would tell the reader they had
          // reached the end of a board they had not.
          setState((prev) =>
            morePageFailed(
              prev,
              err instanceof Error ? err.message : "Failed to load trades",
            ),
          );
        } finally {
          // **Only if this fetch is still the current one.** An aborted request
          // rejects in a microtask, so a `finally` that cleared the guard
          // unconditionally could release it out from under a `loadMore` that
          // had already started on the new subject — and two in-flight requests
          // is the one way a retry duplicates a page. Work that was abandoned
          // does not get to say the board is idle; the first-page effect resets
          // the guard for the new subject instead.
          if (!controller.signal.aborted) {
            busy.current = false;
            setLoadingMore(false);
          }
        }
      })();
    },
    [limit],
  );

  // Stable across renders, deliberately: it is handed to an
  // IntersectionObserver, and a new identity per render would tear the
  // observer down and rebuild it — which, with the sentinel still on screen,
  // fires it again and walks the whole board in one go.
  const loadMore = useCallback(() => fetchMore(false), [fetchMore]);
  const retryLoadMore = useCallback(() => fetchMore(true), [fetchMore]);

  return {
    data: state.fold?.data ?? null,
    loading,
    loadingMore,
    // Server pagination state, never error state: a failure suspends the walk
    // through `loadMoreError`, and saying the board had ended would be a claim
    // about the data rather than about the request.
    hasMore: pagesHaveMore(state),
    loadMore,
    retryLoadMore,
    retry,
    error: state.error,
    loadMoreError: state.loadMoreError,
  };
}
