import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CompSeasonLine } from "@/shared/contract";

import { UDFA_PICK } from "./criteria.ts";
import { windowTag, windowValue } from "./windows.ts";
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

  test("a fact ignores the window and an undrafted player reads as the UDFA pick", () => {
    assert.equal(windowValue(row, "age", "chigh"), 24);
    assert.equal(windowValue(row, "exp", "avg2"), 3);
    assert.equal(windowValue(row, "draft", "last"), 40);
    const undrafted: CompRow = { facts: { ...facts, draft: null }, history: row.history };
    assert.equal(windowValue(undrafted, "draft", "last"), UDFA_PICK);
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
