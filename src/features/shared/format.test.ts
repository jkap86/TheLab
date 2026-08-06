import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  countdownSegments,
  formatCountdown,
  formatPoints,
  formatRecord,
  formatWinPct,
  ordinal,
} from "./format.ts";

/**
 * How a pick's round is spoken about — "a 2026 1st", "their 3rd".
 *
 * Shared by the trades board and the roster panel, so it is written once. The
 * only thing in it worth testing is the teens exception, which is exactly the
 * rule a `n % 10` implementation gets wrong: 11, 12 and 13 take `th` against the
 * `st`/`nd`/`rd` their last digit would otherwise claim, and the exception
 * repeats every hundred rather than applying to the teens alone.
 */

describe("ordinal", () => {
  test("the ordinary endings follow the last digit", () => {
    assert.equal(ordinal(1), "1st");
    assert.equal(ordinal(2), "2nd");
    assert.equal(ordinal(3), "3rd");
    assert.equal(ordinal(4), "4th");
    assert.equal(ordinal(9), "9th");
  });

  test("the teens are the exception, whatever their last digit says", () => {
    assert.equal(ordinal(11), "11th");
    assert.equal(ordinal(12), "12th");
    assert.equal(ordinal(13), "13th");
    assert.equal(ordinal(14), "14th");
  });

  test("past the teens the last digit rules again", () => {
    assert.equal(ordinal(21), "21st");
    assert.equal(ordinal(22), "22nd");
    assert.equal(ordinal(23), "23rd");
    assert.equal(ordinal(25), "25th");
  });

  test("the exception repeats every hundred, not only in the first teens", () => {
    // The boundary a `n < 14` guard would get wrong — and a startup's round
    // count reaches nowhere near here, but a season's pick number does.
    assert.equal(ordinal(111), "111th");
    assert.equal(ordinal(112), "112th");
    assert.equal(ordinal(113), "113th");
    assert.equal(ordinal(101), "101st");
    assert.equal(ordinal(102), "102nd");
    assert.equal(ordinal(103), "103rd");
  });

  test("a round hundred and a zero take th", () => {
    assert.equal(ordinal(100), "100th");
    assert.equal(ordinal(0), "0th");
  });

  test("every round a real draft has is spelled with one of four endings", () => {
    // A pick's round comes off a scraped payload, so the whole plausible range
    // is walked rather than sampled — a gap would be a pick named `"2026 7"`.
    for (let round = 1; round <= 40; round++) {
      assert.match(ordinal(round), /^\d+(st|nd|rd|th)$/, `round ${round}`);
    }
  });
});

describe("formatRecord", () => {
  test("omits ties when there are none", () => {
    assert.equal(formatRecord({ wins: 9, losses: 4, ties: 0 }), "9-4");
  });

  test("includes ties when there are any", () => {
    assert.equal(formatRecord({ wins: 9, losses: 4, ties: 1 }), "9-4-1");
  });

  test("handles an unplayed season", () => {
    assert.equal(formatRecord({ wins: 0, losses: 0, ties: 0 }), "0-0");
  });
});

describe("formatWinPct", () => {
  test("drops the leading zero, as a standings page does", () => {
    assert.equal(formatWinPct(0.537), ".537");
    assert.equal(formatWinPct(0.5), ".500");
    assert.equal(formatWinPct(0), ".000");
  });

  test("keeps the leading digit of a perfect record", () => {
    assert.equal(formatWinPct(1), "1.000");
  });

  test("shows nothing played as an em dash, not as zero", () => {
    assert.equal(formatWinPct(null), "—");
  });
});

describe("formatCountdown", () => {
  test("reads in days with the trailing units padded in place", () => {
    const ms = ((37 * 24 + 4) * 3600 + 12 * 60 + 45) * 1000;
    assert.equal(formatCountdown(ms), "37d 04h 12m 45s");
  });

  test("drops units the countdown has outgrown", () => {
    assert.equal(formatCountdown((4 * 3600 + 9 * 60) * 1000), "4h 09m 00s");
    assert.equal(formatCountdown((12 * 60 + 3) * 1000), "12m 03s");
    assert.equal(formatCountdown(41 * 1000), "41s");
  });

  test("an instant already passed clamps to zero rather than negative", () => {
    assert.equal(formatCountdown(0), "0s");
    assert.equal(formatCountdown(-5000), "0s");
  });

  test("floors a partial second so the last tick reads 0s, not 1s", () => {
    assert.equal(formatCountdown(999), "0s");
  });
});

describe("countdownSegments", () => {
  const digits = (ms: number) =>
    countdownSegments(ms).map((s) => `${s.value}${s.short}`);

  test("gives each unit its own cell, padded after the leading one", () => {
    const ms = ((37 * 24 + 4) * 3600 + 12 * 60 + 45) * 1000;
    assert.deepEqual(digits(ms), ["37d", "04h", "12m", "45s"]);
  });

  test("drops units the countdown has outgrown, so the row narrows", () => {
    assert.deepEqual(digits((4 * 3600 + 9 * 60) * 1000), ["4h", "09m", "00s"]);
    assert.deepEqual(digits((12 * 60 + 3) * 1000), ["12m", "03s"]);
    assert.deepEqual(digits(41 * 1000), ["41s"]);
  });

  test("keeps the seconds cell when everything is zero, rather than none", () => {
    assert.deepEqual(digits(0), ["0s"]);
    assert.deepEqual(digits(-5000), ["0s"]);
  });

  test("carries a spelled unit for the label under each cell", () => {
    assert.deepEqual(
      countdownSegments(90_000).map((s) => s.unit),
      ["min", "sec"],
    );
  });

  test("is the same reading the accessible string gives", () => {
    const ms = ((37 * 24 + 4) * 3600 + 12 * 60 + 45) * 1000;
    assert.equal(digits(ms).join(" "), formatCountdown(ms));
  });
});

describe("formatPoints", () => {
  test("always shows two decimals so columns stay aligned", () => {
    assert.equal(formatPoints(1234.5), "1,234.50");
    assert.equal(formatPoints(0), "0.00");
  });

  test("rounds to two decimals", () => {
    assert.equal(formatPoints(99.999), "100.00");
  });
});
