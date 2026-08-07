import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Metric } from "../metric-cell.ts";
import { ColumnsEditor } from "./columns-editor.tsx";

/**
 * The dialog without a DOM — the league card's own test, for the dialog that now
 * serves two tools.
 *
 * What is pinned here is exactly what made one editor able to serve both: **how
 * many slots there are is the caller's**, read off `columns`. The lists wear
 * four, the league detail panel's two tables wear two each, and the difference
 * shows up in a conditional class string and a lookup table — the category of
 * thing that is invisible in review and only wrong on screen. The armed slot is
 * the other half: `openSlot` is which heading was pressed, and a dialog that
 * silently opened on slot 1 would still render, still work, and answer a
 * different press than the one the reader made.
 */

type Ctx = { value: string };

const METRICS: Metric<Ctx>[] = [
  {
    key: "proj",
    group: "Projection",
    label: "Proj",
    cell: ({ value }) => ({ kind: "value", text: value, title: "projected" }),
  },
  {
    key: "bench",
    group: "Projection",
    label: "Bench",
    cell: () => ({ kind: "value", text: "12.00", title: "benched" }),
  },
  {
    key: "ktc",
    group: "Value",
    label: "KTC",
    cell: () => ({ kind: "value", text: "8,200", title: "ktc" }),
  },
  {
    key: "adp",
    group: "Value",
    label: "ADP",
    cell: () => ({ kind: "value", text: "6,400", title: "adp" }),
  },
];

function editor(columns: string[], openSlot: number | null = 0): string {
  return renderToStaticMarkup(
    createElement(ColumnsEditor<Ctx>, {
      metrics: METRICS,
      columns,
      presets: [{ name: "Value", columns: ["ktc", "adp"] }],
      ctx: { value: "1,875.40" },
      previewLabel: "The Lab Dynasty",
      openSlot,
      // Nothing here presses anything — `renderToStaticMarkup` has no DOM to
      // press with — so the handlers are stubs and this is a markup test.
      onClose: () => {},
      onColumnChange: () => {},
      onColumns: () => {},
      onReset: () => {},
    }),
  );
}

describe("the slot row", () => {
  test("a pair of slots stays a pair at every width", () => {
    // Spread across four tracks they would be two wells with half the row empty
    // beside them, which reads as two columns missing rather than as a table
    // that has two.
    const html = editor(["proj", "bench"]);
    assert.match(html, /class="grid gap-2 grid-cols-2"/);
    assert.doesNotMatch(html, /sm:grid-cols-4/);
  });

  test("four slots take a track each from `sm` up", () => {
    assert.match(
      editor(["proj", "bench", "ktc", "adp"]),
      /class="grid gap-2 grid-cols-2 sm:grid-cols-4"/,
    );
  });

  test("one well per column, whatever the count", () => {
    assert.equal(wells(editor(["proj", "bench"])), 2);
    assert.equal(wells(editor(["proj", "bench", "ktc", "adp"])), 4);
  });

  test("a well previews what its column will say, off the caller's subject", () => {
    // The value is the point of the well: a column named "Proj" tells you less
    // than the number it is about to print.
    assert.match(editor(["proj", "bench"]), /1,875\.40/);
  });
});

describe("the header's sentence", () => {
  test("counts the slots the table actually wears, spelled", () => {
    // Read mid-sentence, so it is a word rather than a digit — and it is the
    // caller's count rather than the four this dialog was written for.
    assert.match(editor(["proj", "bench"]), /Every row shows the same two\./);
    assert.match(
      editor(["proj", "bench", "ktc", "adp"]),
      /Every row shows the same four\./,
    );
  });
});

describe("the armed slot", () => {
  test("is the heading that was pressed, not the first column", () => {
    // The whole of what `openSlot` buys: pressing a heading is a press on the
    // column the reader meant, rather than on a dialog they then have to aim.
    const html = editor(["proj", "bench", "ktc", "adp"], 2);
    assert.equal(armed(html), 2);
  });

  test("opens on the first column when that is what was pressed", () => {
    assert.equal(armed(editor(["proj", "bench", "ktc", "adp"], 0)), 0);
  });
});

/**
 * How many slot wells the row drew, counted by their captions — the catalogue
 * rows and the wells both carry `aria-pressed`, so the caption is what tells a
 * slot apart from a metric.
 */
function wells(html: string): number {
  return (html.match(/>Slot \d+/g) ?? []).length;
}

/** Which slot the dialog opened armed on, read off the `· editing` it prints. */
function armed(html: string): number {
  const match = html.match(/Slot (\d+)<span class="ml-1/);
  return match ? Number(match[1]) - 1 : -1;
}
