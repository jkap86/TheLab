import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LineupCheckPlayer, LineupCheckSeat } from "@/shared/contract";

import { seatGap, seatOptions, seatPoints, seatTakes } from "./seat-options.ts";

function player(
  over: Partial<LineupCheckPlayer> & { player_id: string },
): LineupCheckPlayer {
  return {
    name: over.player_id.toUpperCase(),
    positions: ["RB"],
    points: 10,
    team: "BAL",
    kickoff: null,
    opponent: null,
    home: false,
    locked: false,
    ...over,
  };
}

function seat(
  slot: string,
  over: Partial<LineupCheckPlayer> & { player_id: string } | null,
): LineupCheckSeat {
  return { slot, player: over === null ? null : player(over), move_to: null };
}

describe("seatTakes", () => {
  test("reads the app's own slot vocabulary rather than a table of its own", () => {
    assert.equal(seatTakes("QB", ["QB"]), true);
    assert.equal(seatTakes("QB", ["WR"]), false);
    assert.equal(seatTakes("FLEX", ["TE"]), true);
    assert.equal(seatTakes("FLEX", ["QB"]), false);
    assert.equal(seatTakes("SUPER_FLEX", ["QB"]), true);
  });

  test("a slot this build does not know takes nobody", () => {
    // The call `compareLineup` already makes when it drops one into
    // `unknown_slots`: a build that cannot say what a slot holds must not
    // guess, and offering a move into it is the guess.
    assert.equal(seatTakes("WEIRD_SLOT", ["RB", "WR", "TE", "QB"]), false);
  });

  test("a player's whole position list is asked, not his first", () => {
    // Sleeper lists two for exactly the players this matters most for.
    assert.equal(seatTakes("TE", ["WR", "TE"]), true);
  });
});

describe("seatPoints", () => {
  test("an empty seat is a real zero and an unpriced player is an absence", () => {
    // The contract's own `points` grammar one level up. A slot Sleeper carries
    // empty genuinely scores nothing — `current_points` has already counted it
    // that way — where a player the feed has no row for is unmeasured.
    assert.equal(seatPoints(seat("RB", null)), 0);
    assert.equal(seatPoints(seat("RB", { player_id: "a", points: null })), null);
    assert.equal(seatPoints(seat("RB", { player_id: "a", points: 0 })), 0);
  });
});

describe("seatGap", () => {
  test("is signed on the side of whoever leads", () => {
    // The sign is the whole of what a caller reads now — the row's figure takes
    // the ramp's two ends where a two-track meter used to draw the magnitude.
    assert.equal(
      seatGap(
        seat("RB", { player_id: "a", points: 18 }),
        seat("RB", { player_id: "b", points: 12 }),
      ),
      6,
    );
    assert.equal(
      seatGap(
        seat("RB", { player_id: "a", points: 12 }),
        seat("RB", { player_id: "b", points: 18 }),
      ),
      -6,
    );
  });

  test("level is a real answer and is not an absence", () => {
    // Zero and null are two different readings: level inks nothing, and so does
    // unmeasured — but only one of them is a measurement.
    assert.equal(
      seatGap(
        seat("RB", { player_id: "a", points: 12 }),
        seat("RB", { player_id: "b", points: 12 }),
      ),
      0,
    );
  });

  test("a seat where either side is unpriced has no gap at all", () => {
    // Scoring it as zero would ink the figure red on a row whose own figures
    // say there is nothing to compare.
    assert.equal(
      seatGap(
        seat("RB", { player_id: "a", points: null }),
        seat("RB", { player_id: "b", points: 12 }),
      ),
      null,
    );
    assert.equal(
      seatGap(
        seat("RB", { player_id: "a", points: 12 }),
        seat("RB", { player_id: "b", points: null }),
      ),
      null,
    );
  });

  test("no seat opposite is no comparison", () => {
    // A lineup with more seats than the one beside it — nothing to ink.
    assert.equal(seatGap(seat("RB", { player_id: "a" }), undefined), null);
  });

  test("an empty seat compares as a real zero", () => {
    // `seatPoints`' own rule at the pair's grain: a slot Sleeper carries empty
    // scores nothing, and the whole of the other side's figure is the gap.
    assert.equal(
      seatGap(seat("RB", null), seat("RB", { player_id: "b", points: 12 })),
      -12,
    );
  });
});

