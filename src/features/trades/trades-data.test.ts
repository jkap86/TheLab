import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { TradesPagePayload } from "@/shared/contract";

import { foldTradePages } from "./trades-data.ts";

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
