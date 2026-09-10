import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  diffLeagues,
  feedSignature,
  feedsMoved,
  KICKOFF_LEAD_MS,
  LEAGUES_TTL_JITTER_MS,
  LEAGUES_TTL_MS,
  LIVE_INTERVAL_MS,
  MAX_WAIT_MS,
  pollIntervalMs,
  rowsDueAt,
  WAITING_INTERVAL_MS,
} from "./live-rules.ts";
import type { FeedState } from "./live-rules.ts";

const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);

describe("pollIntervalMs", () => {
  test("a running game is the live cadence whatever else is on the board", () => {
    assert.equal(
      pollIntervalMs({ games: { pre: 3, live: 1, final: 2 }, nextKickoff: NOW + 60 * 60_000, now: NOW }),
      LIVE_INTERVAL_MS,
    );
  });

  test("a finished week stops the poller", () => {
    assert.equal(pollIntervalMs({ games: { pre: 0, live: 0, final: 16 }, nextKickoff: null, now: NOW }), null);
  });

  test("an empty board waits rather than stopping", () => {
    assert.equal(
      pollIntervalMs({ games: { pre: 0, live: 0, final: 0 }, nextKickoff: null, now: NOW }),
      WAITING_INTERVAL_MS,
    );
  });

  test("games to come wait for the next kickoff, bounded both ways", () => {
    const soon = NOW + 3 * 60_000;
    assert.equal(
      pollIntervalMs({ games: { pre: 5, live: 0, final: 0 }, nextKickoff: soon, now: NOW }),
      3 * 60_000 - KICKOFF_LEAD_MS,
    );
    const tomorrow = NOW + 24 * 60 * 60_000;
    assert.equal(
      pollIntervalMs({ games: { pre: 5, live: 0, final: 0 }, nextKickoff: tomorrow, now: NOW }),
      MAX_WAIT_MS,
    );
    const thirtySeconds = NOW + 90_000;
    assert.equal(
      pollIntervalMs({ games: { pre: 5, live: 0, final: 0 }, nextKickoff: thirtySeconds, now: NOW }),
      WAITING_INTERVAL_MS,
    );
  });

  test("a kickoff inside the lead, or already past, is the live cadence", () => {
    assert.equal(
      pollIntervalMs({ games: { pre: 1, live: 0, final: 0 }, nextKickoff: NOW + 30_000, now: NOW }),
      LIVE_INTERVAL_MS,
    );
    assert.equal(
      pollIntervalMs({ games: { pre: 1, live: 0, final: 0 }, nextKickoff: NOW - 30_000, now: NOW }),
      LIVE_INTERVAL_MS,
    );
  });

  test("games to come with no known kickoff wait a minute", () => {
    assert.equal(
      pollIntervalMs({ games: { pre: 2, live: 0, final: 3 }, nextKickoff: null, now: NOW }),
      WAITING_INTERVAL_MS,
    );
  });
});

describe("feedSignature", () => {
  test("moves with either feed", () => {
    const a = feedSignature({ stats: "10:5", clocks: "x" });
    assert.equal(a, feedSignature({ stats: "10:5", clocks: "x" }));
    assert.notEqual(a, feedSignature({ stats: "11:5", clocks: "x" }));
    assert.notEqual(a, feedSignature({ stats: "10:5", clocks: "y" }));
  });
});

describe("diffLeagues", () => {
  test("names what moved and what left, and holds the rest for the next tick", () => {
    const held = new Map([
      ["a", JSON.stringify({ live: 1 })],
      ["b", JSON.stringify({ live: 2 })],
      ["gone", JSON.stringify({ live: 3 })],
    ]);
    const next = { a: { live: 1 }, b: { live: 2.5 }, fresh: { live: 4 } };
    const diff = diffLeagues(held, next);
    assert.deepEqual(diff.changed, ["b", "fresh"]);
    assert.deepEqual(diff.removed, ["gone"]);
    assert.deepEqual([...diff.serialised.keys()], ["a", "b", "fresh"]);
    assert.equal(diff.serialised.get("b"), JSON.stringify({ live: 2.5 }));
  });

  test("an empty hold changes everything, and an identical answer changes nothing", () => {
    const next = { a: { live: 1 } };
    const first = diffLeagues(new Map(), next);
    assert.deepEqual(first.changed, ["a"]);
    const second = diffLeagues(first.serialised, next);
    assert.deepEqual(second.changed, []);
    assert.deepEqual(second.removed, []);
  });
});

