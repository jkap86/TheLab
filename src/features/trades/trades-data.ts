import type { TradesPagePayload } from "@/shared/contract";

import type {
  LeaguematePayload,
  PlayerSummary,
  Trade,
} from "@/shared/contract";

/**
 * The fold of the loaded pages into the one value the board renders.
 *
 * A pure module because the rules it carries — that pages only ever *append*,
 * that the first page is what states the denominators, that a total is never
 * allowed to sit under the rows it is counting, and that a page arriving must
 * not disturb the cards already on screen — are exactly the rules a test should
 * be able to drive without a renderer behind it.
 *
 * **Pages accumulate and are never evicted**, which every other assumption here
 * rests on: the first page is the only one carrying `total` and `scopeTotal`,
 * and a keyset walk has no *previous*-page path to re-read a dropped one with.
 * Dropping the oldest page would delete trades the reader had scrolled past,
 * shrink the list under the scroll position and blank the headline counts.
 *
 * ## The fold is incremental, and that is a rendering decision
 *
 * It used to be a `reduce` over every loaded page, run again from scratch each
 * time one arrived: `O(total loaded)` work per page, so a board twenty pages
 * deep re-merged two thousand trades and every id they name to append a
 * hundred. {@link appendTradePage} is the same rules written as one step, so
 * arriving pages cost what they contain and the board's depth costs nothing.
 *
 * **The bigger half is what a card is handed.** Every `TradeCard` used to
 * receive the whole folded object, which is a *new object on every page* — so
 * `memo` compared a changed prop for every card on the board and re-rendered
 * all of them, and the cost of appending page twenty was twenty pages of
 * re-renders. The fix is {@link TradeEntry}: a page's own maps are immutable and
 * self-contained (the route resolves each page's names from that page's own
 * trades), so a card can be handed **its page's** maps rather than the board's.
 * One `view` object is built per page and shared by its trades, so a card's
 * props are fixed from the moment it first renders — appending a page cannot
 * change them, and `memo` holds for every card but the new ones.
 */

/**
 * The enrichment one card reads, as its own page shipped it.
 *
 * **Not narrowed to one trade, and deliberately.** Narrowing per trade would
 * mean collecting each trade's player, manager, pick and asset ids and building
 * four objects per card — the same work the route already did once, redone in
 * the browser, to save nothing: the maps are shared by reference either way.
 * What matters for rendering is *identity stability*, and a per-page object has
 * it for free.
 *
 * It is safe because a page is self-contained: `/api/trades` resolves names,
 * slots and values from the trades of the page it is answering, and the payload
 * doc says so ("a page names its own ids and does not try to send a delta").
 * A later page can add keys, never change one — the same key resolves to the
 * same answer — so a card reading only its own page's maps reads the same thing
 * the merged board would have told it.
 */
export type TradeCardView = {
  players: Record<string, PlayerSummary>;
  managers: Record<string, LeaguematePayload>;
  /** Pick key → draft slot, for the picks whose league has set an order. */
  pickSlots: Record<string, number>;
  /** Asset key → what each basis prices it at, and where it places. */
  assetValues: TradesPagePayload["assetValues"];
};

/** One trade, with the page's enrichment it should be drawn from. */
export type TradeEntry = {
  trade: Trade;
  /**
   * Shared by every trade of one page and stable for the life of the board —
   * which is the whole point. See the module note.
   */
  view: TradeCardView;
};

