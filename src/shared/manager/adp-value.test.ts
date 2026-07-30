import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ADP_HALF_LIFE,
  ADP_PEAK,
  adpBoardFor,
  adpValue,
  boardSignature,
  rosterAdpValue,
} from "./adp-value.ts";

describe("adpValue", () => {
  test("the first pick sits at the peak", () => {
    assert.equal(adpValue(1), ADP_PEAK);
  });

  test("value halves over one half-life of picks", () => {
    assert.equal(adpValue(1 + ADP_HALF_LIFE), Math.round(ADP_PEAK / 2));
  });

  test("a better (lower) ADP is never worth less", () => {
    // Non-increasing everywhere — integer rounding leaves ties in the deep tail
    // (two picks in the hundreds price a rounding apart), which is fine: two deep
    // bench pieces really are worth about the same.
    let previous = Infinity;
    for (let adp = 1; adp <= 300; adp += 3) {
      const value = adpValue(adp);
      assert.ok(value <= previous, `adp ${adp} rose above ${previous}`);
      previous = value;
    }
  });

  test("across a real draft gap a better pick is worth strictly more", () => {
    assert.ok(adpValue(1) > adpValue(13));
    assert.ok(adpValue(13) > adpValue(50));
    assert.ok(adpValue(50) > adpValue(120));
  });

  test("a junk ADP can't exceed the peak or return NaN", () => {
    assert.equal(adpValue(Number.NaN), ADP_PEAK);
    assert.equal(adpValue(0), ADP_PEAK);
  });
});

describe("rosterAdpValue", () => {
  const values = new Map([
    ["qb", 8000],
    ["rb", 5000],
    ["wr", 3000],
    ["stash", 2000],
  ]);

  test("splits the total across the lineup, bench taking the remainder", () => {
    const result = rosterAdpValue({
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
    const result = rosterAdpValue({
      players: ["qb", "rb", "wr", "stash"],
      starters: ["wr"],
      values,
    });
    assert.equal(result.split!.starters + result.split!.bench, result.total);
  });

  test("a player with no ADP is rostered but adds nothing", () => {
    const result = rosterAdpValue({
      players: ["qb", "kicker", "def"],
      starters: ["qb", "kicker"],
      values,
    });
    assert.equal(result.total, 8000);
    assert.equal(result.priced, 1);
    assert.equal(result.rostered, 3);
    assert.deepEqual(result.split, { starters: 8000, bench: 0 });
  });

  test("empty and padded slot ids are not players", () => {
    const result = rosterAdpValue({
      players: ["qb", "0", ""],
      starters: ["qb", "0"],
      values,
    });
    assert.equal(result.rostered, 1);
    assert.deepEqual(result.split, { starters: 8000, bench: 0 });
  });

  test("a repeated player id counts once", () => {
    const result = rosterAdpValue({
      players: ["qb", "qb", "rb"],
      starters: ["qb"],
      values,
    });
    assert.equal(result.total, 13000);
    assert.equal(result.rostered, 2);
    assert.deepEqual(result.split, { starters: 8000, bench: 5000 });
  });

  test("a starter this roster doesn't hold can't overdraw the bench", () => {
    const result = rosterAdpValue({
      players: ["wr"],
      starters: ["qb", "wr"],
      values,
    });
    assert.deepEqual(result.split, { starters: 3000, bench: 0 });
  });

  test("no lineup leaves the total intact and the split unanswered", () => {
    const result = rosterAdpValue({
      players: ["qb", "rb"],
      starters: null,
      values,
    });
    assert.equal(result.total, 13000);
    assert.equal(result.split, null);
  });

  test("an empty roster prices at nothing rather than failing", () => {
    const result = rosterAdpValue({ players: [], starters: [], values });
    assert.deepEqual(result, {
      total: 0,
      priced: 0,
      rostered: 0,
      split: { starters: 0, bench: 0 },
    });
  });
});

describe("adpBoardFor", () => {
  test("reads the board off the league's slots, scoring and type", () => {
    const board = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "RB", "WR", "SUPER_FLEX", "BN"],
      scoringSettings: { rec: 1 },
      leagueType: "dynasty",
    });
    assert.deepEqual(board.seasons, ["2025"]);
    assert.equal(board.superflex, true);
    assert.deepEqual(board.scoring, ["ppr"]);
    assert.deepEqual(board.league_types, ["dynasty"]);
  });

  test("a single QB league reads the 1QB board, half-PPR its bucket", () => {
    const board = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "RB", "WR", "FLEX", "BN"],
      scoringSettings: { rec: 0.5 },
      leagueType: "redraft",
    });
    assert.equal(board.superflex, false);
    assert.deepEqual(board.scoring, ["half_ppr"]);
    assert.deepEqual(board.league_types, ["redraft"]);
  });

  test("missing reception scoring is standard, not a failure", () => {
    const board = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "RB", "WR"],
      scoringSettings: null,
      leagueType: "redraft",
    });
    assert.deepEqual(board.scoring, ["std"]);
  });

  test("leagues sharing the priced axes share a signature", () => {
    const a = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "SUPER_FLEX", "BN"],
      scoringSettings: { rec: 1 },
      leagueType: "dynasty",
    });
    const b = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "QB", "RB"],
      scoringSettings: { rec: 1.5 },
      leagueType: "dynasty",
    });
    const c = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "RB", "WR"],
      scoringSettings: { rec: 1 },
      leagueType: "dynasty",
    });
    assert.equal(boardSignature(a), boardSignature(b));
    assert.notEqual(boardSignature(a), boardSignature(c));
  });
});
