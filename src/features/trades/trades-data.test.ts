import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { TradesPagePayload } from "@/shared/contract";

import { appendTradePage, foldTradePages } from "./trades-data.ts";

/**
 * The fold across an infinite query's pages.
 *
 * What is pinned here is the assumption the rest of the board is built on:
 * **pages append and are never dropped**. It was not true while the query
 * carried `maxPages`, and the four things that broke are the four things
 * asserted below — trades vanishing, the first trade being evicted, and both
 * denominators blanking once the first page went with them.
 */

const trade = (id: string) => ({
  transaction_id: id,
  league_id: "L1",
  week: null,
  completed_at: 1_700_000_000_000,
  sides: [],
});

const page = (
  index: number,
  size: number,
  over: Partial<TradesPagePayload> = {},
): TradesPagePayload =>
  ({
    season: "2026",
    trades: Array.from({ length: size }, (_, i) => trade(`t${index * size + i}`)),
    nextCursor: `c${index + 1}`,
    total: null,
    scopeTotal: null,
    players: { [`p${index}`]: { name: `P${index}`, position: "RB", team: "SF" } },
    managers: {},
    ktc: {},
    pickKtc: {},
    pickSlots: { [`k${index}`]: index },
    ...over,
  }) as unknown as TradesPagePayload;

/** A board of `count` pages, only the first stating the denominators. */
const board = (count: number, size = 200): TradesPagePayload[] =>
  Array.from({ length: count }, (_, i) =>
    i === 0 ? page(0, size, { total: 9_000, scopeTotal: 12_000 }) : page(i, size),
  );

describe("foldTradePages", () => {
  test("no pages is no board", () => {
    assert.equal(foldTradePages([]), null);
  });

  test("one page is its own trades and counts", () => {
    const data = foldTradePages(board(1, 3));
    assert.equal(data?.trades.length, 3);
    assert.equal(data?.total, 9_000);
    assert.equal(data?.scopeTotal, 12_000);
    assert.equal(data?.season, "2026");
  });

  test("more than twenty pages discards nothing", () => {
    // 21 pages is where `maxPages: 20` used to drop page 1 — the reader's first
    // two hundred trades, out from under a scroll position several thousand
    // rows below them.
    const pages = board(25);
    const data = foldTradePages(pages);
    assert.equal(data?.trades.length, 25 * 200);
    assert.equal(data?.trades[0].transaction_id, "t0", "the first trade survives");
    assert.equal(data?.trades.at(-1)?.transaction_id, "t4999");
    // Every id is still distinct and in arrival order, which is what the
    // virtualizer's measurement cache is keyed on.
    assert.equal(new Set(data?.trades.map((t) => t.transaction_id)).size, 5_000);
  });

  test("the denominators hold across a long board", () => {
    for (const count of [1, 20, 21, 40]) {
      const data = foldTradePages(board(count));
      assert.equal(data?.total, 9_000, `total at ${count} pages`);
      assert.equal(data?.scopeTotal, 12_000, `scopeTotal at ${count} pages`);
    }
  });

  test("a later page's null cannot unstate a count", () => {
    // Only a first page carries them; the fold reads the first that states one
    // and holds it rather than letting the last page's `null` win.
    const data = foldTradePages([
      page(0, 2, { total: 50, scopeTotal: 70 }),
      page(1, 2),
      page(2, 2),
    ]);
    assert.equal(data?.total, 50);
    assert.equal(data?.scopeTotal, 70);
  });

  test("the name maps merge across pages rather than replacing", () => {
    const data = foldTradePages(board(3, 2));
    assert.deepEqual(Object.keys(data?.players ?? {}).sort(), ["p0", "p1", "p2"]);
    assert.deepEqual(Object.keys(data?.pickSlots ?? {}).sort(), ["k0", "k1", "k2"]);
  });

  test("a stored total is clamped up to what is on screen, never down", () => {
    // The stored count lags the crawler by up to its TTL, and a denominator
    // under its own numerator reads as the page being broken.
    const lagging = foldTradePages([page(0, 200, { total: 10, scopeTotal: 10 })]);
    assert.equal(lagging?.total, 200);
    assert.equal(lagging?.scopeTotal, 200);
    // And it is a floor, not a replacement: a real denominator is left alone.
    const ahead = foldTradePages(board(2));
    assert.equal(ahead?.total, 9_000);
  });
});

/**
 * Appending a page, which is what the board actually does.
 *
 * `foldTradePages` above is the same rules stated whole, and every assertion it
 * makes still holds — but the hook folds *incrementally*, so these are the
 * properties that only an append can have: that a page costs what it contains,
 * that it cannot disturb the cards already drawn, and that asking for the same
 * page twice does not draw it twice.
 */
