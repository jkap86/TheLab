import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { dynastyPickGrid, ownedDraftPicks } from "./draft-picks.ts";
import type {
  DraftPickAsset,
  LeagueDraft,
  TradedPick,
} from "./draft-picks.ts";

const pick = (
  season: string,
  round: number,
  roster_id: number,
  owner_id: number,
): TradedPick => ({ season, round, roster_id, owner_id });

const draft = (
  draft_id: string,
  season: string,
  status: string | null,
  start_time: number | null,
  rounds: number | null,
): LeagueDraft => ({ draft_id, season, status, start_time, rounds });

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

  test("a grid enumerates its own seasons whether or not picks moved there", () => {
    // Nothing has ever been traded, so the derived grid is empty; the dynasty
    // grid still lays out three seasons two rounds deep for both rosters.
    const owned = ownedDraftPicks([], [1, 2], "2026", {
      seasons: ["2026", "2027", "2028"],
      minRounds: 2,
    });

    assert.deepEqual(owned.get(1)?.map(describePick), [
      "2026 R1<-1",
      "2026 R2<-1",
      "2027 R1<-1",
      "2027 R2<-1",
      "2028 R1<-1",
      "2028 R2<-1",
    ]);
  });

  test("a grid's seasons replace the traded ones entirely", () => {
    // The 2026 pick is outside the window: its cell is never enumerated, so it
    // moves nobody, and 2029 is listed despite no pick there ever moving.
    const owned = ownedDraftPicks([pick("2026", 1, 1, 2)], [1, 2], "2026", {
      seasons: ["2027", "2028", "2029"],
      minRounds: 1,
    });

    assert.deepEqual(owned.get(1)?.map(describePick), [
      "2027 R1<-1",
      "2028 R1<-1",
      "2029 R1<-1",
    ]);
  });

  test("a traded pick still deepens a grid, from any season in range", () => {
    // A 2026 third proves the league's rookie drafts run three rounds, so the
    // 2027-2029 window runs that deep too even though `minRounds` says one.
    const owned = ownedDraftPicks([pick("2026", 3, 1, 2)], [1], "2026", {
      seasons: ["2027"],
      minRounds: 1,
    });
    assert.deepEqual(owned.get(1)?.map((p) => p.round), [1, 2, 3]);
  });

  test("a grid with no depth at all yields nothing", () => {
    // An inaugural dynasty league that has only run its startup: no rookie
    // draft to measure and no pick traded, so there is no honest round count.
    const owned = ownedDraftPicks([], [1, 2], "2026", {
      seasons: ["2026", "2027", "2028"],
      minRounds: null,
    });
    assert.equal(owned.size, 0);
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

describe("dynastyPickGrid", () => {
  test("an untaken class opens the window on the league's own season", () => {
    // The 2026 rookie draft is scheduled and unfinished, so its picks are still
    // live: 2026-2028.
    const grid = dynastyPickGrid(
      "2026",
      [draft("d26", "2026", "drafting", 1_777_000_000_000, 4)],
      "prev-league",
    );
    assert.deepEqual(grid?.seasons, ["2026", "2027", "2028"]);
  });

  test("a completed class rolls the window forward", () => {
    const grid = dynastyPickGrid(
      "2026",
      [draft("d26", "2026", "complete", 1_777_000_000_000, 4)],
      "prev-league",
    );
    assert.deepEqual(grid?.seasons, ["2027", "2028", "2029"]);
  });

  test("a season the crawler has never seen keeps the nearer year", () => {
    // No draft stored for 2026 at all. Absent is not evidence the class was
    // taken, and showing a pick that exists beats hiding one.
    const grid = dynastyPickGrid(
      "2026",
      [draft("d25", "2025", "complete", 1_745_000_000_000, 4)],
      "prev-league",
    );
    assert.deepEqual(grid?.seasons, ["2026", "2027", "2028"]);
  });

  test("a completed startup does not count as this year's rookie class", () => {
    // Inaugural league: the startup ended in August, the rookie draft has not
    // happened, so 2026 picks are still tradable.
    const grid = dynastyPickGrid(
      "2026",
      [draft("startup", "2026", "complete", 1_755_000_000_000, 25)],
      null,
    );
    assert.deepEqual(grid?.seasons, ["2026", "2027", "2028"]);
    // ...and the startup's 25 rounds say nothing about how deep next May runs.
    assert.equal(grid?.minRounds, null);
  });

  test("an inaugural league's rookie draft is read past its startup", () => {
    const grid = dynastyPickGrid(
      "2026",
      [
        draft("startup", "2026", "complete", 1_750_000_000_000, 25),
        draft("rookie", "2026", "complete", 1_755_000_000_000, 4),
      ],
      "",
    );
    assert.deepEqual(grid?.seasons, ["2027", "2028", "2029"]);
    assert.equal(grid?.minRounds, 4);
  });

  test("a continuing league's earliest draft is a rookie draft, not a startup", () => {
    // Sleeper spells "no previous season" three ways; a real id is none of
    // them, so nothing here is excluded as a startup.
    const grid = dynastyPickGrid(
      "2026",
      [
        draft("d25", "2025", "complete", 1_745_000_000_000, 3),
        draft("d26", "2026", "complete", 1_777_000_000_000, 4),
      ],
      "prev-league",
    );
    assert.deepEqual(grid?.seasons, ["2027", "2028", "2029"]);
    // Depth comes from the most recent rookie draft, not the oldest.
    assert.equal(grid?.minRounds, 4);
  });

  test("'0' and '' read as inaugural, like null", () => {
    for (const previous of [null, "", "0"]) {
      const grid = dynastyPickGrid(
        "2026",
        [draft("startup", "2026", "complete", 1_750_000_000_000, 25)],
        previous,
      );
      assert.deepEqual(
        grid?.seasons,
        ["2026", "2027", "2028"],
        `previous_league_id ${JSON.stringify(previous)}`,
      );
    }
  });

  test("depth is unknown rather than zero when Sleeper sent no round count", () => {
    const grid = dynastyPickGrid(
      "2026",
      [draft("d26", "2026", "complete", 1_777_000_000_000, null)],
      "prev-league",
    );
    assert.equal(grid?.minRounds, null);
  });

  test("a season that isn't a year has no window", () => {
    assert.equal(dynastyPickGrid("", [], "prev-league"), null);
    assert.equal(dynastyPickGrid("nfl", [], "prev-league"), null);
  });
});
