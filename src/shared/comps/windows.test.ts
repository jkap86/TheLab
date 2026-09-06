import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CompSeasonLine } from "@/shared/contract";

import { UDFA_PICK } from "./criteria.ts";
import { observationTag, windowReading, windowTag, windowValue } from "./windows.ts";
import type { CompRow } from "./windows.ts";

const line = (over: Partial<CompSeasonLine>): CompSeasonLine => ({
  ppg: 10,
  pts: 160,
  recyd: 800,
  rec: 60,
  tgtsh: 20,
  rush: 0,
  yprr: 1.8,
  snap: 80,
  gp: 16,
  ...over,
});

const facts = { age: 24, exp: 3, draft: 40 };

/**
 * The windowing is the easiest thing on the page to get quietly wrong: a
 * career figure that read the following season would score a comp on the
 * answer, and a rookie's missing prior season averaged in as zero would drag
 * every aggregate down with nothing on screen saying so.
 */
describe("windowValue", () => {
  const row: CompRow = {
    facts,
    // Newest first: the row's own season, then the two before it.
    history: [line({ ppg: 15 }), line({ ppg: 11 }), line({ ppg: 19 })],
  };

  test("`last` is the row's own season", () => {
    assert.equal(windowValue(row, "ppg", "last"), 15);
  });

  test("`avg2` is the row's season and the one before it", () => {
    assert.equal(windowValue(row, "ppg", "avg2"), 13);
  });

  test("the career windows read every season on file, and nothing after", () => {
    assert.equal(windowValue(row, "ppg", "cavg"), 15);
    assert.equal(windowValue(row, "ppg", "chigh"), 19);
  });

  test("a player with one season on file answers that season under every window", () => {
    const rookie: CompRow = { facts, history: [line({ ppg: 12 })] };
    assert.equal(windowValue(rookie, "ppg", "last"), 12);
    assert.equal(windowValue(rookie, "ppg", "avg2"), 12);
    assert.equal(windowValue(rookie, "ppg", "cavg"), 12);
    assert.equal(windowValue(rookie, "ppg", "chigh"), 12);
  });

  test("a null season is skipped inside an aggregate, and answers null where the window is all null", () => {
    const patchy: CompRow = {
      facts,
      history: [line({ tgtsh: null }), line({ tgtsh: 22 }), line({ tgtsh: 26 })],
    };
    assert.equal(windowValue(patchy, "tgtsh", "last"), null);
    assert.equal(windowValue(patchy, "tgtsh", "avg2"), 22);
    assert.equal(windowValue(patchy, "tgtsh", "cavg"), 24);
    assert.equal(windowValue(patchy, "tgtsh", "chigh"), 26);
    const blank: CompRow = { facts, history: [line({ yprr: null })] };
    assert.equal(windowValue(blank, "yprr", "cavg"), null);
  });

  test("a fact ignores the window and a known UDFA reads as the UDFA pick", () => {
    assert.equal(windowValue(row, "age", "chigh"), 24);
    assert.equal(windowValue(row, "exp", "avg2"), 3);
    assert.equal(windowValue(row, "draft", "last"), 40);
    const undrafted: CompRow = { facts: { ...facts, draft: "udfa" }, history: row.history };
    assert.equal(windowValue(undrafted, "draft", "last"), UDFA_PICK);
  });

  test("an unknown draft slot is null, never the UDFA pick", () => {
    // A slot no source could supply is an absence, and folding it into
    // "undrafted" is how every player in a corpus once read as a UDFA. Null
    // costs the pair, the way a null target share does.
    const unknown: CompRow = { facts: { ...facts, draft: null }, history: row.history };
    assert.equal(windowValue(unknown, "draft", "last"), null);
    assert.deepEqual(windowReading(unknown, "draft", "last"), { value: null, used: 0, of: 1 });
  });
});

describe("windowTag", () => {
  test("a windowless criterion says nothing", () => {
    assert.equal(windowTag(false, "last", 5, "last yr"), "");
  });

  test("a rookie row says why its window collapsed", () => {
    assert.equal(windowTag(true, "avg2", 1, "2 yr"), "1 yr");
    assert.equal(windowTag(true, "chigh", 1, "best"), "1 yr");
    // `last` never collapsed, so it keeps its own tag.
    assert.equal(windowTag(true, "last", 1, "last yr"), "last yr");
  });

  test("otherwise the window's own tag", () => {
    assert.equal(windowTag(true, "cavg", 4, "career"), "career");
  });
});