describe("appendTradePage", () => {
  test("a first page starts the board", () => {
    const fold = appendTradePage(null, page(0, 3, { total: 9, scopeTotal: 12 }));
    assert.equal(fold.data.trades.length, 3);
    assert.equal(fold.data.entries.length, 3);
    assert.equal(fold.data.total, 9);
    assert.equal(fold.data.season, "2026");
    assert.deepEqual([...fold.ids], ["t0", "t1", "t2"]);
  });

  /**
   * **The rendering guarantee.** Every card used to be handed the folded board,
   * which is a new object on every page — so `memo` saw a changed prop for
   * every card and re-rendered all of them, and appending page twenty cost
   * twenty pages of re-renders. A page's own maps are immutable and
   * self-contained, so a card reads those and its props never move again.
   */
  test("appending a page leaves every earlier entry identical", () => {
    const first = appendTradePage(null, page(0, 3));
    const second = appendTradePage(first, page(1, 3));

    for (let i = 0; i < 3; i++) {
      assert.equal(
        second.data.entries[i],
        first.data.entries[i],
        `entry ${i} is the same object`,
      );
      assert.equal(
        second.data.entries[i].view,
        first.data.entries[i].view,
        `entry ${i}'s view is the same object`,
      );
      assert.equal(second.data.entries[i].trade, first.data.entries[i].trade);
    }
  });

  test("one view per page, shared by that page's trades", () => {
    // Built once rather than per trade: what matters is identity stability, and
    // narrowing per card would redo the work the route already did to save
    // nothing.
    const fold = appendTradePage(null, page(0, 4));
    const [a, b, c, d] = fold.data.entries;
    assert.equal(a.view, b.view);
    assert.equal(b.view, c.view);
    assert.equal(c.view, d.view);
  });

  test("a card's view is its own page's maps, by reference", () => {
    const p = page(0, 2);
    const fold = appendTradePage(null, p);
    assert.equal(fold.data.entries[0].view.players, p.players);
    assert.equal(fold.data.entries[0].view.pickSlots, p.pickSlots);
    assert.equal(fold.data.entries[0].view.managers, p.managers);
    assert.equal(fold.data.entries[0].view.assetValues, p.assetValues);
  });

  test("a later page's view is a different object from an earlier one's", () => {
    const first = appendTradePage(null, page(0, 2));
    const second = appendTradePage(first, page(1, 2));
    assert.notEqual(second.data.entries[0].view, second.data.entries[2].view);
  });

  /**
   * **No duplicates, however a page arrives twice.** A retry asks the same
   * cursor again, and a response that was slow rather than lost can land beside
   * the retry's — both carry the same hundred trades, and appending them twice
   * would draw every one of them twice under a count that says otherwise.
   */
  test("a page appended twice adds nothing the second time", () => {
    const first = appendTradePage(null, page(0, 3, { total: 9, scopeTotal: 12 }));
    const again = appendTradePage(first, page(0, 3));

    assert.equal(again.data.trades.length, 3);
    assert.equal(again.data.entries.length, 3);
    assert.deepEqual(
      again.data.trades.map((t) => t.transaction_id),
      ["t0", "t1", "t2"],
    );
  });

  test("a page that overlaps an earlier one keeps only what is new", () => {
    // The shape a retry takes if the server's cursor has drifted: some of the
    // rows are already on the board and some are not.
    const first = appendTradePage(null, page(0, 3));
    const overlapping = {
      ...page(0, 5),
      trades: ["t1", "t2", "t3", "t4"].map((id) => trade(id)),
    } as TradesPagePayload;
    const merged = appendTradePage(first, overlapping);

    assert.deepEqual(
      merged.data.trades.map((t) => t.transaction_id),
      ["t0", "t1", "t2", "t3", "t4"],
    );
    assert.equal(new Set(merged.data.trades.map((t) => t.transaction_id)).size, 5);
  });

  test("a duplicate page does not disturb the entries already drawn", () => {
    const first = appendTradePage(null, page(0, 3));
    const again = appendTradePage(first, page(0, 3));
    for (let i = 0; i < 3; i++) {
      assert.equal(again.data.entries[i], first.data.entries[i]);
    }
  });

  test("the merged maps still carry every page's names", () => {
    // The board-wide maps the *page* reads — the search panel's lookups and the
    // filter summary. The cards do not read these, which is the whole point,
    // but the page does and they must still merge.
    const fold = [page(0, 2), page(1, 2), page(2, 2)].reduce<
      ReturnType<typeof appendTradePage> | null
    >((acc, p) => appendTradePage(acc, p), null);
    assert.deepEqual(Object.keys(fold?.data.players ?? {}).sort(), ["p0", "p1", "p2"]);
    assert.deepEqual(Object.keys(fold?.data.pickSlots ?? {}).sort(), ["k0", "k1", "k2"]);
  });

  test("the denominators behave exactly as the whole fold's do", () => {
    // Same rules, stated once: first page wins, a later null cannot unstate,
    // and a count never sits under its own numerator.
    const first = appendTradePage(null, page(0, 2, { total: 50, scopeTotal: 70 }));
    const second = appendTradePage(first, page(1, 2));
    assert.equal(second.data.total, 50);
    assert.equal(second.data.scopeTotal, 70);

    const lagging = appendTradePage(null, page(0, 200, { total: 10, scopeTotal: 10 }));
    assert.equal(lagging.data.total, 200);
    assert.equal(lagging.data.scopeTotal, 200);
  });

  test("`values` moves with the newest page", () => {
    // The opposite of the denominators, and right for the opposite reason:
    // `auto_board` describes the leagues a page names, so a reader who has
    // scrolled into leagues of the other kind is on a mixed board.
    const first = appendTradePage(null, page(0, 1, { values: "first" as never }));
    const second = appendTradePage(first, page(1, 1, { values: "second" as never }));
    assert.equal(second.data.values, "second" as never);
  });

  test("appending onto null is starting, so a reset board cannot inherit", () => {
    const stale = appendTradePage(null, page(5, 2));
    const fresh = appendTradePage(null, page(0, 2));
    assert.deepEqual(
      fresh.data.trades.map((t) => t.transaction_id),
      ["t0", "t1"],
    );
    assert.equal(stale.data.trades.length, 2);
  });
});
