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

/**
 * Who a trade is attributed to, once a roster has changed hands.
 *
 * **The failure these pin is silent and it is a wrong answer, not a thin one.**
 * `owners` is the roster → user map as it stands *today*, and it used to be the
 * only thing a side was labelled from — so the moment manager B took over
 * manager A's roster, every trade A had ever made was drawn, filtered and
 * counted as B's. Nothing errors, nothing looks broken, and the card says
 * somebody made a trade they never made.
 *
 * `participant_owners` is the stored snapshot — who held each roster when this
 * app first observed the trade — written once and never rewritten (see
 * `tradeParticipantsRebuildSql`). What is asserted here is the precedence: the
 * snapshot wins, today's owner is the fallback, and neither is allowed to
 * disappear.
 */
describe("assembleTrade, once a roster has changed hands", () => {
  /** Manager B holds both rosters now; A and C held them when they dealt. */
  const nowOwners = new Map([
    [1, "userB"],
    [2, "userB"],
  ]);

  test("a side is named by who dealt, not by who holds the roster now", () => {
    const trade = assembleTrade(
      row({
        adds: { "4034": 1, "1234": 2 },
        participant_owners: { "1": "userA", "2": "userC" },
      }),
      nowOwners,
    );

    assert.deepEqual(
      trade.sides.map((s) => s.user_id),
      ["userA", "userC"],
    );
  });

  test("today's owner is the fallback where the snapshot cannot answer", () => {
    // A roster with no participant row — orphaned when the trade was first
    // stored, or a league synced before the column existed. Today's owner is
    // the only thing available and is better than an unnamed side.
    const trade = assembleTrade(
      row({ participant_owners: { "1": "userA" } }),
      nowOwners,
    );

    assert.deepEqual(
      trade.sides.map((s) => s.user_id),
      ["userA", "userB"],
    );
  });

  test("no snapshot at all leaves every side on today's owner", () => {
    for (const absent of [null, undefined, {}, [], "nonsense", 7]) {
      const trade = assembleTrade(row({ participant_owners: absent }), nowOwners);
      assert.deepEqual(
        trade.sides.map((s) => s.user_id),
        ["userB", "userB"],
        `participant_owners: ${JSON.stringify(absent)}`,
      );
    }
  });

  test("an unnamed side stays unnamed rather than dropping the trade", () => {
    const trade = assembleTrade(row({ participant_owners: {} }), new Map());
    assert.equal(trade.sides.length, 2);
    assert.deepEqual(
      trade.sides.map((s) => s.user_id),
      [null, null],
    );
  });

  test("a junk key or a non-string owner is skipped, not trusted", () => {
    // The column is untyped and read like every other Sleeper blob here: a key
    // that is not a roster id, or an owner that is not a name, falls to the
    // same place an absent entry does.
    const trade = assembleTrade(
      row({
        participant_owners: { "1": null, abc: "userZ", "2": "userC" },
      }),
      nowOwners,
    );

    assert.deepEqual(
      trade.sides.map((s) => s.user_id),
      ["userB", "userC"],
    );
  });

  test("a pick originating with a trading roster is priced to who dealt it", () => {
    // The one origin case the snapshot can answer: a pick that came from a
    // roster this trade names. Inferring that trader from today's owner is
    // exactly the mistake the column exists to stop.
    const trade = assembleTrade(
      row({
        draft_picks: [
          { season: "2026", round: 1, roster_id: 2, owner_id: 1 },
        ],
        participant_owners: { "1": "userA", "2": "userC" },
      }),
      nowOwners,
    );

    assert.equal(trade.sides[0].picks[0].user_id, "userC");
  });

  test("a pick from outside the trade falls to today's owner", () => {
    // Sleeper stores no ownership history, so an origin that is not a party to
    // this trade can only ever be "the roster this pick belongs to, held today
    // by X". That is a limit, and it is the honest reading of it.
    const trade = assembleTrade(
      row({
        roster_ids: [1, 2],
        draft_picks: [{ season: "2026", round: 1, roster_id: 9, owner_id: 1 }],
        participant_owners: { "1": "userA", "2": "userC" },
      }),
      new Map([...nowOwners, [9, "userOutside"]]),
    );

    assert.equal(trade.sides[0].picks[0].user_id, "userOutside");
  });

  test("a three-way trade resolves each side's history independently", () => {
    // The requirement that a multi-team trade keeps its shape while ownership
    // moves under one of its participants: roster 3 changed hands, the other
    // two did not, and each side answers for itself.
    const trade = assembleTrade(
      row({
        roster_ids: [1, 2, 3],
        adds: { "4034": 1, "1234": 2, "9999": 3 },
        participant_owners: { "1": "userA", "2": "userC", "3": "userD" },
      }),
      new Map([
        [1, "userA"],
        [2, "userC"],
        // Roster 3 has since moved to B.
        [3, "userB"],
      ]),
    );

    assert.equal(trade.sides.length, 3, "a three-way stays a three-way");
    assert.deepEqual(
      trade.sides.map((s) => [s.roster_id, s.user_id]),
      [
        [1, "userA"],
        [2, "userC"],
        [3, "userD"],
      ],
    );
  });
});