/** What the board has loaded so far, folded across its pages. */
export type TradesData = {
  season: string;
  /** Newest first — every page's trades, in order. */
  trades: readonly Trade[];
  /**
   * The same trades, each with the page that carried it — what the list renders
   * from. Kept beside `trades` rather than replacing it because the page's own
   * readers (the count, the empty check) want the plain array and have no use
   * for a view.
   */
  entries: readonly TradeEntry[];
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
 * The board so far, plus what the next append needs to know.
 *
 * `ids` is what makes appending idempotent: a retried page — the same cursor
 * asked for twice after a failure, or a page the server re-sent — carries the
 * same trades, and appending them again would draw every one of them twice
 * under a count that says otherwise. It is kept beside the data rather than in
 * it because it is bookkeeping: nothing renders from it.
 */
export type TradesFold = {
  data: TradesData;
  /** Every `transaction_id` already on the board. */
  ids: ReadonlySet<string>;
};

/**
 * Fold one more page onto what is loaded, or start a board from it.
 *
 * The whole of the merge, in one step. Four rules travel with it:
 *
 * - **The denominators are read off the first page that states them and then
 *   held.** A page after the first carries `null` for both by design (the route
 *   counts only on a first page), and a later `null` must not unstate what the
 *   reader is looking at.
 * - **A count is never smaller than what is on screen.** It is taken on the
 *   first page and the pages after it are read from the same population a
 *   moment later, so a sync writing in between can leave the denominator under
 *   its own numerator — which reads as the page being broken. Clamping states
 *   what is actually known, "at least this many", and cannot mask a real
 *   shortfall because the rows it is clamped against came out of the population
 *   counted.
 * - **A trade already on the board is skipped.** See {@link TradesFold.ids}.
 * - **`values` is the newest page's**, for the reason on the field.
 */
export function appendTradePage(
  previous: TradesFold | null,
  page: TradesPagePayload,
): TradesFold {
  // One per page, shared by its trades, never rebuilt. This object *is* the
  // rendering fix — see the module note.
  const view: TradeCardView = {
    players: page.players,
    managers: page.managers,
    pickSlots: page.pickSlots,
    assetValues: page.assetValues,
  };

  const before = previous?.data;
  const ids = new Set(previous?.ids ?? []);

  const fresh = page.trades.filter((trade) => !ids.has(trade.transaction_id));
  for (const trade of fresh) ids.add(trade.transaction_id);

  const trades = before ? [...before.trades, ...fresh] : [...fresh];
  const entries = before
    ? [...before.entries, ...fresh.map((trade) => ({ trade, view }))]
    : fresh.map((trade) => ({ trade, view }));

  // The merged maps the *page* reads — the search panel's name lookups and the
  // filter summary. Rebuilt per page rather than mutated, so a consumer holding
  // the previous object sees a stable value; the cards do not read these.
  const merge = <V,>(
    prior: Record<string, V> | undefined,
    next: Record<string, V>,
  ): Record<string, V> =>
    prior === undefined ? next : { ...prior, ...next };

  let total = before?.total ?? null;
  let scopeTotal = before?.scopeTotal ?? null;
  // First stated wins, so a later page's `null` cannot unstate it.
  if (total === null && page.total !== null) total = page.total;
  if (scopeTotal === null && page.scopeTotal !== null) {
    scopeTotal = page.scopeTotal;
  }
  if (total !== null && total < trades.length) total = trades.length;
  if (scopeTotal !== null && scopeTotal < trades.length) {
    scopeTotal = trades.length;
  }

  return {
    ids,
    data: {
      season: before?.season ?? page.season,
      trades,
      entries,
      total,
      scopeTotal,
      players: merge(before?.players, page.players),
      managers: merge(before?.managers, page.managers),
      pickSlots: merge(before?.pickSlots, page.pickSlots),
      assetValues: merge(before?.assetValues, page.assetValues),
      values: page.values,
    },
  };
}

/**
 * Every loaded page, folded — the whole board from scratch.
 *
 * The reduce over {@link appendTradePage}, kept because it is the shape a test
 * can state a board in one expression. The hook that drives the board does
 * **not** use it: it holds the fold in its own state and appends as pages
 * arrive, which is what keeps a page's cost proportional to the page.
 */
export function foldTradePages(
  pages: readonly TradesPagePayload[],
): TradesData | null {
  let fold: TradesFold | null = null;
  for (const page of pages) fold = appendTradePage(fold, page);
  return fold?.data ?? null;
}
