import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { tradeCountLabel, tradeCountReading } from "./trade-count.ts";

/**
 * What the headline is allowed to claim.
 *
 * The bug these pin is a *wrong number wearing the confidence of a right one*:
 * with `total: null` — the route's deliberate degradation when the count query
 * fails — the board printed `data.trades.length` as the total, so the first
 * page of a board holding thousands read "100 trades". Nothing errors and
 * nothing looks broken; the page simply states a figure that is not true.
 */

const board = (
  over: Partial<{ trades: number; total: number | null; scopeTotal: number | null }> = {},
) => ({
  trades: Array.from({ length: over.trades ?? 100 }, (_, i) => i),
  total: over.total === undefined ? null : over.total,
  scopeTotal: over.scopeTotal === undefined ? null : over.scopeTotal,
});

const label = (
  data: ReturnType<typeof board> | null,
  loading: boolean,
  hasMore: boolean,
) => tradeCountLabel(tradeCountReading(data, loading, hasMore));

describe("a counted board states the count", () => {
  test("an exact total is printed as one", () => {
    assert.equal(label(board({ trades: 100, total: 428 }), false, true), "428 trades");
  });

  test("the scope denominator rides along where it differs", () => {
    assert.equal(
      label(board({ trades: 100, total: 428, scopeTotal: 1200 }), false, true),
      "428 of 1,200 trades",
    );
  });

  test("a denominator equal to the numerator is not a fraction", () => {
    // An unnarrowed board counts one number and reports it twice; "428 of 428"
    // is a fraction with nothing in it.
    assert.equal(
      label(board({ trades: 100, total: 428, scopeTotal: 428 }), false, true),
      "428 trades",
    );
  });

  test("thousands are grouped in both halves", () => {
    assert.equal(
      label(board({ total: 12_345, scopeTotal: 98_765 }), false, true),
      "12,345 of 98,765 trades",
    );
  });
});

describe("an uncounted board states a floor, never a total", () => {
  test("with more pages to come, the loaded rows are a minimum", () => {
    // The whole bug in one assertion: this used to read "100 trades".
    assert.equal(label(board({ trades: 100 }), false, true), "100+ trades");
  });

  test("the `+` survives a single row", () => {
    // "1+ trade" would be wrong: the `+` is a claim about a number greater than
    // one, so the noun follows the claim rather than the figure.
    assert.equal(label(board({ trades: 1 }), false, true), "1+ trades");
  });

  test("a finished walk knows its own size exactly", () => {
    // No count, but every row was fetched — so the rows in hand *are* the
    // total, by a different route, and there is nothing to hedge about.
    assert.equal(label(board({ trades: 100 }), false, false), "100 trades");
  });

  test("one row on a finished walk is singular", () => {
    assert.equal(label(board({ trades: 1 }), false, false), "1 trade");
  });

  test("an empty finished board is zero, plural", () => {
    assert.equal(label(board({ trades: 0 }), false, false), "0 trades");
  });

  test("a floor is grouped like any other figure", () => {
    assert.equal(label(board({ trades: 5000 }), false, true), "5,000+ trades");
  });
});

describe("a counted zero and a counted one", () => {
  test("zero is plural and is a real answer", () => {
    // Distinct from the em-dash case: somebody counted, and the answer was
    // none. The empty state below it is what says so at length.
    assert.equal(label(board({ trades: 0, total: 0 }), false, false), "0 trades");
  });

  test("one is singular", () => {
    assert.equal(label(board({ trades: 1, total: 1 }), false, false), "1 trade");
  });

  test("one of many is singular on the numerator", () => {
    assert.equal(
      label(board({ trades: 1, total: 1, scopeTotal: 90 }), false, false),
      "1 of 90 trades",
    );
  });

  test("a counted zero is not confused with a failed count", () => {
    const counted = tradeCountReading(board({ trades: 0, total: 0 }), false, false);
    const failed = tradeCountReading(board({ trades: 0 }), false, false);
    assert.equal(counted.kind, "exact");
    assert.equal(failed.kind, "loaded");
  });
});

describe("before an answer lands", () => {
  test("loading says so rather than counting nothing", () => {
    assert.equal(label(board({ trades: 0 }), true, false), "Reading…");
    assert.equal(label(null, false, false), "Reading…");
    // And a load that is under way over a board already on screen still reads
    // as pending, which is what stops a filter press flashing "0 trades".
    assert.equal(label(board({ total: 428 }), true, true), "Reading…");
  });
});

describe("the reading is what the wording is derived from", () => {
  test("the four kinds are distinguished before any string is built", () => {
    // The point of the two-step: a caller that wanted to draw this differently
    // — a tooltip, a title attribute — reads the reading rather than parsing
    // the label back apart.
    assert.deepEqual(tradeCountReading(board({ total: 5, scopeTotal: 9 }), false, true), {
      kind: "exact",
      total: 5,
      scopeTotal: 9,
    });
    assert.deepEqual(tradeCountReading(board({ trades: 7 }), false, true), {
      kind: "atLeast",
      loaded: 7,
    });
    assert.deepEqual(tradeCountReading(board({ trades: 7 }), false, false), {
      kind: "loaded",
      loaded: 7,
    });
    assert.deepEqual(tradeCountReading(null, false, false), { kind: "pending" });
  });

  test("a clamped total is passed through as counted", () => {
    // `appendTradePage` never lets a denominator sit under its own numerator,
    // so by the time it reaches here a stated total is already at least the
    // rows in hand. Nothing to re-derive.
    assert.deepEqual(
      tradeCountReading(board({ trades: 200, total: 200 }), false, true),
      { kind: "exact", total: 200, scopeTotal: null },
    );
  });
});
