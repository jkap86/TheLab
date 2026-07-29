import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isSuperflexLineup, rosterKtcValue } from "./roster.ts";

describe("isSuperflexLineup", () => {
  test("a single quarterback slot reads the 1QB board", () => {
    assert.equal(isSuperflexLineup(["QB", "RB", "RB", "WR", "TE", "FLEX", "BN"]), false);
  });

  test("a SUPER_FLEX beside a QB starts two", () => {
    assert.equal(isSuperflexLineup(["QB", "RB", "WR", "SUPER_FLEX", "BN"]), true);
  });

  test("two plain QB slots are superflex too", () => {
    assert.equal(isSuperflexLineup(["QB", "QB", "RB", "WR", "BN"]), true);
  });

  test("a FLEX takes no quarterback, so it doesn't make a league superflex", () => {
    assert.equal(isSuperflexLineup(["QB", "FLEX", "WRRB_FLEX", "REC_FLEX"]), false);
  });

  test("bench, IR and taxi slots start nobody", () => {
    // A SUPER_FLEX would make this superflex; three bench slots must not.
    assert.equal(isSuperflexLineup(["QB", "BN", "BN", "IR", "TAXI"]), false);
  });

  test("an unrecognised slot is eligible for nothing", () => {
    assert.equal(isSuperflexLineup(["QB", "OP", "BN"]), false);
  });

  test("no slots on file is not a claim that the league is superflex", () => {
    assert.equal(isSuperflexLineup(null), false);
    assert.equal(isSuperflexLineup([]), false);
  });
});

describe("rosterKtcValue", () => {
  const values = new Map([
    ["qb", 8000],
    ["rb", 5000],
    ["wr", 3000],
    ["stash", 2000],
  ]);

  test("splits the total across the lineup, with bench taking the remainder", () => {
    const result = rosterKtcValue({
      players: ["qb", "rb", "wr", "stash"],
      starters: ["qb", "rb"],
      values,
    });

    assert.deepEqual(result, {
      total: 18000,
      priced: 4,
      rostered: 4,
      split: { starters: 13000, bench: 5000 },
    });
  });

  test("the halves always add back up to the total", () => {
    const result = rosterKtcValue({
      players: ["qb", "rb", "wr", "stash"],
      starters: ["wr"],
      values,
    });

    assert.equal(result.split!.starters + result.split!.bench, result.total);
  });

  test("a player KTC doesn't price is rostered but adds nothing", () => {
    // Kickers and defences are on no KTC board, which is why `priced` is
    // reported next to the total rather than left to be assumed.
    const result = rosterKtcValue({
      players: ["qb", "kicker", "def"],
      starters: ["qb", "kicker"],
      values,
    });

    assert.equal(result.total, 8000);
    assert.equal(result.priced, 1);
    assert.equal(result.rostered, 3);
    assert.deepEqual(result.split, { starters: 8000, bench: 0 });
  });

  test("IR and taxi land on the bench half, not outside the split", () => {
    // `stash` is on IR here as far as the lineup is concerned — it was never a
    // candidate, so it appears in `players` and not in `starters`.
    const result = rosterKtcValue({
      players: ["qb", "stash"],
      starters: ["qb"],
      values,
    });

    assert.deepEqual(result.split, { starters: 8000, bench: 2000 });
  });

  test("empty and padded slot ids are not players", () => {
    const result = rosterKtcValue({
      players: ["qb", "0", ""],
      starters: ["qb", "0"],
      values,
    });

    assert.equal(result.rostered, 1);
    assert.deepEqual(result.split, { starters: 8000, bench: 0 });
  });

  test("a repeated player id counts once", () => {
    const result = rosterKtcValue({
      players: ["qb", "qb", "rb"],
      starters: ["qb"],
      values,
    });

    assert.equal(result.total, 13000);
    assert.equal(result.rostered, 2);
    assert.deepEqual(result.split, { starters: 8000, bench: 5000 });
  });

  test("a starter this roster doesn't hold can't overdraw the bench", () => {
    const result = rosterKtcValue({
      players: ["wr"],
      starters: ["qb", "wr"],
      values,
    });

    assert.deepEqual(result.split, { starters: 3000, bench: 0 });
  });

  test("no lineup leaves the total intact and the split unanswered", () => {
    const result = rosterKtcValue({
      players: ["qb", "rb"],
      starters: null,
      values,
    });

    assert.equal(result.total, 13000);
    assert.equal(result.split, null);
  });

  test("an empty roster prices at nothing rather than failing", () => {
    const result = rosterKtcValue({ players: [], starters: [], values });

    assert.deepEqual(result, {
      total: 0,
      priced: 0,
      rostered: 0,
      split: { starters: 0, bench: 0 },
    });
  });
});
