import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ownedDraftPicks } from "./draft-picks.ts";
import type { DraftPickAsset, TradedPick } from "./draft-picks.ts";

const pick = (
  season: string,
  round: number,
  roster_id: number,
  owner_id: number,
): TradedPick => ({ season, round, roster_id, owner_id });

/** "season round(from origin)" for a compact assertion of a roster's picks. */
const describePick = (p: DraftPickAsset): string =>
  `${p.season} R${p.round}<-${p.original_roster_id}`;

describe("ownedDraftPicks", () => {
  test("no traded picks yields no picks at all", () => {
    assert.equal(ownedDraftPicks([], [1, 2, 3], "2026").size, 0);
  });

  test("fills the whole grid for every seen season and round from originals", () => {
    // Only one 2026 R2 pick was traded, but the grid is 2026 rounds 1..2 for all
    // three rosters — a roster with no trade still owns its own picks.
    const owned = ownedDraftPicks([pick("2026", 2, 1, 2)], [1, 2, 3], "2026");

    assert.deepEqual(owned.get(3)?.map(describePick), [
      "2026 R1<-3",
      "2026 R2<-3",
    ]);
  });

  test("a traded pick leaves the giver and joins the receiver", () => {
    // Roster 1's 2026 first goes to roster 2.
    const owned = ownedDraftPicks([pick("2026", 1, 1, 2)], [1, 2], "2026");

    // 1 owns nothing now (absent, which the caller reads as an empty list); 2
    // holds its own first plus the acquired one.
    assert.equal(owned.has(1), false);
    assert.deepEqual(owned.get(2)?.map(describePick), [
      "2026 R1<-2", // own pick first
      "2026 R1<-1", // acquired, tagged with its origin
    ]);
  });

  test("rounds run 1..deepest round anyone traded", () => {
    // A 2026 R3 pick was traded, so the grid is rounds 1..3 even though rounds 1
    // and 2 saw no trade.
    const owned = ownedDraftPicks([pick("2026", 3, 2, 1)], [1, 2], "2026");
    assert.deepEqual(owned.get(1)?.map((p) => p.round), [1, 2, 3, 3]);
  });

  test("only seasons that appear in trades are enumerated", () => {
    const owned = ownedDraftPicks([pick("2027", 1, 1, 2)], [1, 2], "2026");
    const seasons = new Set([...owned.values()].flat().map((p) => p.season));
    assert.deepEqual([...seasons], ["2027"]);
  });

  test("past-season rows before minSeason are dropped", () => {
    const owned = ownedDraftPicks(
      [pick("2025", 1, 1, 2), pick("2026", 1, 1, 2)],
      [1, 2],
      "2026",
    );
    const seasons = new Set(
      [...owned.values()].flat().map((p) => p.season),
    );
    assert.deepEqual([...seasons], ["2026"]);
  });

  test("picks sort by season, then round, own before acquired", () => {
    const owned = ownedDraftPicks(
      [pick("2027", 1, 2, 1), pick("2026", 1, 3, 1)],
      [1, 2, 3],
      "2026",
    );
    assert.deepEqual(owned.get(1)?.map(describePick), [
      "2026 R1<-1", // own 2026 first
      "2026 R1<-3", // acquired 2026 from roster 3
      "2027 R1<-1", // own 2027
      "2027 R1<-2", // acquired 2027 from roster 2
    ]);
  });
});
