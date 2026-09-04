import type { TradesPagePayload } from "@/shared/contract";

import type {
  LeaguematePayload,
  PlayerSummary,
  Trade,
} from "@/shared/contract";

/**
 * The fold of the loaded pages into the one value the board renders.
 *
 * A pure function in its own module because the rules it carries — that pages
 * only ever *append*, that the first page is what states the denominators, that
 * a total is never allowed to sit under the rows it is counting — are exactly
 * the rules a test should be able to drive without a renderer behind it. The
 * hook that calls it (`hooks/use-trades`) memoises on the raw page array, so
 * this runs once per page arriving rather than once per render.
 *
 * **Pages accumulate and are never evicted**, which every other assumption here
 * rests on: the first page is the only one carrying `total` and `scopeTotal`,
 * and a keyset walk has no *previous*-page path to re-read a dropped one with.
 * Dropping the oldest page would delete trades the reader had scrolled past,
 * shrink the list under the scroll position and blank the headline counts.
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
  managers: Record<string, LeaguematePayload>;
  /** Pick key → draft slot, for the picks whose league has set an order. */
  pickSlots: Record<string, number>;
  /**
   * Asset key → what each of the three bases prices it at, and where it places
   * in its own league. Merged like the name maps: a page carries the keys it
   * names, and a later page re-sending one it shares with an earlier page
   * writes the same answer.
   */
  assetValues: TradesPagePayload["assetValues"];
  /**
   * What answered on each basis — the value panel's staleness and coverage
   * line.
   *
   * **Taken from the newest page rather than the first**, which is the opposite
   * of the two denominators above and right for the opposite reason. Those are
   * counted once and held because a later page cannot state them; this is
   * restated on every page and *moves* — `auto_board` describes the leagues a
   * page names, so a reader who has scrolled into leagues of the other kind is
   * on a mixed board and the panel has to say so.
   */
  values: TradesPagePayload["values"];
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
  const managers: Record<string, LeaguematePayload> = {};
  const pickSlots: Record<string, number> = {};
  const assetValues: TradesPagePayload["assetValues"] = {};

  let total: number | null = null;
  let scopeTotal: number | null = null;

  for (const page of pages) {
    // `push(...page.trades)` would spread thousands of arguments onto the stack
    // once the board is deep; a loop is the same work without the
    // argument-count ceiling.
    for (const trade of page.trades) trades.push(trade);
    Object.assign(players, page.players);
    Object.assign(managers, page.managers);
    Object.assign(pickSlots, page.pickSlots);
    Object.assign(assetValues, page.assetValues);

    // First stated wins, so a later page's `null` cannot unstate it.
    if (total === null && page.total !== null) total = page.total;
    if (scopeTotal === null && page.scopeTotal !== null) {
      scopeTotal = page.scopeTotal;
    }
  }

  // **Never smaller than what is on screen.** A count is taken on the first
  // page and the pages after it are read from the same population a moment
  // later, so a sync writing in between can leave the denominator under its own
  // numerator — which reads as the page being broken. Clamping states what is
  // actually known, "at least this many", and cannot mask a real shortfall
  // because the rows it is clamped against came out of the population counted.
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
    pickSlots,
    assetValues,
    values: pages[pages.length - 1].values,
  };
}
