import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { rangeBounds, type AdpRange } from "../adp-controls.ts";
import type { MonthBar } from "../range-domain.ts";
import { LookbackPanel } from "./lookback-panel.tsx";

/**
 * Which lens each key writes, asserted as document order.
 *
 * The window has two ends and one key for each — `Today` moves the end, the ◆
 * draft key moves the start — and nothing in the types says so: both are the
 * same component taking the same props, and for a while both sat in one cluster
 * at the trailing end of the row, where the pairing was something a reader
 * inferred and the wrap could take away. Seating each under its own lens is a
 * fact about markup order and a `<label>` boundary, which is exactly the
 * category of thing that is invisible in review and only wrong on screen.
 *
 * `renderToStaticMarkup` is enough because none of it is behind an effect: the
 * panel's state is `useState`/`useMemo`, which run on the server, and what is
 * being checked is the shape a reader gets on the first frame.
 */

/** A season with drafts either side of April, so the ◆ key has an anchor. */
const MONTHS: readonly MonthBar[] = [
  { month: "2026-03", drafts: 40 },
  { month: "2026-04", drafts: 120 },
  { month: "2026-05", drafts: 300 },
  { month: "2026-06", drafts: 90 },
];
const TODAY = "2026-08-08";

function panel(range: AdpRange = { preset: "all", from: null, to: null }): string {
  return renderToStaticMarkup(
    createElement(LookbackPanel, {
      range,
      season: "2026",
      bounds: rangeBounds(range, TODAY),
      months: MONTHS,
      live: true,
      error: null,
      loading: false,
      today: TODAY,
      onChange: () => {},
    }),
  );
}

/** Where a string starts, asserted to be present exactly once. */
function at(html: string, needle: string): number {
  const first = html.indexOf(needle);
  assert.notEqual(first, -1, `expected the panel to render ${needle}`);
  assert.equal(html.indexOf(needle, first + 1), -1, `expected one ${needle}`);
  return first;
}

describe("each key is seated under the lens it writes", () => {
  test("the ◆ draft key sits in the days-back column and Today in the ending one", () => {
    // The two units bound the columns, so the keys' positions against them are
    // the whole assertion: `Draft` between them is inside the day lens's
    // column, `Today` after the second is inside the date lens's. Swapped —
    // which is what one cluster of both keys amounts to — a reader is told the
    // key that moves the start belongs to the field naming the end.
    const html = panel();
    const days = at(html, "Days back<");
    const ending = at(html, "Ending<");
    const draft = at(html, ">Draft<");
    const today = at(html, ">Today<");

    assert.ok(days < draft && draft < ending, "the ◆ key is not under the days lens");
    assert.ok(ending < today, "the Today key is not under the ending lens");
  });

  test("the words on the keys name the end each one moves", () => {
    // The seat and the accessible name are two statements of one fact, and only
    // this holds them together: a key re-seated without its name being read is
    // a key whose hover and screen-reader label describe the other lens.
    const html = panel();
    assert.match(html, /aria-label="Start the window at the [^"]*draft[^"]*"/i);
    assert.match(html, /aria-label="End the window today and keep it rolling forward"/);
    // The hover says it too — the keys carry a value, not a sentence.
    assert.match(html, /title="End the window today and keep it rolling forward"/);
  });

  test("no key is inside a label", () => {
    // A label activates its control, so a button nested in one answers a press
    // by focusing the input beside it — on the day lens, putting the caret in a
    // field the key has just written. The seat is a sibling of the `<label>`
    // for that reason, which is a nesting no type notices.
    for (const segment of panel().split("<label").slice(1)) {
      const label = segment.slice(0, segment.indexOf("</label>"));
      assert.ok(!label.includes("<button"), "a key is nested inside a label");
    }
  });

  test("a domain with no draft in it seats no key under the days lens", () => {
    // The ◆ key is drawn only where the strip holds a draft, and an empty seat
    // under one lens would make that column taller than the other for nothing.
    const html = renderToStaticMarkup(
      createElement(LookbackPanel, {
        range: { preset: "all", from: null, to: null } as AdpRange,
        season: "2026",
        bounds: { from: null, to: null },
        months: [{ month: "2026-07", drafts: 12 }],
        live: true,
        error: null,
        loading: false,
        today: TODAY,
        onChange: () => {},
      }),
    );
    assert.ok(!html.includes(">Draft<"), "expected no ◆ key with no draft in the domain");
    assert.ok(html.includes(">Today<"), "the ending lens keeps its key regardless");
  });
});
