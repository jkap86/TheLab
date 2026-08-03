import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { pickLabel, pickOriginRoster } from "./pick-display.ts";

const pick = (roster_id: number, round = 1, season = "2026") => ({
  season,
  round,
  roster_id,
  user_id: `user${roster_id}`,
});

describe("pickLabel", () => {
  // What the league calls it once the order is set: 1.05 is a different asset
  // from 1.11, and the round alone says neither.
  test("names the slot where the draft order is set", () => {
    assert.equal(pickLabel(pick(3), 5), "2026 1.05");
    assert.equal(pickLabel(pick(3, 4), 12), "2026 4.12");
  });

  // Most picks on this board are seasons out, so the draft doesn't exist yet.
  test("falls back to the round where it isn't", () => {
    assert.equal(pickLabel(pick(3), null), "2026 1st");
    assert.equal(pickLabel(pick(3, 2), null), "2026 2nd");
    assert.equal(pickLabel(pick(3, 3), null), "2026 3rd");
    assert.equal(pickLabel(pick(3, 4), null), "2026 4th");
  });

  // Zero-padded so a column of picks lines up and `1.05` reads as a slot.
  test("pads a single-digit slot", () => {
    assert.equal(pickLabel(pick(1), 1), "2026 1.01");
    assert.equal(pickLabel(pick(1), 10), "2026 1.10");
  });
});

describe("pickOriginRoster", () => {
  // The ordinary trade: a manager hands over their own first, and naming them
  // beside it repeats the side across the card.
  test("is silent when the pick came from the roster handing it over", () => {
    assert.equal(pickOriginRoster(pick(2), 2), null);
  });

  // A third party's first is a different asset from the dealer's own.
  test("names the origin when the pick came from elsewhere", () => {
    assert.equal(pickOriginRoster(pick(7), 2), 7);
  });

  // Including the receiver's own pick coming back — that is not the giver's
  // pick, and saying whose it is distinguishes it from one.
  test("names a pick returning to its original owner", () => {
    assert.equal(pickOriginRoster(pick(1), 2), 1);
  });

  // A three-way has no knowable giver, so the origin is the only honest thing
  // the line can say.
  test("keeps the origin where the giver is unknown", () => {
    assert.equal(pickOriginRoster(pick(2), null), 2);
  });
});
