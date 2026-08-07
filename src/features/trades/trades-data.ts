import type { TradesPagePayload } from "@/shared/contract";

import type { KtcValue, PlayerSummary, Trade, TradeManager } from "./types.ts";

/**
 * The fold of an infinite query's pages into the one value the board renders.
 *
 * It is a pure function in its own module for the reason `incremental` and
 * `pick-value` are: the rules it carries — that pages only ever *append*, that
 * the first page is what states the denominators, that a stored total is never
 * allowed to sit under the rows it is counting — are exactly the rules a test
 * should be able to drive without a renderer or a `QueryClient` behind it. The
 * hook that calls it (`hooks/use-trades`) memoises on the raw page array, so
 * this runs once per page arriving rather than once per render.
 *
 * **Pages accumulate and are never evicted.** The query used to carry React
 * Query's `maxPages`, which drops the *oldest* page once the bound is passed —
 * and every other assumption on this page is that the array only grows: the
 * virtualizer keys its measurements off trade ids, `advanceFiltered` judges a
 * prefix once and appends, and the first page is the only one carrying `total`
 * and `scopeTotal`. Past twenty pages that bound silently deleted trades the
 * reader had already scrolled past, shrank the list under the scroll position,
 * blanked the headline counts, and forced the residual filter into a full
 * re-pass — and nothing could bring the dropped page back, because a keyset walk
 * has no *previous*-page path to re-read it with. Bounding memory is still a
 * real concern and is answered where it can be answered honestly: `gcTime` (five
 * minutes, well under the client-wide thirty) retires an abandoned board, and
 * the DOM stays bounded because the list is windowed however many trades the
 * cache holds.
 */

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
  /** KTC's pick rows, keyed by season, round and tier — see `ktcPickKey`. */
  pickKtc: Record<string, KtcValue>;
  /** Pick key → draft slot, for the picks whose league has set an order. */
  pickSlots: Record<string, number>;
};

/**
 * Concatenate the trades and merge the name maps, newest page first.
 *
 * The counts are read off the **first** page that states them and then held: a
 * page after the first carries `null` for both by design (the route counts only
 * on a first page), and with no eviction the first page is always present. Kept
 * as a scan rather than as `pages[0]` so a refetch that answered one page
 * without a count — or any future page that carries one — cannot blank a
 * denominator the reader is looking at.
 */
export function foldTradePages(
  pages: readonly TradesPagePayload[],
): TradesData | null {
  if (pages.length === 0) return null;

  const trades: Trade[] = [];
  const players: Record<string, PlayerSummary> = {};
  const managers: Record<string, TradeManager> = {};
  const ktc: Record<string, KtcValue> = {};
  const pickKtc: Record<string, KtcValue> = {};
  const pickSlots: Record<string, number> = {};

  let total: number | null = null;
  let scopeTotal: number | null = null;

  for (const page of pages) {
    // `push(...page.trades)` would spread thousands of arguments onto the stack
    // once the board is deep; a loop is the same work without the
    // argument-count ceiling.
    for (const trade of page.trades) trades.push(trade);
    Object.assign(players, page.players);
    Object.assign(managers, page.managers);
    Object.assign(ktc, page.ktc);
    Object.assign(pickKtc, page.pickKtc);
    Object.assign(pickSlots, page.pickSlots);

    // First stated wins, so a later page's `null` cannot unstate it.
    if (total === null && page.total !== null) total = page.total;
    if (scopeTotal === null && page.scopeTotal !== null) {
      scopeTotal = page.scopeTotal;
    }
  }

  // **Never smaller than what is on screen.** The unnarrowed total is a stored
  // count refreshed on the crawler's tick, so it lags the trades it counts by up
  // to its TTL — normally by a handful, and by a lot on a database that has just
  // been filled. A denominator under its own numerator is the one way that lag
  // is visible, and it reads as the page being broken; clamping states what is
  // actually known, which is "at least this many". It cannot mask a real
  // shortfall, because the rows it is clamped against came out of the same
  // population it counts.
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
    pickKtc,
    pickSlots,
  };
}
