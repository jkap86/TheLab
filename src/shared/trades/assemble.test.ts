import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { assembleTrade } from "./assemble.ts";
import type { TradeRow } from "./assemble.ts";

const row = (overrides: Partial<TradeRow> = {}): TradeRow => ({
  transaction_id: "t1",
  league_id: "l1",
  week: 3,
  created: 1_700_000_000_000,
  status_updated: 1_700_000_900_000,
  roster_ids: [1, 2],
  adds: null,
  draft_picks: null,
  waiver_budget: null,
  ...overrides,
});

const owners = new Map([
  [1, "userA"],
  [2, "userB"],
]);

describe("assembleTrade", () => {
  test("splits players by the roster that received them", () => {
    const trade = assembleTrade(
      row({ adds: { "4034": 1, "6794": 1, "1234": 2 } }),
      owners,
    );

    assert.deepEqual(
      trade.sides.map((s) => [s.roster_id, s.user_id, s.players.sort()]),
      [
        [1, "userA", ["4034", "6794"]],
        [2, "userB", ["1234"]],
      ],
    );
  });

  test("a pick goes to its new owner and keeps the roster it came from", () => {
    const trade = assembleTrade(
      row({
        draft_picks: [
          { season: "2026", round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 },
          { season: "2027", round: 3, roster_id: 1, previous_owner_id: 1, owner_id: 2 },
        ],
      }),
      owners,
    );

    // The 2026 first is roster 2's own pick, now held by roster 1 — the origin
    // is what names the asset, not who is trading it.
    assert.deepEqual(trade.sides[0].picks, [
      { season: "2026", round: 1, roster_id: 2, user_id: "userB" },
    ]);
    assert.deepEqual(trade.sides[1].picks, [
      { season: "2027", round: 3, roster_id: 1, user_id: "userA" },
    ]);
  });

  // The case the owner is carried for: a pick from a roster that isn't in the
  // trade, which is the one a card names an origin for — and which the sides
  // alone could never resolve.
  test("a pick names its owner even from outside the trade", () => {
    const trade = assembleTrade(
      row({
        draft_picks: [
          { season: "2027", round: 1, roster_id: 9, previous_owner_id: 2, owner_id: 1 },
          { season: "2028", round: 1, roster_id: 7, previous_owner_id: 2, owner_id: 1 },
        ],
      }),
      new Map([...owners, [9, "userI"]]),
    );

    assert.deepEqual(trade.sides[0].picks, [
      { season: "2027", round: 1, roster_id: 9, user_id: "userI" },
      // Roster 7 is in no cached map at all: null rather than a guess, the same
      // rule an unnamed side follows.
      { season: "2028", round: 1, roster_id: 7, user_id: null },
    ]);
  });

  test("FAAB lands on the receiver and sums across entries", () => {
    const trade = assembleTrade(
      row({
        waiver_budget: [
          { sender: 2, receiver: 1, amount: 12 },
          { sender: 2, receiver: 1, amount: 8 },
        ],
      }),
      owners,
    );

    assert.equal(trade.sides[0].faab, 20);
    assert.equal(trade.sides[1].faab, 0);
  });

  test("a roster that only gave things up still gets a side", () => {
    // Three-way: 3 sends a player to 1 and takes nothing from anyone.
    const trade = assembleTrade(
      row({ roster_ids: [1, 2, 3], adds: { "4034": 1, "1234": 2 } }),
      owners,
    );

    assert.deepEqual(
      trade.sides.map((s) => s.roster_id),
      [1, 2, 3],
    );
    assert.deepEqual(trade.sides[2], {
      roster_id: 3,
      user_id: null, // not in `owners` — an uncached or orphan team
      players: [],
      picks: [],
      faab: 0,
    });
  });

  test("completes at status_updated, falling back to created", () => {
    assert.equal(assembleTrade(row(), owners).completed_at, 1_700_000_900_000);
    assert.equal(
      assembleTrade(row({ status_updated: null }), owners).completed_at,
      1_700_000_000_000,
    );
  });

  test("junk in the JSONB blobs is skipped, not thrown on", () => {
    const trade = assembleTrade(
      row({
        roster_ids: "not-an-array",
        adds: { "4034": "1" }, // roster id as a string
        draft_picks: [null, { season: "2026" }, "nope"],
        waiver_budget: [{ receiver: 1 }],
      }),
      owners,
    );

    assert.deepEqual(trade.sides.map((s) => s.roster_id), [1]);
    assert.deepEqual(trade.sides[0].players, ["4034"]);
    assert.deepEqual(trade.sides[0].picks, []);
    assert.equal(trade.sides[0].faab, 0);
  });
});
