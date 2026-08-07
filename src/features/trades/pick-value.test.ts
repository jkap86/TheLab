import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ktcPickKey } from "../../shared/ktc/picks.ts";
import type { KtcPickPrice } from "../../shared/ktc/picks.ts";
import {
  middleSlot,
  pickAdpValue,
  rookieLadder,
  rookiePickNumber,
} from "./pick-value.ts";
import type {
  PickAdpMatch,
  PickAdpResult,
  RookieLadderRung,
} from "./pick-value.ts";
import type { AdpPlayerPayload } from "./types";

/**
 * The rookie ladder and what a pick reads off it.
 *
 * What is worth pinning here is the pair of claims the column rests on and
 * neither type nor render can hold: that the ladder is the *order the selected
 * drafts took the class in* (so a market swap reorders it, and a player the
 * board never averaged is not a rung), and that a future pick is the same rung
 * scaled by KTC's own ratio rather than by anything invented here. Both are
 * silent when wrong — every card still draws a plausible number.
 */

const player = (
  id: string,
  over: Partial<AdpPlayerPayload> = {},
): AdpPlayerPayload => ({
  player_id: id,
  name: id,
  position: "WR",
  team: "SF",
  rookie: false,
  redraft: null,
  dynasty: null,
  ...over,
});

const stats = (adp: number) => ({
  adp,
  min_pick: 1,
  max_pick: 100,
  picks: 20,
  stdev: 3,
});

/**
 * A 12-team league starting nine — a pool of 108, on which the default four
 * halvings make value `10000 · 2^(−(adp−1)/27)`. The ADPs below are the picks
 * that land on exact powers of two, so an expected number is checkable rather
 * than a rounding to trust.
 */
const POOL = 108;
const ladder: RookieLadderRung[] = [1, 28, 55, 82].map((adp, i) => ({
  adp,
  name: `Rookie ${i + 1}`,
}));

/**
 * KTC prices 2027 and 2028 firsts, and 2028 at exactly half of 2027's early
 * row — so a discount comes out as a number a reader of this file can check.
 */
const ktcPicks: Record<string, KtcPickPrice> = {
  [ktcPickKey("2027", 1, "early")]: { sf: 6000, oneqb: 5400 },
  [ktcPickKey("2027", 1, null)]: { sf: 5000, oneqb: 4500 },
  [ktcPickKey("2028", 1, null)]: { sf: 3000, oneqb: 2700 },
};

const price = (
  over: Partial<Parameters<typeof pickAdpValue>[0]> = {},
) =>
  pickAdpValue({
    ladder,
    pick: { season: "2027", round: 1 },
    slot: null,
    teams: 12,
    pool: POOL,
    steepness: 4,
    ktcPicks,
    superflex: true,
    ...over,
  });

/**
 * Assert a pick priced, and hand the match back narrowed.
 *
 * The result is a union with a `reason` on the refusal side, which is the whole
 * point of it — but a test that has already said which side it expects should
 * not go on re-proving it field by field.
 */
function priced(result: PickAdpResult): PickAdpMatch {
  assert.notEqual(result.value, null, `unpriced: ${result.reason}`);
  return result as PickAdpMatch;
}

describe("rookieLadder", () => {
  const players = [
    player("vet", { dynasty: stats(2), redraft: stats(2) }),
    player("r1", { rookie: true, dynasty: stats(40), redraft: stats(9) }),
    player("r2", { rookie: true, dynasty: stats(12), redraft: stats(80) }),
    // A rookie the selected drafts never took: not a rung, because the ladder is
    // an ordering and a place invented for him shifts every pick below him.
    player("r3", { rookie: true }),
  ];

  test("only rookies, in the order the board took them", () => {
    assert.deepEqual(
      rookieLadder(players, "dynasty").map((rung) => rung.name),
      ["r2", "r1"],
    );
  });

  test("the two markets are two different queues", () => {
    // The whole reason a ladder is built per market: a rookie goes early in a
    // dynasty startup and late in a redraft, so a league reads the one it plays.
    assert.deepEqual(
      rookieLadder(players, "redraft").map((rung) => rung.name),
      ["r1", "r2"],
    );
  });

  test("a board with no rookies has no ladder rather than a short one", () => {
    assert.deepEqual(rookieLadder([players[0]], "dynasty"), []);
  });
});

