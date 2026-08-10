"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";

import type { TradesPagePayload } from "@/shared/contract";

import { retiredTradeBoards, type TradeBoardEntry } from "../board-retention";
import { fetchTradesPage } from "../query-fns";
import { tradesQueryKeys } from "../query-keys";
import { foldTradePages } from "../trades-data";
import type { TradesData } from "../trades-data";
import type { TradeRequest } from "../trade-query";

/**
 * How long a loaded board is worth reusing before it is asked for again.
 *
 * Still the longest stale time in the app, and still for the reason it always
 * was: trades arrive with the league syncs, so a board is barely different a
 * quarter of an hour later. What changed is the cost of being wrong — a stale
 * read used to mean re-reading a whole season, and now means re-reading the
 * pages the reader has actually scrolled through.
 */
export const TRADES_STALE_TIME = 15 * 60 * 1000;

/**
 * How long an abandoned board is kept after the last component stops reading it.
 *
 * **Its own policy, well under the client-wide 30 minutes.** The default is
 * sized for a manager's leagues and rosters — a few hundred KB that a trip out
 * to another tool and back should find still there. A trades board is a
 * different order of thing: a reader who scrolled a while is holding thousands
 * of trades plus every player, manager and price they name, and several filter
 * sets are several such entries, none of which is discarded while it is inside
 * `gcTime`. Five minutes keeps the common navigation (out to a card's league and
 * back) a hit while making a tab left open on another tool stop holding a board
 * nobody is reading.
 */
export const TRADES_GC_TIME = 5 * 60 * 1000;

export type { TradesData };

export type TradesState = {
  data: TradesData | null;
  /** True until the first page arrives. */
  loading: boolean;
  /** True while another page is on its way. */
  loadingMore: boolean;
  /**
   * True while what `data` holds is the *previous* filter set's board, kept on
   * screen until the new one's first page lands. Nothing about the list changes
   * — the point is that it doesn't — but the headline count says so, since it is
   * the number the filter was pressed to move.
   */
  stale: boolean;
  /** Whether the board has more to give. */
  hasMore: boolean;
  /** Ask for the next page. A no-op while one is already in flight. */
  loadMore: () => void;
  error: string | null;
};

/**
 * The board's infinite-query options, as a value rather than an inline literal.
 *
 * Separated so the cache's own behaviour can be driven by an
 * `InfiniteQueryObserver` in a test rather than through a renderer — the same
 * argument `features/manager/query-cache.test.ts` rests on, and the reason the
 * assertions there are about *request counts*. What it pins is that the config
 * a test exercises is the config the page runs.
 */
