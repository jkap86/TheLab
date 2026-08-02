import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Trade } from "@/shared/trades";

import { advanceFiltered, EMPTY_FILTERED } from "./incremental.ts";
import type { Verdict } from "./incremental.ts";

const trade = (id: string, league = "L1"): Trade => ({
  transaction_id: id,
  league_id: league,
  week: 1,
  completed_at: 1000,
  sides: [],
});

const byLeague =
  (known: Set<string>, allowed: Set<string>) =>
  (t: Trade): Verdict =>
    !known.has(t.league_id)
      ? "unknown"
      : allowed.has(t.league_id)
        ? "allowed"
        : "denied";

/**
 * The residual pass. Two properties are what it is for, and both are about work
 * *not* done: a page costs its own length, and league metadata arriving costs
 * the pending bucket rather than the whole board.
 */
describe("advanceFiltered", () => {
  test("judges a cold list and renders what it admits", () => {
    const trades = [trade("a"), trade("b", "L2"), trade("c")];
    const state = advanceFiltered(
      EMPTY_FILTERED,
      trades,
      "g",
      "leagues",
      byLeague(new Set(["L1", "L2"]), new Set(["L1"])),
    );
    assert.deepEqual(state.visible.map((t) => t.transaction_id), ["a", "c"]);
    assert.deepEqual(state.pending, []);
    assert.equal(state.judged, 3);
  });

  test("a page costs its own length, not the board's", () => {
    let calls = 0;
    const judge = (): Verdict => {
      calls += 1;
      return "allowed";
    };
    const first = [trade("a"), trade("b")];
    let state = advanceFiltered(EMPTY_FILTERED, first, "g", "l", judge);
    assert.equal(calls, 2);

    state = advanceFiltered(state, [...first, trade("c")], "g", "l", judge);
    assert.equal(calls, 3, "only the new trade was judged");
    assert.equal(state.visible.length, 3);
  });

  test("a page that admits nothing keeps the output's identity", () => {
    // What this buys is not CPU: the page memoises on these arrays and the
    // virtualizer's measurement cache rides on them, so a fresh equal array
    // re-renders the list for a change nobody can see.
    const first = [trade("a")];
    const known = new Set(["L1", "L2"]);
    const judge = byLeague(known, new Set(["L1"]));
    const state = advanceFiltered(EMPTY_FILTERED, first, "g", "l", judge);
    const next = advanceFiltered(
      state,
      [...first, trade("b", "L2")],
      "g",
      "l",
      judge,
    );
    assert.notEqual(next, state, "the judged watermark did move");
    assert.equal(next.visible, state.visible);
    assert.equal(next.allowed, state.allowed);
  });

  test("nothing new and nothing to reconsider returns the same state", () => {
    const trades = [trade("a")];
    const state = advanceFiltered(EMPTY_FILTERED, trades, "g", "l", () => "allowed");
    assert.equal(advanceFiltered(state, trades, "g", "l", () => "allowed"), state);
  });

  test("an undecidable trade waits in the pending bucket", () => {
    const trades = [trade("a", "L1"), trade("b", "L?")];
    const state = advanceFiltered(
      EMPTY_FILTERED,
      trades,
      "g",
      "loading",
      byLeague(new Set(["L1"]), new Set(["L1"])),
    );
    assert.deepEqual(state.visible.map((t) => t.transaction_id), ["a"]);
    assert.deepEqual(state.pending, [1]);
  });

  test("league metadata arriving re-judges only the pending bucket", () => {
    const trades = [trade("a", "L1"), trade("b", "L?"), trade("c", "L1")];
    let state = advanceFiltered(
      EMPTY_FILTERED,
      trades,
      "g",
      "loading",
      byLeague(new Set(["L1"]), new Set(["L1"])),
    );
    assert.deepEqual(state.pending, [1]);

    let judged = 0;
    const known = new Set(["L1", "L?"]);
    const allowed = new Set(["L1", "L?"]);
    state = advanceFiltered(state, trades, "g", "leagues", (t) => {
      judged += 1;
      return byLeague(known, allowed)(t);
    });

    assert.equal(judged, 1, "the two already-decided trades were left alone");
    assert.deepEqual(state.pending, []);
    // Merged back into arrival order rather than appended: the board is read
    // newest-first, and a trade whose league landed late belongs where it
    // arrived.
    assert.deepEqual(state.visible.map((t) => t.transaction_id), ["a", "b", "c"]);
  });

  test("a pending trade that resolves to denied simply leaves", () => {
    const trades = [trade("a", "L?")];
    let state = advanceFiltered(
      EMPTY_FILTERED,
      trades,
      "g",
      "loading",
      byLeague(new Set(), new Set()),
    );
    assert.deepEqual(state.pending, [0]);
    state = advanceFiltered(
      state,
      trades,
      "g",
      "leagues",
      byLeague(new Set(["L?"]), new Set()),
    );
    assert.deepEqual(state.pending, []);
    assert.deepEqual(state.visible, []);
  });

  test("a changed generation throws the accumulated answer away", () => {
    const trades = [trade("a"), trade("b")];
    const state = advanceFiltered(EMPTY_FILTERED, trades, "g1", "l", () => "allowed");
    let judged = 0;
    const next = advanceFiltered(state, trades, "g2", "l", () => {
      judged += 1;
      return "denied";
    });
    assert.equal(judged, 2, "everything is re-judged under the new rules");
    assert.deepEqual(next.visible, []);
  });

  test("a replaced list of a compatible length is not treated as an extension", () => {
    // Belt and braces against the query cache's own guarantee: the prefix
    // identity check is the only place a swapped board could slip through.
    const state = advanceFiltered(
      EMPTY_FILTERED,
      [trade("a"), trade("b")],
      "g",
      "l",
      () => "allowed",
    );
    const next = advanceFiltered(
      state,
      [trade("x"), trade("y"), trade("z")],
      "g",
      "l",
      () => "allowed",
    );
    assert.deepEqual(next.visible.map((t) => t.transaction_id), ["x", "y", "z"]);
  });
});
