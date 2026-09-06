import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CompCorpusInfo } from "@/shared/contract";

import {
  corpusNote,
  coverageLabel,
  criterionValue,
  draftLabel,
  scoringLabel,
  signedDelta,
  weightLabel,
} from "./format.ts";

describe("the comps figures", () => {
  test("a delta carries a real minus, a plus, and no sign at zero", () => {
    assert.equal(signedDelta(4.2, 1), "+4.2");
    assert.equal(signedDelta(-1.8, 1), "−1.8");
    assert.equal(signedDelta(0, 1), "0.0");
    assert.equal(signedDelta(-320), "−320");
  });

  test("a draft pick at or past the UDFA mark is the word, and a null is too", () => {
    assert.equal(draftLabel(69), "#69");
    assert.equal(draftLabel(260), "UDFA");
    assert.equal(draftLabel(null), "UDFA");
  });

  test("a chip prints each criterion in its own unit", () => {
    assert.equal(criterionValue("yprr", 2.4), "2.40");
    assert.equal(criterionValue("tgtsh", 27.5), "28%");
    assert.equal(criterionValue("snap", 88), "88%");
    assert.equal(criterionValue("ppg", 17.25), "17.3");
    assert.equal(criterionValue("draft", 177), "#177");
    assert.equal(criterionValue("recyd", 1230), "1,230");
    assert.equal(criterionValue("age", 24), "24");
  });

  test("a weight reads to one decimal with a multiplication sign", () => {
    assert.equal(weightLabel(1.6), "1.6×");
    assert.equal(weightLabel(1), "1.0×");
  });
});

const info = (over: Partial<CompCorpusInfo> = {}): CompCorpusInfo => ({
  source: "stored",
  version: "stored:2026-01-02T00:00:00.000Z:5000:1",
  through_season: 2024,
  meta: null,
  ...over,
});

describe("corpusNote", () => {
  test("names the scoring basis, because nothing else on the page does", () => {
    // Every PPG on a card is on one basis for the whole corpus, and a reader
    // comparing them against a league they play in has no way to know which.
    assert.equal(
      corpusNote(
        info({
          meta: {
            source: "sleeper-season-stats",
            source_version: null,
            scoring: "half_ppr",
            loader_version: "1",
            loaded_at: "2026-01-02T00:00:00.000Z",
            seasons: [2018, 2019],
            max_completed_season: 2024,
            rows: 5000,
            players: 900,
          },
        }),
      ),
      "Stored corpus · through 2024 · half PPR",
    );
  });

  test("a corpus with no metadata row says what it can and no more", () => {
    assert.equal(corpusNote(info()), "Stored corpus · through 2024");
    assert.equal(corpusNote(info({ through_season: null })), "Stored corpus");
  });

  test("the sample and the unavailable states are named outright", () => {
    assert.equal(corpusNote(info({ source: "sample" })), "Sample corpus");
    assert.equal(corpusNote(info({ source: "unavailable" })), "No corpus");
    assert.equal(corpusNote(null), "");
  });
});

describe("scoringLabel", () => {
  test("the three bases as a reader spells them, and an unknown key as itself", () => {
    assert.equal(scoringLabel("half_ppr"), "half PPR");
    assert.equal(scoringLabel("ppr"), "PPR");
    assert.equal(scoringLabel("std"), "standard");
    assert.equal(scoringLabel("tep"), "tep");
  });
});

describe("coverageLabel", () => {
  test("says nothing at full coverage, which is the ordinary case", () => {
    assert.equal(coverageLabel(1), null);
    assert.equal(coverageLabel(1.0000001), null);
  });

  test("below it, the figure, rounded down so a badge never overclaims", () => {
    assert.equal(coverageLabel(0.75), "75% stat coverage");
    assert.equal(coverageLabel(0.829), "82% stat coverage");
    assert.equal(coverageLabel(0.9999), "99% stat coverage");
  });

  test("nothing unprintable reaches a card", () => {
    assert.equal(coverageLabel(NaN), null);
    assert.equal(coverageLabel(Infinity), null);
  });
});