describe("feedsMoved", () => {
  const board = { projections: true };
  const state = (over: Partial<FeedState> = {}): FeedState => ({
    signature: "sig",
    projections: board,
    statuses: { projections: "ok", stats: "ok", scores: "ok" },
    ...over,
  });

  test("two identical reads are one answer, and nothing is sent", () => {
    assert.equal(feedsMoved(state(), state()), false);
  });

  test("a moved signature is a moved answer", () => {
    assert.equal(feedsMoved(state(), state({ signature: "other" })), true);
  });

  test("a fresh projections board is a moved answer, by identity", () => {
    assert.equal(feedsMoved(state(), state({ projections: { projections: true } })), true);
    // The same object is the same board, whatever it holds.
    assert.equal(feedsMoved(state(), state({ projections: board })), false);
  });

  // The four that were invisible before this function existed: a feed's health
  // is on the wire, and the values behind a health change are — by
  // construction, since the read that failed served the cached ones — the same
  // values as the tick before.
  test("the scoreboard failing counts, even when the cached clocks are identical", () => {
    const ok = state();
    const broken = state({ statuses: { projections: "ok", stats: "ok", scores: "error" } });
    assert.equal(feedsMoved(ok, broken), true);
  });

  test("the scoreboard recovering counts, even when the clocks never moved", () => {
    const broken = state({ statuses: { projections: "ok", stats: "ok", scores: "error" } });
    assert.equal(feedsMoved(broken, state()), true);
  });

  test("the stats feed failing and recovering both count", () => {
    const broken = state({ statuses: { projections: "ok", stats: "error", scores: "ok" } });
    assert.equal(feedsMoved(state(), broken), true);
    assert.equal(feedsMoved(broken, state()), true);
  });

  test("the projections feed's status counts as it always did", () => {
    const broken = state({ statuses: { projections: "error", stats: "ok", scores: "ok" } });
    assert.equal(feedsMoved(state(), broken), true);
    assert.equal(feedsMoved(broken, state()), true);
  });
});

describe("rowsDueAt", () => {
  const NOW = 1_000_000;

  test("never sooner than the interval, never later than the interval plus the jitter", () => {
    assert.equal(rowsDueAt(NOW, 0), NOW + LEAGUES_TTL_MS);
    assert.equal(rowsDueAt(NOW, 1), NOW + LEAGUES_TTL_MS + LEAGUES_TTL_JITTER_MS);
    for (const draw of [0.13, 0.5, 0.87, 0.999]) {
      const at = rowsDueAt(NOW, draw);
      assert.ok(at >= NOW + LEAGUES_TTL_MS);
      assert.ok(at <= NOW + LEAGUES_TTL_MS + LEAGUES_TTL_JITTER_MS);
    }
  });

  test("a kickoff crowd is spread rather than converged", () => {
    // Twenty readers who joined in the same second, drawn evenly: the point of
    // the jitter is that their next re-reads do not land on one tick.
    const due = Array.from({ length: 20 }, (_, i) => rowsDueAt(NOW, i / 19));
    assert.equal(new Set(due).size, 20);
  });

  test("a draw outside the unit interval, or not a number, takes the floor", () => {
    assert.equal(rowsDueAt(NOW, -1), NOW + LEAGUES_TTL_MS);
    assert.equal(rowsDueAt(NOW, 5), NOW + LEAGUES_TTL_MS + LEAGUES_TTL_JITTER_MS);
    assert.equal(rowsDueAt(NOW, Number.NaN), NOW + LEAGUES_TTL_MS);
  });
});