describe("seatOptions", () => {
  const bench = [
    player({ player_id: "rb1", positions: ["RB"], points: 14 }),
    player({ player_id: "wr1", positions: ["WR"], points: 16 }),
    player({ player_id: "qb1", positions: ["QB"], points: 22 }),
    player({ player_id: "te1", positions: ["TE"], points: 8 }),
  ];

  test("offers only who may legally sit there, and never the holder", () => {
    // He was the first row, selected and chipped `in seat`. Pressing his seat
    // is what opened the pane and the lineup opposite is still showing him, so
    // the row answered nothing — and every delta here is measured against his
    // figure, which is on screen throughout.
    const options = seatOptions(
      seat("RB", { player_id: "held", positions: ["RB"], points: 11 }),
      bench,
    );
    assert.deepEqual(
      options.map((o) => o.player.player_id),
      ["rb1"],
    );
    assert.equal(options[0]?.delta, 3);
  });

  test("a flex takes the three positions the solver seats there", () => {
    const options = seatOptions(
      seat("FLEX", { player_id: "held", positions: ["RB"], points: 11 }),
      bench,
    );
    assert.deepEqual(
      options.map((o) => o.player.player_id),
      ["wr1", "rb1", "te1"],
    );
  });

  test("a superflex is the one seat a quarterback can be moved into", () => {
    const options = seatOptions(
      seat("SUPER_FLEX", { player_id: "held", positions: ["RB"], points: 11 }),
      bench,
    );
    assert.equal(options[0]?.player.player_id, "qb1");
    assert.equal(options[0]?.delta, 11);
  });

  test("a locked seat has no options, because Sleeper would refuse them", () => {
    // The pane answers with the locked note and an empty list rather than a
    // list of moves that cannot be made.
    assert.deepEqual(
      seatOptions(
        seat("RB", { player_id: "held", positions: ["RB"], points: 11, locked: true }),
        bench,
      ),
      [],
    );
  });

  test("a locked candidate stays on the list, with his own padlock to say why", () => {
    // He used to be filtered out, on the grounds that Sleeper would refuse the
    // move. His row says exactly that; an absence reads as a player the app has
    // lost.
    const options = seatOptions(
      seat("RB", { player_id: "held", positions: ["RB"], points: 11 }),
      [player({ player_id: "rb1", positions: ["RB"], points: 14, locked: true })],
    );
    assert.deepEqual(
      options.map((o) => [o.player.player_id, o.player.locked]),
      [["rb1", true]],
    );
  });

  test("an empty seat is worth nothing, so an option's delta is his whole projection", () => {
    const options = seatOptions(seat("RB", null), bench);
    assert.deepEqual(
      options.map((o) => [o.player.player_id, o.delta]),
      [["rb1", 14]],
    );
  });

  test("an unpriced figure on either end is a null delta, never a zero", () => {
    const unpriced = seatOptions(
      seat("RB", { player_id: "held", positions: ["RB"], points: null }),
      [player({ player_id: "rb1", positions: ["RB"], points: 14 })],
    );
    assert.equal(unpriced[0]?.delta, null);

    const option = seatOptions(
      seat("RB", { player_id: "held", positions: ["RB"], points: 11 }),
      [player({ player_id: "rb1", positions: ["RB"], points: null })],
    );
    assert.equal(option[0]?.delta, null);
  });

  test("an unprojected player sorts last in a list ordered best first", () => {
    // Not the cheapest player on the bench — the absent one.
    const options = seatOptions(
      seat("RB", { player_id: "held", positions: ["RB"], points: 11 }),
      [
        player({ player_id: "none", positions: ["RB"], points: null }),
        player({ player_id: "rb1", positions: ["RB"], points: 14 }),
      ],
    );
    assert.deepEqual(
      options.map((o) => o.player.player_id),
      ["rb1", "none"],
    );
  });

  test("the holder is dropped even where the bench also lists him", () => {
    // Sleeper can carry a starter in `players` too. He is the thing every delta
    // is measured from, so he must not also be one of the things measured.
    assert.deepEqual(
      seatOptions(
        seat("RB", { player_id: "held", positions: ["RB"], points: 11 }),
        [player({ player_id: "held", positions: ["RB"], points: 11 })],
      ),
      [],
    );
  });

  test("a holder whose positions the seat would refuse is still not offered", () => {
    // He is in the seat whatever his positions say — the list is of everyone
    // *else*, so his own eligibility never comes into it.
    const options = seatOptions(
      seat("QB", { player_id: "held", positions: ["WR"], points: 4 }),
      bench,
    );
    assert.deepEqual(
      options.map((o) => o.player.player_id),
      ["qb1"],
    );
  });
});
