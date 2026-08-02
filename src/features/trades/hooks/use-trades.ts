"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type { Trade } from "@/shared/trades";

import { fetchTradesPage } from "../query-fns";
import { tradesQueryKeys } from "../query-keys";
import { tradeQueryKey } from "../trade-query";
import type { TradeRequest } from "../trade-query";
import type { KtcValue, PlayerSummary, TradeManager } from "../types";

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

/**
 * How many pages of a board are kept.
 *
 * `maxPages` is React Query's own bound on an infinite query, and it is the
 * memory half of the same argument: without it, scrolling a busy season to the
 * bottom accumulates every page ever fetched, which is the whole-season download
 * again arriving one scroll at a time. Twenty pages is 4,000 trades — far past
 * what anyone scrolls in one sitting, and a hard ceiling on what one entry can
 * grow to. Past it the oldest page is dropped and re-fetched if the reader
 * scrolls back, which for a keyset walk is one indexed query.
 */
export const TRADES_MAX_PAGES = 20;

/** What the board has loaded so far, folded across its pages. */
export type TradesData = {
  season: string;
  /** Newest first — every page's trades, in order. */
  trades: readonly Trade[];
  /** How many trades match the filters in full; null if the count failed. */
  total: number | null;
  /** How many the league filters alone leave — the "of M" in the headline. */
  scopeTotal: number | null;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  ktc: Record<string, KtcValue>;
};

export type TradesState = {
  data: TradesData | null;
  /** True until the first page arrives. */
  loading: boolean;
  /** True while another page is on its way. */
  loadingMore: boolean;
  /** Whether the board has more to give. */
  hasMore: boolean;
  /** Ask for the next page. A no-op while one is already in flight. */
  loadMore: () => void;
  error: string | null;
};

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
 * - **`maxPages` bounds it.** See {@link TRADES_MAX_PAGES}: an unbounded
 *   infinite query is the season download with extra steps.
 *
 * The folded value is memoised on the raw pages, so the concat-and-merge below
 * runs once per page arriving rather than once per render — this component's
 * parent re-renders on every filter keystroke, and the maps are what the list
 * reads.
 */
export function useTrades(request: TradeRequest): TradesState {
  const key = tradeQueryKey(request);

  const query = useInfiniteQuery({
    queryKey: tradesQueryKeys.board(key),
    queryFn: ({ pageParam, signal }) =>
      fetchTradesPage({ request, cursor: pageParam, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    maxPages: TRADES_MAX_PAGES,
    staleTime: TRADES_STALE_TIME,
    gcTime: TRADES_GC_TIME,
    // A failed board read fails the same way twice — a database that is down, a
    // season nothing has been crawled for — so the client-wide single retry only
    // doubles the wait before the error appears.
    retry: false,
  });

  const data = useMemo((): TradesData | null => {
    const pages = query.data?.pages;
    if (!pages || pages.length === 0) return null;

    const trades: Trade[] = [];
    const players: Record<string, PlayerSummary> = {};
    const managers: Record<string, TradeManager> = {};
    const ktc: Record<string, KtcValue> = {};

    for (const page of pages) {
      // `push(...page.trades)` would spread thousands of arguments onto the
      // stack once the board is deep; a loop is the same work without the
      // argument-count ceiling.
      for (const trade of page.trades) trades.push(trade);
      Object.assign(players, page.players);
      Object.assign(managers, page.managers);
      Object.assign(ktc, page.ktc);
    }

    // Only a first page carries them, and `maxPages` can evict it — so the last
    // non-null wins rather than `pages[0]`'s, which would blank the headline
    // after a long scroll.
    let total: number | null = null;
    let scopeTotal: number | null = null;
    for (const page of pages) {
      if (page.total !== null) total = page.total;
      if (page.scopeTotal !== null) scopeTotal = page.scopeTotal;
    }

    // **Never smaller than what is on screen.** The unnarrowed total is a
    // stored count refreshed on the crawler's tick, so it lags the trades it
    // counts by up to its TTL — normally by a handful, and by a lot on a
    // database that has just been filled. A denominator under its own numerator
    // is the one way that lag is visible, and it reads as the page being
    // broken; clamping states what is actually known, which is "at least this
    // many". It cannot mask a real shortfall, because the rows it is clamped
    // against came out of the same population it counts.
    if (total !== null && total < trades.length) total = trades.length;
    if (scopeTotal !== null && scopeTotal < trades.length) {
      scopeTotal = trades.length;
    }

    return {
      season: pages[0].season,
      trades,
      total,
      scopeTotal,
      players,
      managers,
      ktc,
    };
  }, [query.data]);

  // Wrapped rather than handed out raw: `fetchNextPage` returns a promise, and
  // an unhandled rejection from a scroll handler that fired during teardown is
  // noise nobody can act on. React Query no-ops it while a page is in flight, so
  // there is no guard to add here.
  const { fetchNextPage } = query;
  const loadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  return {
    data,
    loading: query.isPending,
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    loadMore,
    error: query.error instanceof Error ? query.error.message : null,
  };
}
