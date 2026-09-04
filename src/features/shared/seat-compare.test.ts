import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LeagueTeam, LineupPlayer } from "@/shared/contract";

import { lensValue, seatComparisons } from "./seat-compare.ts";

function player(
  id: string,
  figures: Partial<Pick<LineupPlayer, "points" | "adp_value" | "ktc_value">>,
): LineupPlayer {
  return {
    player_id: id,
    name: id,
    positions: ["WR"],
    points: figures.points ?? null,
    adp_value: figures.adp_value ?? null,
    ktc_value: figures.ktc_value ?? null,
  };
}

/** One team, seated with the points given — null for a seat with no figure. */
function team(
  roster_id: number,
  points: readonly (number | null)[],
  is_manager = false,
): LeagueTeam {
  return {
    roster_id,
    name: `Roster ${roster_id}`,
    is_manager,
    lineup: {
      league_id: "1",
      starters: points.map((value, i) => ({
        slot: "WR",
        player: value === null ? null : player(`p${roster_id}-${i}`, { points: value }),
      })),
      bench: [],
      projected_points: 0,
      unknown_slots: [],
    },
    totals: {
      ros_starters: 0,
      ros_bench: 0,
      capital_total: 0,
      capital_bench: 0,
      capital_starters: 0,
      ktc_total: 0,
      ktc_starters: 0,
      ktc_bench: 0,
      ktc_picks: 0,
    },
    picks: [],
  };
}

describe("lensValue", () => {
  test("each lens reads its own field", () => {
    const p = player("x", { points: 12.5, adp_value: 4000, ktc_value: 6200 });
    assert.equal(lensValue(p, "points"), 12.5);
    assert.equal(lensValue(p, "capital"), 4000);
    assert.equal(lensValue(p, "ktc"), 6200);
  });

  test("an absent figure is null, not zero", () => {
    assert.equal(lensValue(player("x", { points: 9 }), "ktc"), null);
    assert.equal(lensValue(null, "points"), null);
    assert.equal(lensValue(undefined, "points"), null);
  });
});

describe("seatComparisons", () => {
  const me = team(1, [20, 10], true);
  const them = team(2, [14, 18]);
  const other = team(3, [30, 4]);
  const league = [me, them, other];

  test("an opponent is compared against the reader, seat by seat", () => {
    const seats = seatComparisons(league, them, me, "points");
    // Seat 0: they have 14 to the reader's 20, so the figure on screen is 6
    // short of the ghost beside it and the reader is the one ahead.
    assert.equal(seats[0]?.ghost, 20);
    assert.equal(seats[0]?.delta, -6);
    assert.equal(seats[0]?.standing, "ahead");
    // Seat 1: the other way about, on the same two figures.
    assert.equal(seats[1]?.ghost, 10);
    assert.equal(seats[1]?.delta, 8);
    assert.equal(seats[1]?.standing, "behind");
  });

  test("the sign describes the team on screen and the colour the reader", () => {
    // The two disagree by construction — the whole point of carrying both. A
    // negative delta is the reader ahead, which is the standings' own grammar:
    // the number describes the row it is printed on, the colour describes you.
    const seats = seatComparisons(league, them, me, "points");
    assert.ok((seats[0]?.delta ?? 0) < 0 && seats[0]?.standing === "ahead");
  });

  test("the reader's own team is measured against the league's best", () => {
    const seats = seatComparisons(league, me, me, "points");
    // Seat 0: 30 is the best anyone has there, and the reader has 20.
    assert.equal(seats[0]?.ghost, 30);
    assert.equal(seats[0]?.delta, -10);
    assert.equal(seats[0]?.standing, "behind");
  });

  test("holding the league's best is level, not a lead", () => {
    const best = team(8, [50], true);
    const seats = seatComparisons([best, team(9, [20])], best, best, "points");
    // The reader's 50 *is* the best, so there is no gap to draw and nothing to
    // colour — a bar here would be drawn against itself.
    assert.equal(seats[0]?.ghost, 50);
    assert.equal(seats[0]?.delta, 0);
    assert.equal(seats[0]?.fill, 0);
    assert.equal(seats[0]?.standing, null);
  });

  test("a reader with no team of their own reads the league's best", () => {
    const seats = seatComparisons([them, other], them, null, "points");
    assert.equal(seats[0]?.ghost, 30);
    assert.equal(seats[0]?.standing, "behind");
  });

  test("either side null is no gap at all, never a maximal one", () => {
    const unpriced = team(4, [null, 6]);
    const seats = seatComparisons([me, unpriced], unpriced, me, "points");
    assert.equal(seats[0]?.delta, null);
    assert.equal(seats[0]?.fill, 0);
    assert.equal(seats[0]?.standing, null);
    // The ghost still reports what the reader has there, which is the figure
    // the column prints beside the em dash.
    assert.equal(seats[0]?.ghost, 20);
  });

  test("a lens the whole seat is silent on compares nothing", () => {
    // Every figure above is points; on KeepTradeCut this league says nothing.
    const seats = seatComparisons(league, them, me, "ktc");
    assert.deepEqual(seats[0], { ghost: null, delta: null, fill: 0, standing: null });
  });

  test("the bar is scaled by the seat's own span, and clamped", () => {
    // Seat 0's span is 30, so a gap of 6 is 6/30 * 140 = 28% of the track.
    assert.equal(seatComparisons(league, them, me, "points")[0]?.fill, 28);
    // A gap past ~71% of the span fills the track rather than overflowing it.
    const wide = team(5, [0.5]);
    const rich = team(6, [100], true);
    assert.equal(seatComparisons([wide, rich], wide, rich, "points")[0]?.fill, 100);
  });

  test("seats are matched by index, so a repeated slot compares like for like", () => {
    const seats = seatComparisons(league, them, me, "points");
    assert.equal(seats.length, 2);
    // Seat 1 read seat 1 on every roster — not the best WR on either.
    assert.equal(seats[1]?.ghost, 10);
  });

  test("a seat the reader does not have is null, not zero", () => {
    const short = team(7, [12], true);
    const seats = seatComparisons([short, them], them, short, "points");
    assert.equal(seats[1]?.ghost, null);
    assert.equal(seats[1]?.standing, null);
  });
});