describe("rookiePickNumber", () => {
  test("a pick is its place in the whole draft, not in its round", () => {
    assert.equal(rookiePickNumber(1, 5, 12), 5);
    assert.equal(rookiePickNumber(2, 1, 12), 13);
    // The league's size is what makes the same 2.01 a different rung.
    assert.equal(rookiePickNumber(2, 1, 10), 11);
  });

  test("an unplaced pick takes the middle of its round", () => {
    assert.equal(middleSlot(12), 6);
    assert.equal(middleSlot(10), 5);
  });
});

describe("pickAdpValue", () => {
  test("a placed pick is the rung its slot lands on", () => {
    const at = (slot: number) => price({ slot });
    // Rungs 1 and 3 of a pool-108 curve: the peak and a quarter of it.
    assert.equal(at(1).value, 10000);
    assert.equal(at(3).value, 2500);
    assert.equal(priced(at(3)).player, "Rookie 3");
  });

  test("an unplaced pick takes the middle of its round and says so", () => {
    // Slot 6 of 12 is rung 6, which this four-rung ladder doesn't reach.
    assert.equal(price().value, null);
    // With a wider draft the middle lands on rung 2 — half the peak.
    const narrow = price({ teams: 4 });
    assert.equal(narrow.value, 5000);
    assert.equal(priced(narrow).exact, false);
  });

  test("the team count decides the rung, and 12 stands in where it is unknown", () => {
    assert.equal(priced(price({ slot: 3, teams: null })).overall, 3);
    // A second-rounder is a different rung in a 4-team draft than in a 12-team
    // one — 2.01 of four is the fifth rookie off the board, where in twelve it
    // is the thirteenth and past this class entirely.
    const deep = [...ladder, { adp: 109, name: "Rookie 5" }];
    const small = price({
      ladder: deep,
      pick: { season: "2027", round: 2 },
      slot: 1,
      teams: 4,
    });
    assert.equal(priced(small).overall, 5);
    assert.equal(priced(small).player, "Rookie 5");
    assert.equal(
      price({ ladder: deep, pick: { season: "2027", round: 2 }, slot: 1 }).reason,
      "past-ladder",
    );
  });

  // The one thing KTC is asked for under this column, and the reason it is a
  // ratio: a ratio is dimensionless, so it crosses between the boards where a
  // sum of their values would not.
  test("a future pick is the same rung scaled by KTC's own ratio", () => {
    const now = price({ slot: 1 });
    const later = price({ pick: { season: "2028", round: 1 }, slot: 1 });
    assert.equal(priced(now).value, 10000);
    assert.equal(priced(now).discount, 1);
    assert.equal(priced(now).base, null);
    // Slot 1 of 12 is an early first: 3,000 against 6,000.
    assert.equal(priced(later).value, 5000);
    assert.equal(priced(later).discount, 0.5);
    assert.equal(priced(later).base, "2027");
  });

  test("a pick at or before the nearest priced season is undiscounted", () => {
    // A season KTC has dropped — its draft has happened — is the ladder's own
    // class, so there is nothing to discount it by.
    const past = price({ pick: { season: "2026", round: 1 }, slot: 2 });
    assert.equal(priced(past).discount, 1);
    assert.equal(priced(past).value, 5000);
  });

  test("the three ways it runs out are three different answers", () => {
    assert.equal(price({ ladder: [], slot: 1 }).reason, "no-ladder");
    assert.equal(
      price({ pick: { season: "2027", round: 2 }, slot: 1 }).reason,
      "past-ladder",
    );
    // Far enough out that KTC prices no row for it — left blank rather than
    // quoted at the nearest draft's price.
    assert.equal(
      price({ pick: { season: "2032", round: 1 }, slot: 1 }).reason,
      "no-discount",
    );
  });

  test("a stand-in anywhere in the chain is reported as one", () => {
    // Placed and read off KTC's own tier on both ends: exact.
    assert.equal(priced(price({ slot: 1 })).exact, true);
    // Placed, but 2028 has only an untiered row, so the ratio's numerator is a
    // stand-in for the early third.
    assert.equal(
      priced(price({ pick: { season: "2028", round: 1 }, slot: 1 })).exact,
      false,
    );
    // Unplaced, so the rung itself is the middle of the round.
    assert.equal(priced(price({ teams: 4 })).exact, false);
  });

  test("the panel's curve reaches a pick as it reaches a player", () => {
    assert.equal(price({ slot: 2, steepness: 4 }).value, 5000);
    assert.equal(price({ slot: 2, steepness: 8 }).value, 2500);
  });
});
