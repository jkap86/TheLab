import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { newDelivery, nextDelivery } from "./live-delivery.ts";
import type { DeliveryState } from "./live-delivery.ts";

/**
 * A reader's stream, driven as the state machine it is.
 *
 * The room's transport can refuse a frame — a stalled socket drops payloads
 * and deltas — and every rule here is about what the server may then assume.
 * None of them is visible from the outside when it is wrong: a baseline
 * advanced for a frame nobody took is a page that renders perfectly and is
 * quietly missing whatever moved in between.
 */

/** A reader on the other end of the wire, folding frames as the hook does. */
class Reader {
  state: DeliveryState = newDelivery();
  /** What the browser holds, or null before a payload has ever landed. */
  held: Record<string, string> | null = null;
  /** The same, for the week's stat board — the second diffed collection. */
  heldPlayers: Record<string, string> | null = null;

  /** Offer a frame; `accepted` is the transport's answer. */
  offer(
    header: string,
    leagues: Record<string, string>,
    accepted: boolean,
    force = false,
    players: Record<string, string> = {},
  ): "none" | "payload" | "delta" {
    const next = nextDelivery(this.state, header, leagues, players, force);
    if (next.kind === "none") return "none";
    if (!accepted) return next.kind;

    if (next.kind === "payload") {
      this.held = { ...leagues };
      this.heldPlayers = { ...players };
    } else {
      // The client's own fold: the named entries replace, the removed ones go,
      // everything else stands. Both collections, the same way.
      const held = { ...(this.held ?? {}) };
      for (const id of next.changed) held[id] = leagues[id];
      for (const id of next.removed) delete held[id];
      this.held = held;

      const board = { ...(this.heldPlayers ?? {}) };
      for (const id of next.players.changed) board[id] = players[id];
      for (const id of next.players.removed) delete board[id];
      this.heldPlayers = board;
    }
    this.state = next.commit;
    return next.kind;
  }
}

const H1 = JSON.stringify({ read_at: 1 });
const H2 = JSON.stringify({ read_at: 2 });
const H3 = JSON.stringify({ read_at: 3 });

describe("nextDelivery", () => {
  test("the first frame is a full payload, and only a delta after it", () => {
    const reader = new Reader();
    assert.equal(reader.offer(H1, { a: "1", b: "1" }, true), "payload");
    assert.deepEqual(reader.held, { a: "1", b: "1" });
    assert.equal(reader.offer(H2, { a: "2", b: "1" }, true), "delta");
    assert.deepEqual(reader.held, { a: "2", b: "1" });
  });

  test("a tick that moved nothing sends nothing", () => {
    const reader = new Reader();
    reader.offer(H1, { a: "1" }, true);
    assert.equal(reader.offer(H1, { a: "1" }, true), "none");
  });

  test("a header that moved on its own is still a frame", () => {
    // The statuses and the board ride the header; a feed that failed with the
    // values unchanged moves nothing else, and is the whole reason the header
    // is compared at all.
    const reader = new Reader();
    reader.offer(H1, { a: "1" }, true);
    assert.equal(reader.offer(H2, { a: "1" }, true), "delta");
  });

  test("`force` sends a frame the diff would have called unnecessary", () => {
    const reader = new Reader();
    reader.offer(H1, { a: "1" }, true);
    assert.equal(reader.offer(H1, { a: "1" }, true, true), "delta");
  });

  test("a payload is repeated until one is taken", () => {
    const reader = new Reader();
    assert.equal(reader.offer(H1, { a: "1" }, false), "payload");
    assert.equal(reader.held, null);
    // Still unseeded: a delta has nothing to fold onto.
    assert.equal(reader.offer(H2, { a: "2" }, false), "payload");
    assert.equal(reader.offer(H3, { a: "3" }, true), "payload");
    assert.deepEqual(reader.held, { a: "3" });
  });

  test("a dropped delta leaves the reader's state exactly where it was", () => {
    const reader = new Reader();
    reader.offer(H1, { a: "1", b: "1" }, true);
    assert.equal(reader.offer(H2, { a: "2", b: "1" }, false), "delta");
    assert.deepEqual(reader.held, { a: "1", b: "1" });
  });

  test("the next delta after a drop is cumulative, and lands the reader whole", () => {
    // The failure this exists to make impossible: the server advancing to B,
    // the socket dropping A→B, and the reader then folding B→C onto A.
    const reader = new Reader();
    reader.offer(H1, { a: "1", b: "1", c: "1" }, true);
    reader.offer(H2, { a: "2", b: "1", c: "1" }, false); // dropped
    assert.equal(reader.offer(H3, { a: "2", b: "3", c: "1" }, true), "delta");
    // `a` moved in the dropped frame and `b` in the accepted one; both are here.
    assert.deepEqual(reader.held, { a: "2", b: "3", c: "1" });
  });

  test("several dropped deltas in a row still resolve to one whole answer", () => {
    const reader = new Reader();
    reader.offer(H1, { a: "1", b: "1" }, true);
    reader.offer(H2, { a: "2", b: "1" }, false);
    reader.offer(H2, { a: "3", b: "2" }, false);
    reader.offer(H2, { a: "4", b: "2" }, false);
    reader.offer(H3, { a: "5", b: "2" }, true);
    assert.deepEqual(reader.held, { a: "5", b: "2" });
  });

  test("a league that left during a dropped frame still leaves", () => {
    const reader = new Reader();
    reader.offer(H1, { a: "1", gone: "1" }, true);
    reader.offer(H2, { a: "1" }, false); // the removal is dropped
    reader.offer(H3, { a: "2" }, true);
    assert.deepEqual(reader.held, { a: "2" });
  });

  test("recovery from backpressure sends only what is still outstanding", () => {
    const reader = new Reader();
    reader.offer(H1, { a: "1", b: "1", c: "1" }, true);
    // One league moves and is dropped; nothing else ever moves.
    reader.offer(H2, { a: "2", b: "1", c: "1" }, false);
    const state = reader.state;
    const next = nextDelivery(state, H2, { a: "2", b: "1", c: "1" }, {});
    assert.equal(next.kind, "delta");
    if (next.kind !== "delta") return;
    assert.deepEqual(next.changed, ["a"]);
    assert.deepEqual(next.removed, []);
  });

  test("the committed state is not applied to the reader until it is committed", () => {
    // The commit is a value handed back rather than a mutation, so a caller
    // that never applies it cannot half-apply it either.
    const reader = new Reader();
    reader.offer(H1, { a: "1" }, true);
    const before = reader.state;
    const next = nextDelivery(before, H2, { a: "2" }, {});
    assert.notEqual(next.kind, "none");
    assert.equal(reader.state, before);
    assert.equal(before.heldHeader, H1);
  });
});

