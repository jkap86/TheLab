import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ordinal } from "./format.ts";

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
