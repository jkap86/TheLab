import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { NO_TRADE_STAMP, parseTradeDataStamp } from "./trade-freshness.ts";

/**
 * The stamp's own fold.
 *
 * The hook around it needs a renderer and a `localStorage`, and neither is what
 * could go wrong here: the value ends up **on a request line**, and it is read
 * out of `localStorage`, which anything on the origin can write. So what is
 * pinned is that nothing but a plausible clock reading survives the read, and
 * that everything else lands on the safe fold — "never synced", which costs a
 * reader the refresh they asked for where an unvalidated stamp would put
 * arbitrary text in a URL.
 */
describe("parseTradeDataStamp", () => {
  test("a clock reading is kept as it stands", () => {
    assert.equal(parseTradeDataStamp("1788000000000"), "1788000000000");
    assert.equal(parseTradeDataStamp("0"), "0");
  });

  test("nothing stored is nothing sent", () => {
    // The ordinary case, and the one that keeps both routes' cache headers
    // doing their job for a reader who has never synced on this device.
    assert.equal(parseTradeDataStamp(null), NO_TRADE_STAMP);
    assert.equal(parseTradeDataStamp(undefined), NO_TRADE_STAMP);
    assert.equal(parseTradeDataStamp(""), NO_TRADE_STAMP);
    assert.equal(NO_TRADE_STAMP, "");
  });

  test("anything that is not digits reads as never synced", () => {
    for (const value of [
      "abc",
      "17 88",
      "1788000000000&leagues=x",
      "../../etc",
      "-1",
      "1.5",
      "١٧٨٨",
      // Longer than any millisecond clock will be for the life of this app, and
      // the shape a padded value would take if something tried to make one.
      "12345678901234567",
    ]) {
      assert.equal(
        parseTradeDataStamp(value),
        NO_TRADE_STAMP,
        `"${value}" should not reach a request line`,
      );
    }
  });

  test("a non-string is not coerced", () => {
    // `readLocal` is typed to a string or null, but the store is shared and the
    // fold is what makes that a guarantee rather than an assumption.
    assert.equal(parseTradeDataStamp(17 as unknown as string), NO_TRADE_STAMP);
  });
});
