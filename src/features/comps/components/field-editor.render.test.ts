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

describe("FieldEditor · the last field cannot be removed", () => {
  /** The remove key of a row, which is the `<button` after its label. */
  const removeKey = (html: string, label: string): string => {
    const row = rowFor(html, label);
    assert.ok(row, `${label} row`);
    const key = row.split("<button").at(-1);
    assert.ok(key, `${label} remove key`);
    return key;
  };

  test("a board of several fields removes any of them", () => {
    const html = render({ rec_tgt: 100, rec_yd: 80, age: 60 });
    for (const label of ["Targets", "Receiving yards", "Age"]) {
      const key = removeKey(html, label);
      assert.ok(!key.includes("disabled"), `${label} is removable`);
      assert.ok(key.includes("Remove"), `${label} says so`);
    }
  });

  test("a board of one field draws its remove key dead", () => {
    // An empty board is not a comparison, and the wire has no spelling for one
    // that isn't also "I named no board" — which the server answers with the
    // position's defaults. The editor is the first of the two locks.
    const key = removeKey(render({ rec_tgt: 100 }), "Targets");
    assert.ok(key.includes("disabled"), "the last field's key is disabled");
    assert.ok(
      key.includes("cannot be removed"),
      "and says why rather than only dimming",
    );
  });

  test("removing down to one is what re-arms the rule, not a fixed field", () => {
    // Whichever field is left last is the one that locks — the rule is about
    // the board's length, never about which field it happens to hold.
    const key = removeKey(render({ age: 60 }), "Age");
    assert.ok(key.includes("disabled"));
    assert.ok(!removeKey(render({ age: 60, rec: 40 }), "Age").includes("disabled"));
  });
});
