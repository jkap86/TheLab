import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  diffLeagues,
  feedSignature,
  KICKOFF_LEAD_MS,
  LIVE_INTERVAL_MS,
  MAX_WAIT_MS,
  pollIntervalMs,
  WAITING_INTERVAL_MS,
} from "./live-rules.ts";

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