export function tradesBoardQuery(request: TradeRequest, key: string) {
  return {
    queryKey: tradesQueryKeys.board(key),
    queryFn: ({
      pageParam,
      signal,
    }: {
      pageParam: string | null;
      signal: AbortSignal;
    }) => fetchTradesPage({ request, cursor: pageParam, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: TradesPagePayload) => last.nextCursor,
    // No `maxPages`: see the note on the hook below, and `foldTradePages`.
    staleTime: TRADES_STALE_TIME,
    gcTime: TRADES_GC_TIME,
    placeholderData: keepPreviousData,
    // A failed board read fails the same way twice — a database that is down, a
    // season nothing has been crawled for — so the client-wide single retry only
    // doubles the wait before the error appears.
    retry: false,
  };
}

/**
 * The trades board, paginated.
 *
 * **This was a whole-season stream and is now an infinite query, which is the
 * change the rest of the page is arranged around.** As a stream it had one
 * virtue and one fatal cost: the season was whole, and getting it was ~20MB
 * before a reader could do anything but watch a counter. Paginated it keeps the
 * virtue — the board is still the whole season, and scrolling reaches all of it
 * — while the reader downloads the part they are looking at.
 *
 * `useInfiniteQuery` is doing three things worth naming:
 *
 * - **The cursor is the query's own state.** `getNextPageParam` reads
 *   `nextCursor` off the last page, so the resume position lives in the cache
 *   entry and survives a re-render, a remount and a navigation away and back.
 * - **A filter change is a different key, not an invalidation.** The key carries
 *   the normalised query string, so narrowing starts a fresh board and widening
 *   back finds the old one still loaded (inside `gcTime`) with its scroll
 *   position intact.
 * - **Loaded pages are never evicted.** There is deliberately no `maxPages`:
 *   React Query drops the *oldest* page when that bound is passed, and this
 *   board has no previous-page path to read it back with — a keyset walk resumes
 *   forwards only. See {@link foldTradePages} for the four things that broke
 *   when it did. What bounds memory instead is {@link TRADES_GC_TIME} for an
 *   abandoned board, {@link useBoundedBoardCache} for how many abandoned boards
 *   may pile up before that expires, and the DOM stays bounded at any depth
 *   because `TradesList` windows it.
 * - **`keepPreviousData` holds the last board while the next one lands.** That
 *   is what makes the filters committing live affordable: without it every press
 *   on the controls is a new key with nothing in it, so the whole list is replaced
 *   by the loading flask and back again — which is exactly the flash `useAdp`
 *   and the four manager hooks refuse for the same reason. Pagination is gated
 *   on it below, since asking a board that is on its way out for another page
 *   would append the old filters' next page to the new filters' first.
 *
 * The folded value is memoised on the raw pages, so {@link foldTradePages} runs
 * once per page arriving rather than once per render — this component's parent
 * re-renders on every filter keystroke, and the maps are what the list reads.
 *
 * `key` is {@link tradeQueryKey} of the same request, taken as an argument
 * rather than derived here because the caller already memoises it: with a large
 * league scope that string carries every league id, so building it twice a
 * render is real work over a list that grows with the corpus.
 */
export function useTrades(request: TradeRequest, key: string): TradesState {
  const query = useInfiniteQuery(tradesBoardQuery(request, key));
  useBoundedBoardCache(key);

  // What is on screen belongs to the filter set that has just been left. The
  // list is unchanged by design; what it gates is pagination and what it tells
  // the header is that the count beside it is about to move.
  const stale = query.isPlaceholderData;

  const data = useMemo(
    () => foldTradePages(query.data?.pages ?? EMPTY_PAGES),
    [query.data],
  );

  // Wrapped rather than handed out raw: `fetchNextPage` returns a promise, and
  // an unhandled rejection from a scroll handler that fired during teardown is
  // noise nobody can act on. React Query no-ops it while a page is in flight, so
  // there is no guard to add here.
  const { fetchNextPage } = query;
  const loadMore = useCallback(() => {
    // Held back while the board on screen is the previous filter set's: the
    // cursor belongs to that board, and `fetchNextPage` would resume the *new*
    // key from it. A scroll deep enough to ask again lands the moment the first
    // page arrives, so nothing is lost by declining now.
    if (stale) return;
    void fetchNextPage();
  }, [fetchNextPage, stale]);

  return {
    data,
    loading: query.isPending,
    loadingMore: query.isFetchingNextPage,
    stale,
    hasMore: query.hasNextPage && !stale,
    loadMore,
    error: query.error instanceof Error ? query.error.message : null,
  };
}

/** One frozen empty page list, so a board with no data folds to a stable null. */
const EMPTY_PAGES: readonly TradesPagePayload[] = [];

/**
 * Retire the trade boards nobody is reading any more, past a small bound.
 *
 * **The complement of "loaded pages are never evicted", not a retreat from it.**
 * Inside one board nothing is ever dropped, for all the reasons above; what this
 * bounds is how many *boards* a reader can be holding at once. Every press on
 * the filters is a different key with a full board behind it, and `gcTime` only
 * starts five minutes after the last reader lets go — long enough at the
 * keyboard that a reader working through a search holds every combination they
 * tried. {@link retiredTradeBoards} is where the decision lives and why it is
 * safe; here it is only applied.
 *
 * It runs on the key changing rather than on every render, which is the moment
 * a board is abandoned and the only moment the answer can change. Removal is
 * deliberate — `gcTime` cannot express "however many, but not more than this"
 * — and it is the one thing here that would be wrong to do during render, so it
 * is an effect: `removeQueries` notifies the cache, and a cache write inside a
 * render is a render that mutates something another component is reading.
 */
function useBoundedBoardCache(activeKey: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const boards: (TradeBoardEntry & { queryKey: readonly unknown[] })[] = [];

    for (const query of cache.getAll()) {
      const [scope, kind, boardKey] = query.queryKey as unknown[];
      // The board entries only — the season's leagues and the facet menus are
      // small, shared across filter sets, and expensive to re-ask for.
      if (scope !== "trades" || kind !== "board" || typeof boardKey !== "string") {
        continue;
      }
      boards.push({
        key: boardKey,
        updatedAt: query.state.dataUpdatedAt,
        observers: query.getObserversCount(),
        queryKey: query.queryKey,
      });
    }

    const retired = new Set(retiredTradeBoards(boards, activeKey));
    if (retired.size === 0) return;
    for (const board of boards) {
      if (retired.has(board.key)) {
        queryClient.removeQueries({ queryKey: board.queryKey, exact: true });
      }
    }
  }, [queryClient, activeKey]);
}
