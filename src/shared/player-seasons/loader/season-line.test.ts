import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_SCORING,
  SCORING_KEYS,
  foldSeasonStats,
  isCompsScoring,
  pointsPerGame,
  statNumber,
} from "./season-line.ts";
import type { SleeperStatRow, WeekStats } from "./season-line.ts";

/**
 * A fixture in the shape of a Sleeper weekly stat row. Nothing here calls the
 * network — the source is injected into the load, which is exactly so this can
 * be driven against a hand-written week.
 */
const row = (
  player_id: string,
  team: string | null,
  stats: Record<string, unknown> | null,
  player: Record<string, unknown> | null = null,
): SleeperStatRow => ({ player_id, team, stats, player });

const week = (n: number, rows: SleeperStatRow[]): WeekStats => ({ week: n, rows });

const of = (list: ReturnType<typeof foldSeasonStats>, id: string) =>
  list.find((a) => a.player_id === id)!;

describe("foldSeasonStats", () => {
  test("sums the counting stats across the weeks a player appeared", () => {
    const folded = foldSeasonStats([
      week(1, [row("p1", "LAR", { gp: 1, rec: 6, rec_yd: 90, rush_yd: 10, rush_att: 2, pts_half_ppr: 15 })]),
      week(2, [row("p1", "LAR", { gp: 1, rec: 4, rec_yd: 50, rush_yd: 0, rush_att: 0, pts_half_ppr: 8 })]),
    ]);
    const p1 = of(folded, "p1");
    assert.equal(p1.games, 2);
    assert.equal(p1.rec, 10);
    assert.equal(p1.rec_yards, 140);
    assert.equal(p1.rush_yards, 10);
    assert.equal(p1.rush_att, 2);
    assert.equal(p1.fantasy_pts, 23);
    assert.equal(p1.team, "LAR");
  });

  test("the scoring basis is the caller's, and the three are different columns", () => {
    const weeks = [week(1, [row("p1", "LAR", { gp: 1, pts_half_ppr: 15, pts_ppr: 18, pts_std: 12 })])];
    assert.equal(of(foldSeasonStats(weeks, "half_ppr"), "p1").fantasy_pts, 15);
    assert.equal(of(foldSeasonStats(weeks, "ppr"), "p1").fantasy_pts, 18);
    assert.equal(of(foldSeasonStats(weeks, "std"), "p1").fantasy_pts, 12);
    assert.equal(of(foldSeasonStats(weeks), "p1").fantasy_pts, 15);
    assert.equal(SCORING_KEYS[DEFAULT_SCORING], "pts_half_ppr");
  });

  test("target share is the player's share of his team's targets in the weeks he appeared", () => {
    // Sleeper publishes no team target total, so the denominator is built from
    // the same rows: every target the team's players recorded that week.
    const folded = foldSeasonStats([
      week(1, [
        row("p1", "LAR", { gp: 1, rec_tgt: 10 }),
        row("p2", "LAR", { gp: 1, rec_tgt: 20 }),
        row("p3", "LAR", { gp: 1, rec_tgt: 10 }),
        row("q1", "SF", { gp: 1, rec_tgt: 40 }),
      ]),
    ]);
    // 10 of the Rams' 40.
    assert.equal(of(folded, "p1").target_share, 25);
    assert.equal(of(folded, "p2").target_share, 50);
    // A different team's targets are not in anybody else's denominator.
    assert.equal(of(folded, "q1").target_share, 100);
  });

  test("target share counts only the weeks the player has a row in", () => {
    // A receiver who played half a season reads at his role, not at half of
    // it — `gp` is a criterion of its own for a reader who cares.
    const folded = foldSeasonStats([
      week(1, [row("p1", "LAR", { gp: 1, rec_tgt: 10 }), row("p2", "LAR", { gp: 1, rec_tgt: 10 })]),
      week(2, [row("p2", "LAR", { gp: 1, rec_tgt: 20 })]),
    ]);
    assert.equal(of(folded, "p1").target_share, 50);
    // p2: 30 of 40 across both weeks.
    assert.equal(of(folded, "p2").target_share, 75);
  });

  test("snap share reads the team total off the row rather than summing it", () => {
    // Sleeper carries the team's offensive snap count on every player's row,
    // so any one of them is the whole answer — summing would multiply it by
    // the size of the offence.
    const folded = foldSeasonStats([
      week(1, [
        row("p1", "LAR", { gp: 1, off_snp: 50, tm_off_snp: 70 }),
        row("p2", "LAR", { gp: 1, off_snp: 35, tm_off_snp: 70 }),
      ]),
    ]);
    assert.ok(Math.abs(of(folded, "p1").snap_share! - (50 / 70) * 100) < 0.01);
    assert.equal(of(folded, "p2").snap_share, 50);
  });

  test("an absent advanced stat is null, never zero", () => {
    const folded = foldSeasonStats([week(1, [row("p1", "LAR", { gp: 1, rec: 4, rec_yd: 50 })])]);
    const p1 = of(folded, "p1");
    assert.equal(p1.target_share, null);
    assert.equal(p1.snap_share, null);
  });

  test("a week is played when Sleeper says so, and otherwise when the row shows activity", () => {
    // A `gp` this feed omits must not turn a real season into zero games,
    // which would divide a points-per-game by nothing.
    const folded = foldSeasonStats([
      week(1, [row("p1", "LAR", { rec_tgt: 5, pts_half_ppr: 9 })]),
      week(2, [row("p1", "LAR", { rec_tgt: 0, rush_att: 0, off_snp: 0, pts_half_ppr: 0 })]),
      week(3, [row("p1", "LAR", { gp: 1, pts_half_ppr: 4 })]),
    ]);
    assert.equal(of(folded, "p1").games, 2, "the inactive week is not a game");
  });

  test("a row with no id, and a week with no rows, contribute nothing", () => {
    const folded = foldSeasonStats([
      week(1, [{ player_id: null, team: "LAR", stats: { gp: 1, rec: 9 } }]),
      week(2, []),
      week(3, [row("p1", "LAR", { gp: 1, rec: 3 })]),
    ]);
    assert.deepEqual(folded.map((a) => a.player_id), ["p1"]);
    assert.equal(of(folded, "p1").rec, 3);
  });

  test("the inlined player object is a fallback for identity and nothing else", () => {
    const folded = foldSeasonStats([
      week(1, [
        row("p1", "LAR", { gp: 1 }, { position: "WR", full_name: "Some Receiver" }),
        row("p2", "SF", { gp: 1 }, { position: "TE", first_name: "A", last_name: "Tight End" }),
      ]),
    ]);
    assert.equal(of(folded, "p1").position, "WR");
    assert.equal(of(folded, "p1").name, "Some Receiver");
    assert.equal(of(folded, "p2").name, "A Tight End");
  });

  test("the last team a player recorded a row for is the row's attribution", () => {
    const folded = foldSeasonStats([
      week(1, [row("p1", "LAR", { gp: 1 })]),
      week(2, [row("p1", "SF", { gp: 1 })]),
    ]);
    assert.equal(of(folded, "p1").team, "SF");
  });

  test("YPRR is absent from this source entirely, and is not approximated", () => {
    // Routes run is not published by Sleeper at any grain. The aggregate does
    // not carry a field for it, which is what keeps a derivation from being
    // invented later — see `./rows`, which writes null.
    const folded = foldSeasonStats([week(1, [row("p1", "LAR", { gp: 1, rec: 5, rec_yd: 70 })])]);
    assert.equal("yprr" in of(folded, "p1"), false);
  });
});