/**
 * How much of its window a reading actually had.
 *
 * A two-year average over a season with target share and a season without is
 * **one** observation, and presented as a two-year average it is a number a
 * reader trusts twice as much as they should. Nothing about the value gives
 * that away — it is a plausible figure either way — so the counts are what
 * carry it, into the chip's tag and into weighted comparison coverage.
 */
describe("windowReading", () => {
  const three: CompRow = {
    facts,
    history: [line({ ppg: 15 }), line({ ppg: 11 }), line({ ppg: 19 })],
  };

  test("a complete two-year window is two of two", () => {
    assert.deepEqual(windowReading(three, "ppg", "avg2"), { value: 13, used: 2, of: 2 });
  });

  test("a two-year window with one null season is one of two, and says so", () => {
    const partial: CompRow = {
      facts,
      history: [line({ tgtsh: 28 }), line({ tgtsh: null }), line({ tgtsh: 22 })],
    };
    const reading = windowReading(partial, "tgtsh", "avg2");
    assert.deepEqual(reading, { value: 28, used: 1, of: 2 });
    // The value is the one season's own figure — never that figure halved,
    // which is what averaging a null as a zero would produce.
    assert.equal(reading.value, 28);
  });

  test("a window with no values at all is a null with nothing used", () => {
    const blank: CompRow = { facts, history: [line({ yprr: null }), line({ yprr: null })] };
    assert.deepEqual(windowReading(blank, "yprr", "avg2"), { value: null, used: 0, of: 2 });
    assert.deepEqual(windowReading(blank, "yprr", "cavg"), { value: null, used: 0, of: 2 });
  });

  test("a player with one season on file asked for two seasons asked for one", () => {
    // The window collapsed because the series is one long, not because a
    // season was missing — so it is complete, `1 of 1`, and the chip says
    // `1 yr` rather than `1 of 2 yr`.
    const rookie: CompRow = { facts, history: [line({ ppg: 12 })] };
    assert.deepEqual(windowReading(rookie, "ppg", "avg2"), { value: 12, used: 1, of: 1 });
    assert.deepEqual(windowReading(rookie, "ppg", "cavg"), { value: 12, used: 1, of: 1 });
  });

  test("a three-year window with two usable seasons is two of three", () => {
    const patchy: CompRow = {
      facts,
      history: [line({ snap: 90 }), line({ snap: null }), line({ snap: 70 })],
    };
    assert.deepEqual(windowReading(patchy, "snap", "cavg"), { value: 80, used: 2, of: 3 });
    assert.deepEqual(windowReading(patchy, "snap", "chigh"), { value: 90, used: 2, of: 3 });
  });

  test("a fact reads one season by definition", () => {
    assert.deepEqual(windowReading(three, "age", "cavg"), { value: 24, used: 1, of: 1 });
    assert.deepEqual(windowReading(three, "draft", "avg2"), { value: 40, used: 1, of: 1 });
  });

  test("`windowValue` is the same reading's value", () => {
    for (const window of ["last", "avg2", "cavg", "chigh"] as const) {
      assert.equal(windowValue(three, "ppg", window), windowReading(three, "ppg", window).value);
    }
  });
});

describe("observationTag", () => {
  const tag = "2 yr";

  test("a complete window wears its own tag", () => {
    assert.equal(observationTag(true, "avg2", { used: 2, of: 2 }, tag), tag);
    assert.equal(observationTag(true, "cavg", { used: 4, of: 4 }, "career"), "career");
  });

  test("a partial window says how much of it answered", () => {
    assert.equal(observationTag(true, "avg2", { used: 1, of: 2 }, tag), "1 of 2 yr");
    assert.equal(observationTag(true, "cavg", { used: 2, of: 5 }, "career"), "2 of 5 yr");
  });

  test("a collapsed window is `1 yr`, because nothing was missing", () => {
    assert.equal(observationTag(true, "avg2", { used: 1, of: 1 }, tag), "1 yr");
    assert.equal(observationTag(true, "chigh", { used: 1, of: 1 }, "best"), "1 yr");
    // `last` never collapsed, so it keeps its own tag.
    assert.equal(observationTag(true, "last", { used: 1, of: 1 }, "last yr"), "last yr");
  });

  test("an unreadable pair and a windowless criterion say nothing", () => {
    assert.equal(observationTag(true, "avg2", { used: null, of: 2 }, tag), "");
    assert.equal(observationTag(true, "avg2", { used: 0, of: 2 }, tag), "");
    assert.equal(observationTag(false, "last", { used: 1, of: 1 }, "last yr"), "");
  });
});
