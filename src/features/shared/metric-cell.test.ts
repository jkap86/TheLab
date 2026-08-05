import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { type MetricCell, metricPreview } from "./metric-cell.ts";

/**
 * The compact form a metric takes in the columns editor's slot previews.
 *
 * Three cell shapes read three different ways, and the one rule they share is
 * the app's own: **absent is an em dash, never a zero.** A rank of nothing is a
 * league nobody has drafted, and printing `#0` there would dress an empty league
 * up as a placing.
 */

const rank = (cell: Partial<Extract<MetricCell, { kind: "rank" }>> = {}): MetricCell => ({
  kind: "rank",
  rank: { rank: 3, of: 12 },
  title: "3rd of 12 by projected points",
  ...cell,
});

describe("metricPreview", () => {
  test("a rank previews as its placing alone", () => {
    // The denominator is on the cell itself; the preview has a slot header's
    // width to work in.
    assert.equal(metricPreview(rank()), "#3");
    assert.equal(metricPreview(rank({ rank: { rank: 1, of: 32 } })), "#1");
  });

  test("an unranked league previews as an em dash, not as #0", () => {
    assert.equal(metricPreview(rank({ rank: null })), "—");
  });

  test("a share previews as what is held, not as the fraction", () => {
    // More is more here, and the denominator is the whole list — so the number
    // that distinguishes one row from the next is the numerator.
    assert.equal(metricPreview({ kind: "share", held: 8, of: 121, title: "8 of 121" }), "8");
  });

  test("a share of nothing is a real zero, not an em dash", () => {
    // Held in none of the leagues counted is an answer; the null case that earns
    // a dash elsewhere cannot arise on a count.
    assert.equal(metricPreview({ kind: "share", held: 0, of: 121, title: "0 of 121" }), "0");
  });

  test("a value previews as its text", () => {
    assert.equal(metricPreview({ kind: "value", text: "41,320", title: "KTC" }), "41,320");
  });

  test("an unpriced value is an em dash rather than an empty cell", () => {
    // KTC prices ~500 players, so a kicker is genuinely absent from the board —
    // a blank would read as a missing column instead of a missing price.
    assert.equal(metricPreview({ kind: "value", text: null, title: "KTC" }), "—");
  });

  test("a value that is the string zero is kept, since zero is an answer", () => {
    // The distinction the `?? "—"` has to preserve: null is unpriced, `"0"` is
    // priced at nothing.
    assert.equal(metricPreview({ kind: "value", text: "0", title: "bench" }), "0");
  });
});
