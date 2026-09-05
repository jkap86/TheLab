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
  test("draws on the side of whoever leads, and only that side", () => {
    const ahead = seatGap(
      seat("RB", { player_id: "a", points: 18 }),
      seat("RB", { player_id: "b", points: 12 }),
    );
    assert.equal(ahead.delta, 6);
    assert.equal(ahead.lead, "mine");

    const behind = seatGap(
      seat("RB", { player_id: "a", points: 12 }),
      seat("RB", { player_id: "b", points: 18 }),
    );
    assert.equal(behind.delta, -6);
    assert.equal(behind.lead, "theirs");
  });

  test("level is a real answer and fills nothing", () => {
    const level = seatGap(
      seat("RB", { player_id: "a", points: 12 }),
      seat("RB", { player_id: "b", points: 12 }),
    );
    assert.equal(level.delta, 0);
    assert.equal(level.fill, 0);
    assert.equal(level.lead, null);
  });

  test("a seat where either side is unpriced has no gap at all", () => {
    // Scoring it as zero hands the other side a maximal, full-length lead on a
    // row whose own figures say there is nothing to compare.
    const mine = seatGap(
      seat("RB", { player_id: "a", points: null }),
      seat("RB", { player_id: "b", points: 12 }),
    );
    assert.deepEqual(mine, { delta: null, fill: 0, lead: null });

    const theirs = seatGap(
      seat("RB", { player_id: "a", points: 12 }),
      seat("RB", { player_id: "b", points: null }),
    );
    assert.deepEqual(theirs, { delta: null, fill: 0, lead: null });
  });

  test("no seat opposite is no comparison", () => {
    // A lineup with more seats than the one beside it — nothing to draw.
    assert.deepEqual(seatGap(seat("RB", { player_id: "a" }), undefined), {
      delta: null,
      fill: 0,
      lead: null,
    });
  });

  test("the bar is scaled against the seat's own figures, and clamps", () => {
    // 6 of 18, times the 1.4 the gap scale is: 47%. A gap at quarterback and a
    // gap at a kicker are not drawn on one yardstick.
    assert.equal(
      seatGap(
        seat("RB", { player_id: "a", points: 18 }),
        seat("RB", { player_id: "b", points: 12 }),
      ).fill,
      47,
    );
    // 20 against 0 is 140% of the track before the clamp.
    assert.equal(
      seatGap(
        seat("RB", { player_id: "a", points: 20 }),
        seat("RB", { player_id: "b", points: 0 }),
      ).fill,
      100,
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

  test("offers only who may legally sit there, holder included and chipped", () => {
    const options = seatOptions(
      seat("RB", { player_id: "held", positions: ["RB"], points: 11 }),
      bench,
    );
    assert.deepEqual(
      options.map((o) => o.player.player_id),
      ["rb1", "held"],
    );
    assert.equal(options[1]?.inSeat, true);
    // No delta against himself — he is the thing every delta is measured from.
    assert.equal(options[1]?.delta, null);
    assert.equal(options[0]?.delta, 3);
  });

  test("a flex takes the three positions the solver seats there", () => {
    const options = seatOptions(
      seat("FLEX", { player_id: "held", positions: ["RB"], points: 11 }),
      bench,
    );
    assert.deepEqual(
      options.map((o) => o.player.player_id),
      ["wr1", "rb1", "held", "te1"],
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

  test("a locked player on the bench is out of the pool for every other seat", () => {
    const options = seatOptions(
      seat("RB", { player_id: "held", positions: ["RB"], points: 11 }),
      [player({ player_id: "rb1", positions: ["RB"], points: 14, locked: true })],
    );
    assert.deepEqual(
      options.map((o) => o.player.player_id),
      ["held"],
    );
  });

  test("an empty seat is worth nothing, so an option's delta is his whole projection", () => {
    const options = seatOptions(seat("RB", null), bench);
    assert.deepEqual(
      options.map((o) => [o.player.player_id, o.delta]),
      [["rb1", 14]],
    );
    // Nothing to chip: there is no holder.
    assert.equal(options.every((o) => !o.inSeat), true);
  });

  test("an unpriced figure on either end is a null delta, never a zero", () => {
    const unpriced = seatOptions(
      seat("RB", { player_id: "held", positions: ["RB"], points: null }),
      [player({ player_id: "rb1", positions: ["RB"], points: 14 })],
    );
    assert.equal(unpriced.find((o) => !o.inSeat)?.delta, null);

    const option = seatOptions(
      seat("RB", { player_id: "held", positions: ["RB"], points: 11 }),
      [player({ player_id: "rb1", positions: ["RB"], points: null })],
    );
    assert.equal(option.find((o) => !o.inSeat)?.delta, null);
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
      ["rb1", "held", "none"],
    );
  });

  test("the holder is listed whatever his positions say", () => {
    // He is in the seat. A list that dropped him would answer a different
    // question from the one the header asks.
    const options = seatOptions(
      seat("QB", { player_id: "held", positions: ["WR"], points: 4 }),
      bench,
    );
    assert.equal(options.some((o) => o.inSeat && o.player.player_id === "held"), true);
  });

  test("the holder is never offered twice when he is also on the bench", () => {
    const options = seatOptions(
      seat("RB", { player_id: "held", positions: ["RB"], points: 11 }),
      [player({ player_id: "held", positions: ["RB"], points: 11 })],
    );
    assert.deepEqual(
      options.map((o) => o.player.player_id),
      ["held"],
    );
  });
});
