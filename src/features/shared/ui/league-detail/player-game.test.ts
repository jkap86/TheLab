import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { playerGame } from "./player-game.ts";

/**
 * What a row may and may not claim about a player's game.
 *
 * The three absences are what this pins, because they are indistinguishable in
 * the type and opposite in meaning: no schedule, a bye, and half a game the
 * schedule named. Getting any of them wrong renders perfectly well — a `BYE` on
 * every row of every lineup is the failure mode of reading the first as the
 * second — which is exactly the shape of bug a test can catch and a review
 * cannot.
 */

/** Sunday 1:05 PM local, built from local parts so the assertion is zone-free. */
const SUNDAY = new Date(2026, 8, 13, 13, 5).getTime();
/** Thursday 8:20 PM local, the same week. */
const THURSDAY = new Date(2026, 8, 10, 20, 20).getTime();

const week = {
  LV: { opponent: "KC", home: false, kickoff: SUNDAY },
  KC: { opponent: "LV", home: true, kickoff: SUNDAY },
  PHI: { opponent: "DAL", home: true, kickoff: THURSDAY },
};

describe("playerGame", () => {
  test("names the opponent and the kickoff, home and away", () => {
    assert.deepEqual(playerGame("LV", week), {
      matchup: "@ KC",
      kickoff: "Sun 1:05p",
      title: "LV at KC · Sun 1:05p",
    });
    assert.equal(playerGame("KC", week)?.matchup, "vs LV");
    assert.equal(playerGame("PHI", week)?.kickoff, "Thu 8:20p");
  });

  test("a team the week doesn't hold is on a bye", () => {
    assert.deepEqual(playerGame("SF", week), {
      matchup: "BYE",
      kickoff: null,
      title: "SF are on bye",
    });
  });

  test("an empty week says nothing at all, rather than that everyone is on bye", () => {
    // What a failed or unpublished schedule read comes back as — a bye is an
    // absence, so it can only be read against a population that exists.
    assert.equal(playerGame("SF", {}), null);
    assert.equal(playerGame("LV", {}), null);
  });

  test("a row with no player, and one whose club we don't know, draw nothing", () => {
    assert.equal(playerGame(null, week), null);
    assert.equal(playerGame(undefined, week), null);
    assert.equal(playerGame("", week), null);
  });

  test("half a game is drawn as the half the schedule named", () => {
    const dated = { NYG: { opponent: null, home: true, kickoff: SUNDAY } };
    assert.deepEqual(playerGame("NYG", dated), {
      matchup: null,
      kickoff: "Sun 1:05p",
      title: "NYG · Sun 1:05p",
    });

    const undated = { NYG: { opponent: "WAS", home: false, kickoff: null } };
    assert.deepEqual(playerGame("NYG", undated), {
      matchup: "@ WAS",
      kickoff: null,
      title: "NYG at WAS · kickoff time not set",
    });
  });

  test("a morning kickoff reads `a`, noon is 12p rather than 0, and `:00` drops", () => {
    const london = new Date(2026, 8, 13, 9, 30).getTime();
    const noon = new Date(2026, 8, 13, 12, 0).getTime();
    const games = {
      JAX: { opponent: "MIN", home: false, kickoff: london },
      SEA: { opponent: "ARI", home: true, kickoff: noon },
    };
    assert.equal(playerGame("JAX", games)?.kickoff, "Sun 9:30a");
    // On the hour loses its minutes and only then — which is the pair that has
    // to fit a phone's 90px cell, since an ET slot is on the hour in every zone
    // west of it. See `formatKickoff` for the measurement.
    assert.equal(playerGame("SEA", games)?.kickoff, "Sun 12p");
    const oneOClock = new Date(2026, 8, 13, 13, 0).getTime();
    assert.equal(
      playerGame("SEA", { SEA: { opponent: "ARI", home: true, kickoff: oneOClock } })
        ?.kickoff,
      "Sun 1p",
    );
  });
});