/**
 * The week's stat board, diffed the same way the leagues are.
 *
 * It is the *reason* it is diffed that these exist: carried on the header it
 * would ride every frame whole, and a frame goes out every twenty seconds
 * while games run. So the rules that matter are that an unmoved board sends
 * nothing at all, and that a moved one sends only the rows that moved.
 */
describe("nextDelivery, over the stat board", () => {
  const P1 = { p1: "1", p2: "1" };

  test("the first payload carries the whole board", () => {
    const reader = new Reader();
    assert.equal(reader.offer(H1, { a: "1" }, true, false, P1), "payload");
    assert.deepEqual(reader.heldPlayers, P1);
  });

  test("a board that moved sends only the rows that moved", () => {
    const reader = new Reader();
    reader.offer(H1, { a: "1" }, true, false, P1);
    const next = nextDelivery(reader.state, H1, { a: "1" }, { p1: "1", p2: "2" });
    assert.equal(next.kind, "delta");
    if (next.kind !== "delta") return;
    assert.deepEqual(next.players.changed, ["p2"]);
    assert.deepEqual(next.changed, []);
  });

  test("a board that moved on its own is a frame, with no league in it", () => {
    // The whole point of the second diff: a scoring play moves the board and
    // not necessarily any league this reader is in.
    const reader = new Reader();
    reader.offer(H1, { a: "1" }, true, false, P1);
    assert.equal(reader.offer(H1, { a: "1" }, true, false, { p1: "1", p2: "2" }), "delta");
    assert.deepEqual(reader.heldPlayers, { p1: "1", p2: "2" });
    assert.deepEqual(reader.held, { a: "1" });
  });

  test("an unmoved board sends nothing", () => {
    const reader = new Reader();
    reader.offer(H1, { a: "1" }, true, false, P1);
    assert.equal(reader.offer(H1, { a: "1" }, true, false, P1), "none");
  });

  test("a dropped board delta is cumulative, exactly as a league's is", () => {
    const reader = new Reader();
    reader.offer(H1, { a: "1" }, true, false, { p1: "1", p2: "1" });
    reader.offer(H2, { a: "1" }, false, false, { p1: "2", p2: "1" });
    reader.offer(H3, { a: "1" }, true, false, { p1: "2", p2: "3" });
    assert.deepEqual(reader.heldPlayers, { p1: "2", p2: "3" });
  });

  test("a row that left during a dropped frame still leaves", () => {
    const reader = new Reader();
    reader.offer(H1, { a: "1" }, true, false, { p1: "1", gone: "1" });
    reader.offer(H2, { a: "1" }, false, false, { p1: "1" });
    reader.offer(H3, { a: "1" }, true, false, { p1: "2" });
    assert.deepEqual(reader.heldPlayers, { p1: "2" });
  });
});
