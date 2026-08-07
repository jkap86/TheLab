import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { OverallRecord } from "../../record";
import type {
  HeaderProgress,
  HeaderSyncSummary,
} from "./manager-header.types.ts";
import {
  hasSyncState,
  recordBarParts,
  refreshingSuffix,
  resolveKickoff,
} from "./manager-header.utils.ts";

const record = (over: Partial<OverallRecord> = {}): OverallRecord => ({
  wins: 9,
  losses: 4,
  ties: 1,
  games: 14,
  leagues: 12,
  pct: 0.6785714285714286,
  ...over,
});

const summary = (
  over: Partial<NonNullable<HeaderSyncSummary>> = {},
): HeaderSyncSummary =>
  ({ failed: 0, locked: false, ...over }) as HeaderSyncSummary;

const progress = (over: Partial<HeaderProgress> = {}): HeaderProgress =>
  ({ type: "progress", phase: "refresh", loaded: 4, total: 12, failed: 0, ...over }) as HeaderProgress;

describe("the state line only appears when it has something to say", () => {
  const quiet = { refreshing: false, summary: summary(), refreshError: null };

  test("nothing transient draws nothing", () => {
    assert.equal(hasSyncState(quiet), false);
    assert.equal(
      hasSyncState({ refreshing: false, summary: undefined, refreshError: null }),
      false,
    );
    // Undefined is the prop's own default, not a third state.
    assert.equal(
      hasSyncState({ refreshing: false, summary: summary(), refreshError: undefined }),
      false,
    );
  });

  test("each of the three states opens it on its own", () => {
    assert.equal(hasSyncState({ ...quiet, refreshing: true }), true);
    assert.equal(hasSyncState({ ...quiet, summary: summary({ failed: 1 }) }), true);
    assert.equal(hasSyncState({ ...quiet, refreshError: "boom" }), true);
  });

  // The two skips mean opposite things — one leaves a complete graph, the other
  // leaves whatever the lock's winner has committed so far — so a locked summary
  // has to open the line even with nothing failed.
  test("a locked sync opens it though nothing failed", () => {
    assert.equal(hasSyncState({ ...quiet, summary: summary({ locked: true }) }), true);
  });
});

describe("the refreshing pill's digits", () => {
  test("a refresh with a total counts leagues", () => {
    assert.equal(refreshingSuffix(progress()), " 4/12");
  });

  // A cold sync is the page's loading state, not a pill over cached rows, and a
  // total of zero has no fraction to write.
  test("anything else is an ellipsis", () => {
    assert.equal(refreshingSuffix(null), "…");
    assert.equal(refreshingSuffix(progress({ phase: "initial" })), "…");
    assert.equal(refreshingSuffix(progress({ total: 0 })), "…");
  });
});

describe("the record bar's bands", () => {
  test("one band per non-zero count, in outcome order", () => {
    assert.deepEqual(
      recordBarParts(record()).map((part) => [part.key, part.count]),
      [
        ["w", 9],
        ["l", 4],
        ["t", 1],
      ],
    );
  });

  // Most leagues never tie, and a band of zero would still take its own gap.
  test("a zero count takes no band", () => {
    assert.deepEqual(
      recordBarParts(record({ ties: 0 })).map((part) => part.key),
      ["w", "l"],
    );
    assert.deepEqual(recordBarParts(record({ wins: 0, losses: 0, ties: 0 })), []);
  });

  test("every band carries a tone of its own", () => {
    const tones = recordBarParts(record()).map((part) => part.tone);
    assert.equal(new Set(tones).size, tones.length);
  });
});

describe("which instant the readout counts to", () => {
  const provisional = 1_757_000_000_000;
  const scheduled = 1_757_500_000_000;

  // Three-valued on purpose: the countdown renders nothing until the fetch
  // settles, so "still asking" must not fall through to the provisional date.
  test("in flight is nothing to count", () => {
    assert.equal(resolveKickoff(undefined, provisional), null);
  });

  test("Sleeper's answer wins where there is one", () => {
    assert.equal(resolveKickoff(scheduled, provisional), scheduled);
  });

  // Null is Sleeper saying the season isn't scheduled yet — the one case the
  // NFL calendar table's provisional date is for.
  test("an unscheduled season falls back to the calendar", () => {
    assert.equal(resolveKickoff(null, provisional), provisional);
    assert.equal(resolveKickoff(null, null), null);
  });
});
