import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SEATS } from "../../shared/ui/league-filters-seat.tsx";
import { SearchKey } from "./search-key.tsx";

/**
 * The key that stands in for the whole search while it is shut.
 *
 * That is what makes it worth a test of its own: everything the bays say is off
 * screen most of the time, so the two things this part carries — that there *is*
 * a selection, and how much of one — are the only account of it a reader gets
 * without pressing anything. Both are strings and a conditional, which is
 * exactly the category that survives a refactor silently.
 *
 * What the press *does* is `TradesHome`'s state and is not testable without a
 * DOM; what the badge counts is `sideSelectionCount`, pure and tested beside the
 * filters.
 */

function key(over: { expanded?: boolean; active?: number } = {}): string {
  return renderToStaticMarkup(
    createElement(SearchKey, {
      expanded: over.expanded ?? false,
      active: over.active ?? 0,
      controls: "bays",
      onToggle: () => {},
    }),
  );
}

describe("the search key", () => {
  test("a glyph-only key still says what it is", () => {
    // The word is spent on the narrowing line beside it (see the component's
    // note), so the only account of this key a screen reader or a hover gets is
    // what it carries in words itself.
    assert.ok(key().includes("<svg"));
    assert.ok(key().includes('aria-label="Search trades"'));
    assert.ok(key().includes('title="Search trades"'));
  });

  test("it reports whether the bays are open", () => {
    assert.ok(key({ expanded: false }).includes('aria-expanded="false"'));
    assert.ok(key({ expanded: true }).includes('aria-expanded="true"'));
  });

  test("a selection lights the key and states its size", () => {
    // The one signal this part carries: the bays are shut, so without it a
    // narrowed board has nothing on the rail saying the search is doing
    // anything. `.lab-chip-on` is the app's own accent for "narrowing".
    const narrowed = key({ active: 3 });
    assert.ok(narrowed.includes("lab-chip-on"));
    assert.ok(narrowed.includes(">3<"));
  });

  test("an empty search is unlit and unbadged, open or shut", () => {
    // Expanded-but-empty must not read as narrowed: what a reader can see is
    // not a filter, and the accent here means exactly one thing.
    for (const expanded of [false, true]) {
      const rest = key({ expanded, active: 0 });
      assert.ok(!rest.includes("lab-chip-on"), String(expanded));
      assert.ok(rest.includes("lab-chip "), String(expanded));
    }
  });

  test("it stands at the league filters key's height, with its own inset", () => {
    // The two sit on one milled face, and a key a step apart in type or height
    // reads as a mistake before it reads as a hierarchy — so everything
    // deciding how tall it stands is read from the seat rather than respelled.
    // What it does not take is that seat's word-side padding, which is lopsided
    // around a key holding nothing but a centred glyph.
    const markup = key();
    for (const cls of SEATS.free.key.split(" ")) {
      const asymmetric = cls.startsWith("pl-") || cls.startsWith("pr-");
      assert.equal(markup.includes(` ${cls}`), !asymmetric, cls);
    }
  });
});
