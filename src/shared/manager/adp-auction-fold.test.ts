import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AUCTION_AMOUNT_SQL,
  AUCTION_BUDGET_SQL,
  type AuctionBoardColumns,
  auctionBoardAggregates,
  auctionStats,
} from "./adp-auction-fold.ts";

/**
 * The auction column's arithmetic, on both sides of the statement.
 *
 * Two things are silent when wrong and are what these pin: a generated aggregate
 * list that names the wrong board's rows (the `FILTER` and the column prefix are
 * written from one argument, so a mismatch is a share taken over the other
 * market with nothing on screen to say so), and a fold that trusts the
 * statement's `HAVING` and reports a one-auction board as an average.
 */

const row = (over: Partial<AuctionBoardColumns> = {}): AuctionBoardColumns => ({
  redraft_buys: 6,
  redraft_share: 24.5,
  redraft_min_share: 12,
  redraft_max_share: 38.5,
  redraft_stdev: 7.25,
  dynasty_buys: 4,
  dynasty_share: 31.75,
  dynasty_min_share: 20,
  dynasty_max_share: 44,
  dynasty_stdev: 9,
  ...over,
});

describe("the two guarded reads", () => {
  test("each guards its cast and is parenthesised", () => {
    // The house rule twice over: Sleeper promises nothing about the types in
    // these blobs, so a bare cast fails the whole query on one junk value — and
    // a fragment a call site divides by has to be parenthesised or the division
    // binds to the last branch of the CASE.
    for (const fragment of [AUCTION_BUDGET_SQL, AUCTION_AMOUNT_SQL]) {
      const trimmed = fragment.trim();
      assert.ok(trimmed.startsWith("(") && trimmed.endsWith(")"));
      assert.ok(trimmed.includes("~ '^[0-9]+(\\.[0-9]+)?$'"), "expected a regex guard");
    }
  });

  test("neither falls back to a default — an unreadable value is null", () => {
    // The one place this differs from the board's other guarded casts. A share is
    // a fraction of a *specific* budget, so assuming the common 200 would
    // silently reprice every player in a room that played for 100; and a bid that
    // cannot be read is left out of the average rather than counted as free.
    for (const fragment of [AUCTION_BUDGET_SQL, AUCTION_AMOUNT_SQL]) {
      assert.ok(!/ELSE\s+[^E]/i.test(fragment), `${fragment} carries a fallback`);
    }
  });

  test("the budget is a draft's and the amount is a pick's", () => {
    // They are read from different tables in the same statement, so an alias
    // typo is a query that fails rather than a number that is wrong — but only
    // if they stay on the aliases the CTE actually joins.
    assert.ok(AUCTION_BUDGET_SQL.includes("d.settings->>'budget'"));
    assert.ok(AUCTION_AMOUNT_SQL.includes("dp.metadata->>'amount'"));
  });
});

describe("the generated aggregates", () => {
  test("each board's columns are prefixed with the board it filters on", () => {
    const redraft = auctionBoardAggregates("redraft");
    assert.ok(redraft.includes("FILTER (WHERE NOT b.dynasty)"));
    assert.ok(!redraft.includes("FILTER (WHERE b.dynasty)"));
    for (const suffix of ["buys", "share", "min_share", "max_share", "stdev"]) {
      assert.ok(redraft.includes(`AS redraft_${suffix}`), `missing redraft_${suffix}`);
      assert.ok(!redraft.includes(`AS dynasty_${suffix}`));
    }

    const dynasty = auctionBoardAggregates("dynasty");
    assert.ok(dynasty.includes("FILTER (WHERE b.dynasty)"));
    assert.ok(!dynasty.includes("NOT b.dynasty"));
  });

  test("the two boards name every column the fold reads, and no other", () => {
    // The list and the row type are one agreement with no compiler link between
    // them: a column renamed on one side reads as null on the other, which is an
    // em dash rather than an error.
    const sql = `${auctionBoardAggregates("redraft")}${auctionBoardAggregates("dynasty")}`;
    const named = new Set([...sql.matchAll(/AS (\w+)/g)].map((m) => m[1]));
    assert.deepEqual(
      [...named].sort(),
      Object.keys(row()).sort(),
    );
  });

  test("a single buy's spread is zero rather than null", () => {
    // `stddev_samp` of one row is null, and a null there would read as "no
    // reading" in a cell whose reading is perfectly good.
    for (const board of ["redraft", "dynasty"] as const) {
      assert.ok(auctionBoardAggregates(board).includes("COALESCE(stddev_samp"));
    }
  });
});

describe("the fold", () => {
  test("it reads each board off its own columns", () => {
    const stats = auctionStats(row(), "redraft", 2);
    assert.deepEqual(stats, {
      buys: 6,
      share: 24.5,
      min_share: 12,
      max_share: 38.5,
      stdev: 7.25,
    });
    assert.equal(auctionStats(row(), "dynasty", 2)?.share, 31.75);
  });

  test("a board under the gate is null even when the other cleared it", () => {
    // Exactly the row the statement's `HAVING` lets through: it keeps a player
    // whose *other* board is over the gate, so the fold cannot assume the one it
    // is reading is.
    const one = row({ dynasty_buys: 1 });
    assert.notEqual(auctionStats(one, "redraft", 2), null);
    assert.equal(auctionStats(one, "dynasty", 2), null);
  });

  test("null is null, and it is not a zero", () => {
    // A board that bought him never averages to 0% — the two are different
    // answers and the cell draws an em dash for one of them.
    const none = row({ dynasty_buys: 0, dynasty_share: null });
    assert.equal(auctionStats(none, "dynasty", 1), null);
  });

  test("the gate is the caller's, so min_picks=1 answers a single buy", () => {
    const one = row({ redraft_buys: 1, redraft_stdev: 0 });
    assert.equal(auctionStats(one, "redraft", 1)?.buys, 1);
    assert.equal(auctionStats(one, "redraft", 2), null);
  });
});
