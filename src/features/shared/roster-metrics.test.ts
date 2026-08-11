import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_PLAYER_COLUMNS,
  DEFAULT_WEEK_PLAYER_COLUMNS,
  PLAYER_METRICS,
  PLAYER_METRICS_BY_KEY,
  type PlayerMetricContext,
} from "./roster-metrics.ts";

const ctx = (over: Partial<PlayerMetricContext> = {}): PlayerMetricContext => ({
  outlook: { points: 180.5, weeks: 5 },
  split: {
    starting_points: 120.25,
    bench_points: 60.25,
    starting_weeks: 3,
    bench_weeks: 2,
  },
  horizon: 5,
  ktc: 8200,
  adp: 6400,
  adpPosition: 12.3,
  superflex: true,
  draftCount: 37,
  // A season panel by default — the shape the leagues list and the trades board
  // open on. The week cases below opt in, which is also how they assert that a
  // week metric says "not asked for" rather than "no data" without one.
  week: null,
  weekProjection: null,
  ...over,
});

const cell = (key: string, over: Partial<PlayerMetricContext> = {}) =>
  PLAYER_METRICS_BY_KEY[key].cell(ctx(over));

describe("player metric catalogue", () => {
  test("every default column names a real metric", () => {
    // Both defaults, because they are two selections of different lengths and a
    // key dropped from the catalogue would otherwise only be caught on whichever
    // panel happened to be opened.
    for (const key of [...DEFAULT_PLAYER_COLUMNS, ...DEFAULT_WEEK_PLAYER_COLUMNS]) {
      assert.ok(PLAYER_METRICS_BY_KEY[key], `unknown default column ${key}`);
    }
  });

  test("keys are unique", () => {
    const keys = PLAYER_METRICS.map((m) => m.key);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("projection metrics", () => {
  test("start reads the in-lineup half of the split", () => {
    assert.equal(cell("start").text, "120.25");
  });

  test("bench reads the out-of-lineup half", () => {
    assert.equal(cell("bench").text, "60.25");
  });

  test("proj reads the season total", () => {
    assert.equal(cell("proj").text, "180.50");
  });

  test("a real 0.00 bench is dimmed but printed, not an em dash", () => {
    const c = cell("bench", {
      split: {
        starting_points: 180.5,
        bench_points: 0,
        starting_weeks: 5,
        bench_weeks: 0,
      },
    });
    assert.equal(c.text, "0.00");
    assert.equal(c.muted, true);
  });

  test("a missing projection is an em dash on every projection metric", () => {
    for (const key of ["start", "bench", "proj"]) {
      assert.equal(cell(key, { outlook: undefined }).text, null, key);
    }
  });

  test("the short-horizon marker fires past a bye, not on it", () => {
    // One missing week is every team's bye; two is a hole worth marking.
    assert.equal(cell("start", { outlook: { points: 1, weeks: 4 } }).short, false);
    assert.equal(cell("start", { outlook: { points: 1, weeks: 3 } }).short, true);
    // KTC and ADP are not projection-based, so they never mark short.
    assert.equal(cell("ktc").short, undefined);
  });
});

describe("player-value metrics", () => {
  test("KTC prints the board value", () => {
    assert.equal(cell("ktc").text, "8,200");
  });

  test("ADP prints the curved draft-capital value", () => {
    assert.equal(cell("adp").text, "6,400");
  });

  test("KTC is an em dash when the player is off the board", () => {
    assert.equal(cell("ktc", { ktc: null }).text, null);
  });

  test("ADP is an em dash when the player has no average on the board", () => {
    assert.equal(cell("adp", { adp: null }).text, null);
  });
});

describe("week metrics", () => {
  const week = { week: 5, weekProjection: 18.4 };

  test("week proj reads the week's projection, not a slice of the season", () => {
    const c = cell("week_proj", week);
    assert.equal(c.text, "18.40");
    assert.match(c.title, /week 5/);
  });

  test("a projected zero is printed and dimmed; no projection is an em dash", () => {
    // The distinction the whole catalogue keeps: a real 0.00 is a claim, and a
    // bye or an unsynced week is the absence of one.
    assert.equal(cell("week_proj", { ...week, weekProjection: 0 }).text, "0.00");
    assert.equal(cell("week_proj", { ...week, weekProjection: 0 }).muted, true);
    assert.equal(cell("week_proj", { ...week, weekProjection: null }).text, null);
  });

  test("on a season panel it reads as not asked for, not as no data", () => {
    // The leagues list and the trades board open on a season, so a reader who
    // aims a slot at this gets an em dash and a hover saying why — rather than
    // one implying the league has no projection.
    const c = cell("week_proj");
    assert.equal(c.text, null);
    assert.match(c.title, /opened on a week/);
  });
});
