import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LADDER_TIERS } from "../ladder.ts";
import { FieldEditor } from "./field-editor.tsx";

/**
 * The ladder without a DOM.
 *
 * Three things here are invisible in review and only wrong on screen. **The
 * reserved window track**: a field that takes no window still has to hold the
 * column, or the notches and the share on an age row slide out of the columns
 * every other row keeps them in — and the columns are what makes a ladder
 * readable. **The notch group**: five radios, one checked, and it is the
 * checked one that says what the board weighs. And **the partition** — a field
 * is a row or a chip in the bin, never both and never neither, which
 * `ladder.test.ts` pins over the data and this pins over the markup.
 */

const render = (weights: Record<string, number>) =>
  renderToStaticMarkup(
    createElement(FieldEditor, {
      position: "WR" as const,
      weights,
      windows: { rec_tgt: "prev3" as const },
      customized: true,
      onWeight: () => {},
      onWindow: () => {},
      onReset: () => {},
    }),
  );

/** Every `<li>` of the ladder, as markup — the bin's chips are `<li>` too. */
const rowFor = (html: string, label: string): string | undefined =>
  html.split("<li").find((chunk) => chunk.includes(`>${label}</span>`));

describe("FieldEditor · the ladder", () => {
  test("a windowed field draws a select; a field that takes none reserves its track", () => {
    const html = render({ rec_tgt: 100, age: 60 });

    const targets = rowFor(html, "Targets");
    assert.ok(targets, "targets row");
    assert.ok(targets.includes("<select"), "targets draws its window");

    const age = rowFor(html, "Age");
    assert.ok(age, "age row");
    assert.ok(!age.includes("<select"), "age has no window to draw");
    // The spacer, at the select's own width and only where the row is one line.
    assert.ok(age.includes("w-[8.5rem]"), "age reserves the window track");
    assert.ok(age.includes("@lg:block"), "reserved only where the row is one line");
  });

  test("the notches are five radios with the weight's own one checked", () => {
    const html = render({ rec_tgt: 80 });
    const targets = rowFor(html, "Targets")!;
    const radios = targets.match(/type="radio"/g) ?? [];
    assert.equal(radios.length, LADDER_TIERS);
    // 80 is the fourth notch of five; exactly one is checked, and a group that
    // checked none would render fine and answer no board at all.
    assert.equal((targets.match(/checked=""/g) ?? []).length, 1);
    const notches = targets.split("<label");
    assert.ok(notches[4].includes("checked"), "the fourth notch is the checked one");
  });

  test("a field on the board is not in the bin, and one off it is", () => {
    const html = render({ rec_tgt: 100 });
    assert.ok(html.includes(">Targets</span>"), "targets is a row");
    // Matched to the end of the chip: "+ Targets" is also a prefix of
    // "+ Targets / snap", which is a different field and legitimately in the
    // bin — a loose match here would pass on the wrong row.
    assert.ok(!html.includes("+ Targets</button>"), "targets is not also a chip");
    assert.ok(html.includes("+ Receptions</button>"), "receptions is a chip");
  });

  test("an empty board says so rather than drawing an empty trough", () => {
    const html = render({});
    assert.ok(html.includes("Nothing is being compared"));
    assert.ok(html.includes("+ Targets</button>"), "and every field is addable");
  });
});
