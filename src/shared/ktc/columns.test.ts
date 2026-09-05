import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isKtcMetric,
  ktcVariantsOf,
  lineupColumnKey,
  parseKtcVariants,
  serializeKtcVariants,
} from "./columns.ts";

/**
 * How a column is named, which is the one thing the client and the server have
 * to agree on letter for letter.
 *
 * Every rule here is silent when it goes wrong. A key spelled two ways is a
 * rank the card cannot find, so the tile reads an em dash over a league that
 * was ranked; a key spelled the *same* two ways for two different pricings is
 * worse — a dynasty superflex figure printed under a 1QB label, with nothing on
 * screen saying so.
 */

const col = (
  metric: Parameters<typeof lineupColumnKey>[0]["metric"],
  format: "auto" | "dynasty" | "redraft" = "auto",
  lineup: "auto" | "oneqb" | "sf" = "auto",
) => ({ metric, format, lineup }) as const;

describe("isKtcMetric", () => {
  test("the four priced metrics, and only those", () => {
    assert.equal(isKtcMetric("ktc_total"), true);
    assert.equal(isKtcMetric("ktc_picks"), true);
    assert.equal(isKtcMetric("ros_starters"), false);
    assert.equal(isKtcMetric("capital_total"), false);
  });
});

describe("lineupColumnKey", () => {
  test("a column on both autos is keyed by its bare metric id", () => {
    // Which is what lets the nine base ranks answer it without the client
    // knowing what the server resolved.
    assert.equal(lineupColumnKey(col("ktc_total")), "ktc_total");
  });

  test("a forced axis takes the whole triple", () => {
    assert.equal(
      lineupColumnKey(col("ktc_total", "dynasty", "sf")),
      "ktc_total:dynasty:sf",
    );
    assert.equal(
      lineupColumnKey(col("ktc_picks", "auto", "oneqb")),
      "ktc_picks:auto:oneqb",
    );
  });

  test("two boards on one metric are two keys", () => {
    assert.notEqual(
      lineupColumnKey(col("ktc_total", "dynasty", "sf")),
      lineupColumnKey(col("ktc_total", "dynasty", "oneqb")),
    );
  });

  test("a metric with no market ignores both axes", () => {
    // A projection is not priced on a board, so a stray axis on one must not
    // become a second, indistinguishable copy of the same column.
    assert.equal(
      lineupColumnKey(col("ros_starters", "dynasty", "sf")),
      "ros_starters",
    );
  });
});

describe("ktcVariantsOf", () => {
  test("drops the auto pricing the base ranks already answer", () => {
    assert.deepEqual(ktcVariantsOf([col("ktc_total"), col("ros_bench")]), []);
  });

  test("dedupes two columns that force the same board", () => {
    assert.deepEqual(
      ktcVariantsOf([
        col("ktc_total", "dynasty", "sf"),
        col("ktc_picks", "dynasty", "sf"),
      ]),
      [{ format: "dynasty", lineup: "sf" }],
    );
  });

  test("a forced axis on a metric with no market is not a variant", () => {
    // Otherwise a stored value carrying a stray board on a ROS column would
    // cost a market read, and a round trip, for a number nothing prices.
    assert.deepEqual(ktcVariantsOf([col("capital_total", "redraft", "sf")]), []);
  });
});

describe("parseKtcVariants", () => {
  test("round-trips what the hook serialized", () => {
    const variants = ktcVariantsOf([
      col("ktc_total", "dynasty", "sf"),
      col("ktc_bench", "redraft", "auto"),
    ]);
    assert.deepEqual(parseKtcVariants(serializeKtcVariants(variants)), variants);
  });

  test("an unreadable half folds to auto rather than failing", () => {
    assert.deepEqual(parseKtcVariants("nonsense:sf"), [
      { format: "auto", lineup: "sf" },
    ]);
  });

  test("a wholly unreadable token is dropped, not kept as auto:auto", () => {
    // `auto:auto` is the base pricing; keeping it would rank the same nine
    // metrics a second time under a second set of keys.
    assert.deepEqual(parseKtcVariants("garbage"), []);
    assert.deepEqual(parseKtcVariants(""), []);
    assert.deepEqual(parseKtcVariants(null), []);
  });
});
