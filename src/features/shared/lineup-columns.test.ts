import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  column,
  DEFAULT_LINEUP_COLUMNS,
  ktcBoardLabel,
  ktcChoiceLabel,
  LINEUP_METRIC_IDS,
  LINEUP_METRIC_LABELS,
  MAX_LINEUP_COLUMNS,
  normalizeLineupColumns,
} from "./lineup-columns.ts";
import { isKtcMetric } from "../../shared/ktc/columns.ts";

/**
 * The rules a stored column selection is read by, all of which are silent when
 * they go wrong.
 *
 * The hook and the write are not exercised here — they are `local-store`'s, and
 * that file's own contract is what they follow. What is tested is the pure half
 * both ends share: a selection lost on upgrade, a second bay that quietly
 * deletes the first, a fifth column, and a card left with none.
 */

describe("normalizeLineupColumns", () => {
  test("a legacy string[] reads as columns on both autos", () => {
    // The axes did not exist when the value was written, and `auto` is what the
    // page was doing anyway — so nobody's stored selection moves on upgrade.
    assert.deepEqual(normalizeLineupColumns(["ros_starters", "ktc_total"]), [
      column("ros_starters"),
      column("ktc_total"),
    ]);
  });

  test("two KTC columns on two boards both survive", () => {
    // The whole point of the new shape: a reader comparing one roster's
    // superflex worth against its 1QB worth is asking two questions.
    const stored = [
      column("ktc_total", "dynasty", "sf"),
      column("ktc_total", "dynasty", "oneqb"),
    ];
    assert.equal(normalizeLineupColumns(stored).length, 2);
  });

  test("the same board twice is one column", () => {
    assert.deepEqual(
      normalizeLineupColumns([
        column("ktc_total", "dynasty", "sf"),
        column("ktc_total", "dynasty", "sf"),
      ]),
      [column("ktc_total", "dynasty", "sf")],
    );
  });

  test("a metric with no market cannot occupy two bays", () => {
    // `column` forces both axes to auto on those five, so a hand-edited value
    // carrying a board on one folds back onto the column already there.
    assert.deepEqual(
      normalizeLineupColumns([
        column("ros_starters"),
        { metric: "ros_starters", format: "dynasty", lineup: "sf" },
      ]),
      [column("ros_starters")],
    );
  });

  test("caps at the budget", () => {
    assert.equal(
      normalizeLineupColumns(LINEUP_METRIC_IDS).length,
      MAX_LINEUP_COLUMNS,
    );
  });

  test("never empty, and never a garbage column", () => {
    assert.deepEqual(normalizeLineupColumns([]), DEFAULT_LINEUP_COLUMNS);
    assert.deepEqual(normalizeLineupColumns("nope"), DEFAULT_LINEUP_COLUMNS);
    assert.deepEqual(
      normalizeLineupColumns(["ros_starters", "not_a_metric", null, 7]),
      [column("ros_starters")],
    );
  });

  test("orders canonically, and stably where one metric holds two bays", () => {
    const ordered = normalizeLineupColumns([
      column("ktc_total", "redraft", "auto"),
      column("ros_bench"),
      column("ktc_total", "dynasty", "sf"),
    ]);
    assert.deepEqual(
      ordered.map((c) => c.metric),
      ["ros_bench", "ktc_total", "ktc_total"],
    );
    // The two bays on one metric are ordered by their key, which is the same
    // string the card looks each rank up by — so the order cannot invent a
    // third identity.
    assert.deepEqual(
      ordered.slice(1).map((c) => c.format),
      ["dynasty", "redraft"],
    );
  });
});

describe("the labels", () => {
  test("every metric is placed, and only the priced four spend line two", () => {
    // The tile's second line carries the scope, except on the four metrics
    // where the market pair takes it — and `isKtcMetric` is what says which,
    // rather than the emptiness being read as a signal.
    for (const id of LINEUP_METRIC_IDS) {
      const words = LINEUP_METRIC_LABELS[id];
      assert.ok(words.unit.length > 0, id);
      assert.ok(words.column.length > 0, id);
      assert.equal(words.scope === "", isKtcMetric(id), id);
    }
  });

  test("a setting reads as a rule and a reading names a board", () => {
    assert.equal(ktcChoiceLabel(column("ktc_total")), "Auto · Auto");
    assert.equal(
      ktcChoiceLabel(column("ktc_total", "dynasty", "sf")),
      "Dyn · SF",
    );
    assert.equal(ktcBoardLabel("dynasty", true), "Dyn·SF");
    assert.equal(ktcBoardLabel("redraft", false), "Red·1QB");
  });
});
