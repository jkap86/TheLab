import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { rewindRosters } from "./rewind.ts";
import type { RewindTransaction, RosterState } from "./rewind.ts";

const roster = (
  players: string[],
  picks: RosterState["picks"] = [],
): RosterState => ({ players, picks });

const tx = (overrides: Partial<RewindTransaction> = {}): RewindTransaction => ({
  transaction_id: "t1",
  type: "trade",
  roster_ids: [1, 2],
  adds: null,
  drops: null,
  draft_picks: null,
  ...overrides,
});

describe("rewindRosters", () => {
  /** Three moves, newest first, over a two-team league. */
  const log: RewindTransaction[] = [
    tx({
      transaction_id: "w2",
      type: "waiver",
      roster_ids: [2],
      adds: { late: 2 },
      drops: { "cut-late": 2 },
    }),
    tx({
      transaction_id: "w1",
      type: "waiver",
      roster_ids: [1],
      adds: { pickup: 1 },
      drops: null,
    }),
    tx({
      transaction_id: "t1",
      roster_ids: [1, 2],
      adds: { moved: 1 },
      drops: { moved: 2 },
    }),
  ];

  const now = () =>
    new Map([
      [1, roster(["moved", "pickup"])],
      [2, roster(["late"])],
    ]);

  test("a count of zero is the current state", () => {
    const states = rewindRosters(now(), log, 0);
    assert.deepEqual(states.get(1)?.players, ["moved", "pickup"]);
    assert.deepEqual(states.get(2)?.players, ["late"]);
  });

  test("each step undoes exactly one move", () => {
    // One back: roster 2's waiver is undone, and nothing about roster 1 moves.
    const one = rewindRosters(now(), log, 1);
    assert.deepEqual(one.get(1)?.players, ["moved", "pickup"]);
    assert.deepEqual(one.get(2)?.players, ["cut-late"]);

    // Two back: roster 1's pickup goes too.
    const two = rewindRosters(now(), log, 2);
    assert.deepEqual(two.get(1)?.players, ["moved"]);
    assert.deepEqual(two.get(2)?.players, ["cut-late"]);
  });

  test("the whole log is the league as it stood before the oldest move", () => {
    const before = rewindRosters(now(), log, log.length);
    assert.deepEqual(before.get(1)?.players, []);
    assert.deepEqual(before.get(2)?.players, ["cut-late", "moved"]);
  });

  test("every roster answers, including the ones no move named", () => {
    const current = new Map([
      [1, roster(["moved", "pickup"])],
      [2, roster(["late"])],
      // A team that sat still through the whole window.
      [3, roster(["idle"])],
    ]);

    const states = rewindRosters(current, log, log.length);
    assert.deepEqual([...states.keys()].sort(), [1, 2, 3]);
    assert.deepEqual(states.get(3)?.players, ["idle"]);
  });

  test("a count past the end of the log stops at the end of it", () => {
    assert.deepEqual(
      rewindRosters(now(), log, 99).get(2)?.players,
      rewindRosters(now(), log, log.length).get(2)?.players,
    );
  });

  test("a negative count is the present rather than a walk the other way", () => {
    assert.deepEqual(rewindRosters(now(), log, -3).get(1)?.players, [
      "moved",
      "pickup",
    ]);
  });

  test("every type is reversed, not only trades", () => {
    // A free agent add is a move like any other: the pickup has to come off.
    const states = rewindRosters(new Map([[1, roster(["a"])]]), [
      tx({ transaction_id: "fa1", type: "free_agent", adds: { a: 1 } }),
    ], 1);

    assert.deepEqual(states.get(1)?.players, []);
  });

  test("a pick returns to the roster that sent it and leaves the one that took it", () => {
    const current = new Map([
      [1, roster([], [{ season: "2027", round: 1, roster_id: 2 }])],
      [2, roster([], [])],
    ]);

    const before = rewindRosters(
      current,
      [
        tx({
          draft_picks: [
            {
              season: "2027",
              round: 1,
              roster_id: 2,
              owner_id: 1,
              previous_owner_id: 2,
            },
          ],
        }),
      ],
      1,
    );

    assert.deepEqual(before.get(1)?.picks, []);
    assert.deepEqual(before.get(2)?.picks, [
      { season: "2027", round: 1, roster_id: 2 },
    ]);
  });

  test("a pick whose previous owner is missing still leaves the roster that took it", () => {
    // The two halves are independent claims: not knowing who sent it says
    // nothing about the roster that received it.
    const current = new Map([
      [1, roster([], [{ season: "2027", round: 2, roster_id: 3 }])],
    ]);

    const before = rewindRosters(
      current,
      [
        tx({
          roster_ids: [1],
          draft_picks: [
            {
              season: "2027",
              round: 2,
              roster_id: 3,
              owner_id: 1,
              previous_owner_id: null,
            },
          ],
        }),
      ],
      1,
    );

    assert.deepEqual(before.get(1)?.picks, []);
  });

  test("a pick outside today's horizon is restored to its sender anyway", () => {
    // The starting portfolio holds no 2024 pick — that draft has happened — but
    // the transaction names the cell, so reversing it is still exact for the
    // roster that gave it up.
    const before = rewindRosters(
      new Map([
        [1, roster([], [])],
        [2, roster([], [])],
      ]),
      [
        tx({
          draft_picks: [
            {
              season: "2024",
              round: 3,
              roster_id: 2,
              owner_id: 1,
              previous_owner_id: 2,
            },
          ],
        }),
      ],
      1,
    );

    assert.deepEqual(before.get(2)?.picks, [
      { season: "2024", round: 3, roster_id: 2 },
    ]);
  });

  test("a half-named pick is dropped rather than half-reversed", () => {
    // No season: reversing the owner half alone would move an asset under a key
    // nothing else will ever match.
    const before = rewindRosters(
      new Map([
        [1, roster([], [{ season: "2027", round: 1, roster_id: 2 }])],
        [2, roster([], [])],
      ]),
      [
        tx({
          draft_picks: [
            { round: 1, roster_id: 2, owner_id: 1, previous_owner_id: 2 },
          ],
        }),
      ],
      1,
    );

    assert.deepEqual(before.get(1)?.picks, [
      { season: "2027", round: 1, roster_id: 2 },
    ]);
    assert.deepEqual(before.get(2)?.picks, []);
  });

  test("Sleeper's string ids read the same as its numeric ones", () => {
    const before = rewindRosters(
      new Map([
        [1, roster(["moved"])],
        [2, roster([])],
      ]),
      [tx({ roster_ids: ["1", "2"], adds: { moved: "1" }, drops: { moved: "2" } })],
      1,
    );

    assert.deepEqual(before.get(1)?.players, []);
    assert.deepEqual(before.get(2)?.players, ["moved"]);
  });

  test("a roster with no current state is skipped rather than reported empty", () => {
    const before = rewindRosters(new Map([[1, roster(["a"])]]), [
      tx({ roster_ids: [1, 99], drops: { b: 99 } }),
    ], 1);

    assert.deepEqual([...before.keys()], [1]);
  });

  test("junk in a blob costs that fact and nothing else", () => {
    const before = rewindRosters(
      new Map([[1, roster(["kept", "added"])]]),
      [
        tx({
          roster_ids: "nonsense",
          adds: { added: 1 },
          drops: "nonsense",
          draft_picks: "nonsense",
        }),
      ],
      1,
    );

    assert.deepEqual(before.get(1)?.players, ["kept"]);
  });
});
