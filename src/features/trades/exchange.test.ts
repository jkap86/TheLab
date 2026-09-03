import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Trade, TradeSide } from "@/shared/contract";

import {
  counterpartyRoster,
  givenBundle,
  isEmptyBundle,
  receivedBundle,
} from "./exchange.ts";

const side = (roster_id: number, over: Partial<TradeSide> = {}): TradeSide => ({
  roster_id,
  user_id: `user${roster_id}`,
  players: [],
  picks: [],
  faab: 0,
  ...over,
});

const trade = (sides: TradeSide[]): Trade => ({
  transaction_id: "t1",
  league_id: "l1",
  week: 2,
  completed_at: Date.parse("2026-07-15T12:00:00Z"),
  sides,
});

describe("receivedBundle", () => {
  test("is the side's own haul", () => {
    const pick = { season: "2027", round: 3, roster_id: 2, user_id: "user2" };
    const bundle = receivedBundle(
      side(1, { players: ["p1"], picks: [pick], faab: 25 }),
    );

    assert.deepEqual(bundle.players, ["p1"]);
    assert.deepEqual(bundle.picks, [pick]);
    assert.equal(bundle.faab, 25);
    assert.equal(isEmptyBundle(bundle), false);
  });

  // A three-way can leave a participant taking nothing at all, and the card says
  // so rather than drawing a blank block.
  test("a side that only gave things up came away empty", () => {
    assert.ok(isEmptyBundle(receivedBundle(side(2))));
  });

  test("FAAB alone is not empty", () => {
    assert.equal(isEmptyBundle(receivedBundle(side(2, { faab: 5 }))), false);
  });
});

describe("counterpartyRoster", () => {
  test("a two-sided trade's other side is who handed everything over", () => {
    const t = trade([side(1, { players: ["p1"] }), side(2, { faab: 25 })]);

    assert.equal(counterpartyRoster(t, t.sides[0]), 2);
    assert.equal(counterpartyRoster(t, t.sides[1]), 1);
  });

  // Nothing Sleeper stores says which participant an asset came through, so the
  // card declines to name one rather than guessing — see the module note.
  test("a three-way trade has no attributable giver", () => {
    const t = trade([
      side(1, { players: ["p1"] }),
      side(2),
      side(3, { faab: 5 }),
    ]);

    assert.equal(counterpartyRoster(t, t.sides[0]), null);
    assert.equal(counterpartyRoster(t, t.sides[2]), null);
  });

  test("a lone side has no counterparty", () => {
    const t = trade([side(1, { players: ["p1"] })]);

    assert.equal(counterpartyRoster(t, t.sides[0]), null);
  });
});

describe("givenBundle", () => {
  // One stored fact read from two directions: what a side gave is what the other
  // side is recorded as receiving, so the two halves of a card cannot disagree.
  test("a side's give is the other side's take", () => {
    const pick = { season: "2027", round: 1, roster_id: 2, user_id: "user2" };
    const t = trade([
      side(1, { players: ["p1"] }),
      side(2, { players: ["p2", "p3"], picks: [pick], faab: 25 }),
    ]);

    assert.deepEqual(givenBundle(t, t.sides[0]), {
      players: ["p2", "p3"],
      picks: [pick],
      faab: 25,
    });
    assert.deepEqual(givenBundle(t, t.sides[1]), {
      players: ["p1"],
      picks: [],
      faab: 0,
    });
  });

  // The same limit `counterpartyRoster` holds to, and for the same reason: an
  // asset that moved in a three-way could have come from either of the others,
  // so there is no honest `−` line to draw.
  test("a three-way trade has no attributable give", () => {
    const t = trade([
      side(1, { players: ["p1"] }),
      side(2, { players: ["p2"] }),
      side(3, { faab: 5 }),
    ]);

    assert.equal(givenBundle(t, t.sides[0]), null);
    assert.equal(givenBundle(t, t.sides[2]), null);
  });

  test("a lone side gave nothing knowable", () => {
    const t = trade([side(1, { players: ["p1"] })]);

    assert.equal(givenBundle(t, t.sides[0]), null);
  });

  // A two-sided trade where one roster only gave things up: the give half is a
  // real, non-empty answer and the take half is the empty one.
  test("an empty counterparty haul is an empty give", () => {
    const t = trade([side(1, { players: ["p1"] }), side(2)]);

    assert.ok(isEmptyBundle(givenBundle(t, t.sides[0])!));
    assert.equal(isEmptyBundle(givenBundle(t, t.sides[1])!), false);
  });
});
