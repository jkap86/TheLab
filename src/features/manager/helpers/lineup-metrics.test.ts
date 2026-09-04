import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  formatRank,
  placeAmong,
  rankColor,
  rankFill,
  rankPercentile,
} from "./lineup-metrics.ts";

describe("formatRank", () => {
  test("a rank reads as ordinal of field size", () => {
    assert.equal(formatRank({ rank: 2, of: 12 }), "2nd of 12");
  });

  test("null is the em dash, for absent and degenerate alike", () => {
    assert.equal(formatRank(null), "—");
  });
});

describe("rankFill", () => {
  test("the ends of the scale are actually reached", () => {
    // The whole reason the divisor is `of - 1`: on `rank / of` these would be
    // 92% and 8%, and a bar that never fills or empties reads as broken.
    assert.equal(rankFill({ rank: 1, of: 12 }), 100);
    assert.equal(rankFill({ rank: 12, of: 12 }), 0);
  });

  test("the middle sits where the position does", () => {
    assert.equal(rankFill({ rank: 6, of: 11 }), 50);
  });

  test("nothing to show draws empty", () => {
    assert.equal(rankFill(null), 0);
    // One roster has no spread; dividing by `of - 1` would be a division by
    // zero rather than a full bar.
    assert.equal(rankFill({ rank: 1, of: 1 }), 0);
  });
});

describe("rankPercentile", () => {
  test("a real position is the meter's own number", () => {
    // Same value the bar is drawn from: the two must never disagree.
    assert.equal(rankPercentile({ rank: 1, of: 12 }), 100);
    assert.equal(rankPercentile({ rank: 12, of: 12 }), 0);
  });

  test("nothing to rank is null, where the meter says 0", () => {
    // The whole reason this is not just `rankFill`. Both of these come back
    // as 0 from the meter and are right to draw empty; neither is last place,
    // and the ramp would paint them full red.
    assert.equal(rankPercentile(null), null);
    assert.equal(rankPercentile({ rank: 1, of: 1 }), null);
  });
});

describe("rankColor", () => {
  /** The `t` multiplier out of a generated `oklch()` string. */
  function chroma(color: string): number {
    const match = /calc\(var\(--rank-c\) \* ([\d.]+)\)/.exec(color);
    assert.ok(match, `no chroma term in ${color}`);
    return Number(match[1]);
  }

  test("mid-pack spends no colour, and the ends spend all of it", () => {
    assert.equal(chroma(rankColor(50)), 0);
    assert.equal(chroma(rankColor(100)), 1);
    assert.equal(chroma(rankColor(0)), 1);
  });

  test("the hue only picks the side", () => {
    assert.match(rankColor(100), /150\)$/);
    assert.match(rankColor(0), /25\)$/);
  });

  test("an absent rank is the neutral, not last place", () => {
    // `rankPercentile` answers null for both degenerate cases, and this is
    // what that null has to mean: no chroma, so the tile says nothing rather
    // than claiming a bad result.
    assert.equal(chroma(rankColor(null)), 0);
  });

  test("the ramp reads its ends from tokens, so it inverts with the theme", () => {
    assert.match(rankColor(100), /var\(--rank-l-mid\)/);
    assert.match(rankColor(100), /var\(--rank-l\)/);
  });

  test("alpha is opt-in, for the meter's glow", () => {
    assert.doesNotMatch(rankColor(100), / \/ /);
    assert.match(rankColor(100, 0.55), / \/ 0\.55\)$/);
  });
});

describe("placeAmong", () => {
  test("a figure takes its place in the field", () => {
    assert.deepEqual(placeAmong(30, [50, 30, 10]), { rank: 2, of: 3 });
  });

  test("ties share the better rank and the next distinct one skips", () => {
    // Standard competition ranking, the same rule the server's own ranks read.
    assert.deepEqual(placeAmong(30, [30, 30, 10]), { rank: 1, of: 3 });
    assert.deepEqual(placeAmong(10, [30, 30, 10]), { rank: 3, of: 3 });
  });

  test("nothing to rank comes back null rather than first", () => {
    // A field of one has no spread, and a field of zeroes — no projections
    // read, an unreadable board — has no result to report. "1st of 12" among
    // all-zero totals is a claim.
    assert.equal(placeAmong(9, [9]), null);
    assert.equal(placeAmong(0, [0, 0, 0]), null);
  });
});
