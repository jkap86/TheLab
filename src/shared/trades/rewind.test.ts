import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { rewindRosters, rewindTradeRosters } from "./rewind.ts";
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

/** The snapshot for one `(trade, roster)`, or undefined where none was emitted. */
const stateOf = (
  snapshots: ReturnType<typeof rewindTradeRosters>,
  transactionId: string,
  rosterId: number,
): RosterState | undefined =>
  snapshots.find(
    (s) => s.transaction_id === transactionId && s.roster_id === rosterId,
  )?.state;

describe("rewindTradeRosters", () => {
  test("the snapshot is the roster *before* the trade, not after", () => {
    // Roster 1 currently holds the player it received; roster 2 does not.
    const current = new Map([
      [1, roster(["received"])],
      [2, roster(["kept"])],
    ]);

    const snapshots = rewindTradeRosters(current, [
      tx({ adds: { received: 1 }, drops: { received: 2 } }),
    ]);

    assert.deepEqual(stateOf(snapshots, "t1", 1)?.players, []);
    assert.deepEqual(stateOf(snapshots, "t1", 2)?.players, ["kept", "received"]);
  });

  test("moves after the trade are undone before the snapshot is taken", () => {
    // Now: roster 1 holds a waiver pickup and no longer holds the traded player.
    const current = new Map([[1, roster(["waiver-add"])]]);

    const snapshots = rewindTradeRosters(current, [
      // Newest first: the waiver came after the trade.
      tx({
        transaction_id: "w1",
        type: "waiver",
        adds: { "waiver-add": 1 },
        drops: { "dropped-later": 1 },
      }),
      tx({ transaction_id: "t1", roster_ids: [1], adds: { "traded-away": 2 }, drops: { "traded-away": 1 } }),
    ]);

    // Before the trade roster 1 held the player it later dropped *and* the one
    // it was about to trade; the waiver pickup is gone.
    assert.deepEqual(stateOf(snapshots, "t1", 1)?.players, [
      "dropped-later",
      "traded-away",
    ]);
  });

  test("only trades produce snapshots, but every transaction is reversed", () => {
    const current = new Map([[1, roster(["a"])]]);

    const snapshots = rewindTradeRosters(current, [
      tx({ transaction_id: "fa1", type: "free_agent", adds: { a: 1 } }),
      tx({ transaction_id: "t1", roster_ids: [1], drops: { b: 1 } }),
    ]);

    assert.deepEqual(
      snapshots.map((s) => s.transaction_id),
      ["t1"],
    );
    // "a" was added after the trade, so it is gone; "b" was given up in the
    // trade, so it is back.
    assert.deepEqual(stateOf(snapshots, "t1", 1)?.players, ["b"]);
  });

  test("a pick returns to the roster that sent it and leaves the one that took it", () => {
    const current = new Map([
      [1, roster([], [{ season: "2027", round: 1, roster_id: 2 }])],
      [2, roster([], [])],
    ]);

    const snapshots = rewindTradeRosters(current, [
      tx({
        draft_picks: [
          { season: "2027", round: 1, roster_id: 2, owner_id: 1, previous_owner_id: 2 },
        ],
      }),
    ]);

    assert.deepEqual(stateOf(snapshots, "t1", 1)?.picks, []);
    assert.deepEqual(stateOf(snapshots, "t1", 2)?.picks, [
      { season: "2027", round: 1, roster_id: 2 },
    ]);
  });

  test("a pick whose previous owner is missing still leaves the roster that took it", () => {
    // The two halves are independent claims: not knowing who sent it says
    // nothing about the roster that received it.
    const current = new Map([
      [1, roster([], [{ season: "2027", round: 2, roster_id: 3 }])],
    ]);

    const snapshots = rewindTradeRosters(current, [
      tx({
        roster_ids: [1],
        draft_picks: [
          { season: "2027", round: 2, roster_id: 3, owner_id: 1, previous_owner_id: null },
        ],
      }),
    ]);

    assert.deepEqual(stateOf(snapshots, "t1", 1)?.picks, []);
  });

  test("a pick outside today's horizon is restored to its sender anyway", () => {
    // The starting portfolio holds no 2024 pick — that draft has happened — but
    // the transaction names the cell, so reversing it is still exact for the
    // roster that gave it up.
    const current = new Map([
      [1, roster([], [])],
      [2, roster([], [])],
    ]);

    const snapshots = rewindTradeRosters(current, [
      tx({
        draft_picks: [
          { season: "2024", round: 3, roster_id: 2, owner_id: 1, previous_owner_id: 2 },
        ],
      }),
    ]);

    assert.deepEqual(stateOf(snapshots, "t1", 2)?.picks, [
      { season: "2024", round: 3, roster_id: 2 },
    ]);
  });

  test("Sleeper's string ids read the same as its numeric ones", () => {
    const current = new Map([
      [1, roster(["moved"])],
      [2, roster([])],
    ]);

    const snapshots = rewindTradeRosters(current, [
      tx({
        roster_ids: ["1", "2"],
        adds: { moved: "1" },
        drops: { moved: "2" },
      }),
    ]);

    assert.deepEqual(stateOf(snapshots, "t1", 1)?.players, []);
    assert.deepEqual(stateOf(snapshots, "t1", 2)?.players, ["moved"]);
  });

  test("a roster with no current state is skipped rather than reported empty", () => {
    const snapshots = rewindTradeRosters(new Map([[1, roster(["a"])]]), [
      tx({ roster_ids: [1, 99] }),
    ]);

    assert.deepEqual(
      snapshots.map((s) => s.roster_id),
      [1],
    );
  });

  test("a roster named twice by one trade yields one snapshot", () => {
    const snapshots = rewindTradeRosters(new Map([[1, roster(["a"])]]), [
      tx({ roster_ids: [1, 1] }),
    ]);

    assert.equal(snapshots.length, 1);
  });

  test("junk in the blobs costs that fact and nothing else", () => {
    const current = new Map([[1, roster(["a"], [])]]);

    const snapshots = rewindTradeRosters(current, [
      tx({
        roster_ids: [1],
        adds: "not an object",
        drops: null,
        draft_picks: [
          null,
          { season: "2027", round: "x", roster_id: 1, previous_owner_id: 1 },
          { round: 1, roster_id: 1, previous_owner_id: 1 },
          { season: "2028", round: 4, roster_id: 2, previous_owner_id: 1 },
        ],
      }),
    ]);

    assert.deepEqual(stateOf(snapshots, "t1", 1)?.players, ["a"]);
    assert.deepEqual(stateOf(snapshots, "t1", 1)?.picks, [
      { season: "2028", round: 4, roster_id: 2 },
    ]);
  });

  test("output is sorted, so recomputing a snapshot writes the identical row", () => {
    const current = new Map([
      [
        1,
        roster(
          ["zeta", "alpha", "mid"],
          [
            { season: "2028", round: 1, roster_id: 1 },
            { season: "2027", round: 2, roster_id: 3 },
            { season: "2027", round: 2, roster_id: 1 },
          ],
        ),
      ],
    ]);

    const snapshots = rewindTradeRosters(current, [tx({ roster_ids: [1] })]);

    assert.deepEqual(stateOf(snapshots, "t1", 1)?.players, [
      "alpha",
      "mid",
      "zeta",
    ]);
    assert.deepEqual(stateOf(snapshots, "t1", 1)?.picks, [
      { season: "2027", round: 2, roster_id: 1 },
      { season: "2027", round: 2, roster_id: 3 },
      { season: "2028", round: 1, roster_id: 1 },
    ]);
  });

  test("one walk answers several trades, each from the state at its own moment", () => {
    // Two trades between the same pair. t1 sent `a` to roster 1 and `b` to
    // roster 2; t2 then sent `c` to roster 1 and `a` back to roster 2 — so the
    // state now is roster 1 holding `c` and roster 2 holding `a` and `b`.
    const current = new Map([
      [1, roster(["c"])],
      [2, roster(["a", "b"])],
    ]);

    const snapshots = rewindTradeRosters(current, [
      tx({
        transaction_id: "t2",
        adds: { c: 1, a: 2 },
        drops: { c: 2, a: 1 },
      }),
      tx({
        transaction_id: "t1",
        adds: { a: 1, b: 2 },
        drops: { a: 2, b: 1 },
      }),
    ]);

    // Before t2: roster 1 still held what t1 gave it, roster 2 held the rest.
    assert.deepEqual(stateOf(snapshots, "t2", 1)?.players, ["a"]);
    assert.deepEqual(stateOf(snapshots, "t2", 2)?.players, ["b", "c"]);
    // Before t1: both halves are back where they started, one trade further on.
    assert.deepEqual(stateOf(snapshots, "t1", 1)?.players, ["b"]);
    assert.deepEqual(stateOf(snapshots, "t1", 2)?.players, ["a", "c"]);
  });
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

  test("the whole log is the league as it stood before the trade", () => {
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

  test("it agrees with the trade walk at the trade's own stop", () => {
    // The two entry points are one reversal read two ways, so the state this
    // reports before the last move must be the snapshot the walk emits for it.
    const snapshots = rewindTradeRosters(now(), log);
    const scrubbed = rewindRosters(now(), log, log.length);

    assert.deepEqual(stateOf(snapshots, "t1", 1), scrubbed.get(1));
    assert.deepEqual(stateOf(snapshots, "t1", 2), scrubbed.get(2));
  });

  test("picks travel back with their players", () => {
    const current = new Map([
      [1, roster([], [{ season: "2027", round: 1, roster_id: 2 }])],
      [2, roster([], [])],
    ]);

    const before = rewindRosters(
      current,
      [
        tx({
          transaction_id: "t1",
          draft_picks: [
            { season: "2027", round: 1, roster_id: 2, owner_id: 1, previous_owner_id: 2 },
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
});
