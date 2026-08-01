import assert from "node:assert/strict";
import { test } from "node:test";

import type { Trade } from "@/shared/trades";

import { advanceFiltered, EMPTY_FILTERED } from "./incremental.ts";

const trade = (id: string, league = "L1"): Trade => ({
  transaction_id: id,
  league_id: league,
  week: 1,
  completed_at: 1_752_000_000_000,
  sides: [],
});

const ids = (trades: readonly Trade[]) => trades.map((t) => t.transaction_id);

/** Counts how many trades a predicate was asked about, which is the point. */
function counting(predicate: (trade: Trade) => boolean) {
  const seen: string[] = [];
  return {
    seen,
    fn: (t: Trade) => {
      seen.push(t.transaction_id);
      return predicate(t);
    },
  };
}

const all = () => true;

test("a first pass judges everything and splits the two lists", () => {
  const trades = [trade("a", "L1"), trade("b", "L2"), trade("c", "L1")];
  const result = advanceFiltered(
    EMPTY_FILTERED,
    trades,
    "g1",
    (t) => t.league_id === "L1",
    (t) => t.transaction_id !== "c",
  );

  assert.deepEqual(ids(result.inLeagues), ["a", "c"]);
  assert.deepEqual(ids(result.visible), ["a"]);
  assert.equal(result.judged, 3);
});

test("a chunk costs only its own length", () => {
  const first = [trade("a"), trade("b")];
  const one = advanceFiltered(EMPTY_FILTERED, first, "g1", all, all);

  const league = counting(all);
  const match = counting(all);
  const two = advanceFiltered(
    one,
    [...first, trade("c"), trade("d")],
    "g1",
    league.fn,
    match.fn,
  );

  // The whole point: the two trades already judged are not judged again.
  assert.deepEqual(league.seen, ["c", "d"]);
  assert.deepEqual(match.seen, ["c", "d"]);
  assert.deepEqual(ids(two.visible), ["a", "b", "c", "d"]);
});

test("a changed generation re-judges the whole list", () => {
  const trades = [trade("a"), trade("b")];
  const one = advanceFiltered(EMPTY_FILTERED, trades, "g1", all, all);

  const league = counting(all);
  const two = advanceFiltered(
    one,
    [...trades, trade("c")],
    // A filter moved, so every verdict already reached was reached under rules
    // that no longer apply.
    "g2",
    league.fn,
    () => false,
  );

  assert.deepEqual(league.seen, ["a", "b", "c"]);
  assert.deepEqual(ids(two.inLeagues), ["a", "b", "c"]);
  assert.deepEqual(ids(two.visible), []);
});

test("a chunk that adds nothing keeps both arrays' identity", () => {
  const first = [trade("a", "L1")];
  const one = advanceFiltered(
    EMPTY_FILTERED,
    first,
    "g1",
    (t) => t.league_id === "L1",
    all,
  );

  const two = advanceFiltered(
    one,
    [...first, trade("b", "L2"), trade("c", "L2")],
    "g1",
    (t) => t.league_id === "L1",
    all,
  );

  // Identity, not just equality — the page memoises on these, and a fresh array
  // would re-render the windowed list and drop its measurement cache.
  assert.equal(two.inLeagues, one.inLeagues);
  assert.equal(two.visible, one.visible);
  assert.equal(two.judged, 3);
});

test("a chunk that matches no trade filter still keeps `visible` identity", () => {
  const first = [trade("a")];
  const one = advanceFiltered(EMPTY_FILTERED, first, "g1", all, all);
  const two = advanceFiltered(
    one,
    [...first, trade("b")],
    "g1",
    all,
    (t) => t.transaction_id === "a",
  );

  assert.deepEqual(ids(two.inLeagues), ["a", "b"]);
  assert.equal(two.visible, one.visible);
});

test("nothing new is a no-op that returns the same state object", () => {
  const trades = [trade("a")];
  const one = advanceFiltered(EMPTY_FILTERED, trades, "g1", all, all);
  assert.equal(advanceFiltered(one, trades, "g1", all, all), one);
});

test("a replaced list of the same length is a full pass, not an append", () => {
  const one = advanceFiltered(
    EMPTY_FILTERED,
    [trade("a"), trade("b")],
    "g1",
    all,
    all,
  );

  // Same length, same generation, different trades — a season change that
  // arrived without the generation moving would silently keep the old answer.
  const league = counting(all);
  const two = advanceFiltered(
    one,
    [trade("x"), trade("y")],
    "g1",
    league.fn,
    all,
  );

  assert.deepEqual(league.seen, ["x", "y"]);
  assert.deepEqual(ids(two.visible), ["x", "y"]);
});

test("a shorter list is a full pass", () => {
  const one = advanceFiltered(
    EMPTY_FILTERED,
    [trade("a"), trade("b"), trade("c")],
    "g1",
    all,
    all,
  );
  const two = advanceFiltered(one, [trade("a")], "g1", all, all);
  assert.deepEqual(ids(two.visible), ["a"]);
  assert.equal(two.judged, 1);
});

test("the whole season costs one pass over it", () => {
  const league = counting(all);
  const match = counting(all);

  let state = EMPTY_FILTERED;
  const trades: Trade[] = [];
  for (let chunk = 0; chunk < 50; chunk++) {
    for (let i = 0; i < 1000; i++) trades.push(trade(`t${chunk}-${i}`));
    state = advanceFiltered(state, [...trades], "g1", league.fn, match.fn);
  }

  // 50 chunks of 1,000. Re-filtering the accumulated list each time would be
  // ~1.27M evaluations; appending is one per trade.
  assert.equal(league.seen.length, 50_000);
  assert.equal(match.seen.length, 50_000);
  assert.equal(state.visible.length, 50_000);
});
