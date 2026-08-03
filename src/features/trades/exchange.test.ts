import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Trade, TradeSide } from "@/shared/trades";

import {
  counterpartyRoster,
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
