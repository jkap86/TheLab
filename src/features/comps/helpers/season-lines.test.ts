import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CompMatch, CompSubject } from "@/shared/contract";

import { compSeasonRows, payoffRows, seasonLines, subjectReadouts } from "./season-lines.ts";

const line = {
  ppg: 18.4,
  pts: 312.8,
  recyd: 0,
  rec: 0,
  tgtsh: 0,
  rush: 512,
  yprr: null,
  snap: 98,
  gp: 17,
};

const subject = (over: Partial<CompSubject> = {}): CompSubject => ({
  player_id: "qb",
  name: "A Quarterback",
  position: "QB",
  season: 2026,
  last_season: 2025,
  age: 25,
  exp: 2,
  draft: 2,
  line,
  years_on_file: 2,
  ktc: null,
  ...over,
});

const comp = (over: Partial<CompMatch> = {}): CompMatch => ({
  player_id: "c",
  name: "A Comp",
  position: "QB",
  season: 2021,
  age: 24,
  exp: 1,
  draft: null,
  line,
  next: { ppg: 20.1, recyd: 0, rec: 0, gp: 17, finish: "QB4", played: true },
  years_on_file: 1,
  distance: 0.5,
  similarity: 70,
  coverage: 1,
  pairs: {},
  ...over,
});

/**
 * A row under the wrong position renders perfectly and says something untrue:
 * `Rec yd 0` and `Tgt sh 0%` under a quarterback were the page's own lines
 * until this helper took over.
 */
describe("seasonLines", () => {
  test("a quarterback draws no receiving line and does draw his rushing and total points", () => {
    assert.deepEqual(seasonLines("QB"), ["age", "exp", "draft", "ppg", "pts", "rush", "snap", "gp"]);
  });

  test("a receiver draws the receiving lines and no rushing line", () => {
    // Rushing is offered to every position and weighted for two; a
    // receiver's carries are a row spent on nothing.
    assert.deepEqual(seasonLines("WR"), [
      "age", "exp", "draft", "ppg", "recyd", "rec", "tgtsh", "yprr", "snap", "gp",
    ]);
    assert.deepEqual(seasonLines("TE"), seasonLines("WR"));
  });

  test("a running back draws both yardage lines", () => {
    const lines = seasonLines("RB");
    assert.ok(lines.includes("rush"));
    assert.ok(lines.includes("recyd"));
    assert.ok(!lines.includes("pts"));
  });

  test("no position, or one the vocabulary does not know, draws the vocabulary's own lines", () => {
    assert.deepEqual(seasonLines(null), seasonLines("WR"));
    assert.deepEqual(seasonLines("K"), seasonLines("WR"));
  });
});

describe("the three readers", () => {
  test("the subject's readouts follow his position and print his facts", () => {
    const rows = subjectReadouts(subject());
    assert.deepEqual(
      rows.map((r) => [r.label, r.value]),
      [
        ["Age", "25"],
        ["Exp", "2 yr"],
        ["Draft", "#2"],
        ["PPG", "18.4"],
        ["Pts", "312.8"],
        ["Rush yd", "512"],
        ["Snap", "98%"],
        ["GP", "17"],
      ],
    );
  });

  test("an unknown draft slot is an em dash on the readout, and a known UDFA is the word", () => {
    const draft = (d: CompSubject["draft"]) =>
      subjectReadouts(subject({ draft: d })).find((r) => r.id === "draft")!.value;
    assert.equal(draft(null), "—");
    assert.equal(draft("udfa"), "UDFA");
  });

  test("a comp card's season pane draws the position's lines and its payoff pane follows", () => {
    assert.deepEqual(
      compSeasonRows(comp()).map((r) => r.label),
      ["Age", "PPG", "Pts", "Rush yd", "GP"],
    );
    assert.deepEqual(
      payoffRows(comp()).map((r) => [r.label, r.value, r.delta]),
      [
        ["PPG", "20.1", 20.1 - 18.4],
        ["GP", "17", 0],
      ],
    );
    const wr = comp({ position: "WR" });
    assert.deepEqual(
      compSeasonRows(wr).map((r) => r.label),
      ["Age", "PPG", "Rec yd", "Rec", "Tgt sh", "YPRR", "GP"],
    );
    assert.deepEqual(
      payoffRows(wr).map((r) => r.label),
      ["PPG", "Rec yd", "Rec", "GP"],
    );
  });
});