describe("statNumber", () => {
  test("reads a number, and a numeric string the data host has been seen to send", () => {
    assert.equal(statNumber({ a: 4 }, "a"), 4);
    assert.equal(statNumber({ a: "4.5" }, "a"), 4.5);
    assert.equal(statNumber({ a: 0 }, "a"), 0);
  });

  test("anything else is absent, never zero", () => {
    for (const value of [null, undefined, true, "", "  ", "—", {}, [], NaN, Infinity]) {
      assert.equal(statNumber({ a: value }, "a"), null, String(value));
    }
    assert.equal(statNumber(null, "a"), null);
    assert.equal(statNumber({}, "a"), null);
  });
});

describe("pointsPerGame", () => {
  test("divides, to two places", () => {
    assert.equal(pointsPerGame(160, 16), 10);
    assert.equal(pointsPerGame(100, 3), 33.33);
  });

  test("no games is not a divisor", () => {
    assert.equal(pointsPerGame(50, 0), 0);
    assert.equal(pointsPerGame(50, -1), 0);
    assert.equal(Number.isFinite(pointsPerGame(50, 0)), true);
  });
});

describe("isCompsScoring", () => {
  test("only the three bases the table can be on", () => {
    assert.equal(isCompsScoring("half_ppr"), true);
    assert.equal(isCompsScoring("ppr"), true);
    assert.equal(isCompsScoring("std"), true);
    assert.equal(isCompsScoring("tep"), false);
    assert.equal(isCompsScoring("toString"), false);
  });
});
