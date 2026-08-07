import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OPEN_BOX, SCROLL_OFFSET } from "./league-card.tsx";
import { ListLedge } from "./list-ledge.tsx";
import { PINNED_HEIGHT_VAR } from "./pinned-height.ts";

/**
 * The heading rail is the one part of these pages' header that pins, and every
 * fact about that is a class string or a custom property — none of which a type
 * can carry, and each of which fails silently and differently.
 *
 * The manager plate, the season, the record and the filter row used to pin with
 * it as one box. They scroll away now, and what is asserted here is the seam that
 * left behind: where this rail holds, what it paints while it holds there, and
 * that the open league card pinning *under* it is reading the height this rail
 * publishes rather than a number of its own.
 */

/** The rail's own root — the box that pins, or doesn't. */
function root(props: Parameters<typeof ListLedge>[0]): string {
  const html = renderToStaticMarkup(
    createElement(ListLedge, {
      headings: createElement("span", null, "League"),
      ...props,
    }),
  );
  return html.match(/^<div class="([^"]*)"/)?.[1] ?? "";
}

describe("where the rail holds", () => {
  test("it pins at the app bar's height and nothing more", () => {
    // Nothing above it is pinned any more, so this is the whole of the chrome
    // the rail has to clear. A rail that still added a plate's height would
    // hang a rail-shaped gap under the bar.
    const classes = root({ pinned: true });
    assert.match(classes, /(?:^| )sticky(?: |$)/);
    assert.match(classes, /(?:^| )top-\[var\(--site-header-h\)\](?: |$)/);
  });

  test("the open card pins under it by reading the height it publishes", () => {
    // Two files and a custom property between them: this rail measures itself
    // into `PINNED_HEIGHT_VAR`, and the card's `top`, `scroll-mt` and `max-h`
    // are written in terms of it. Renaming one end silently leaves the card
    // pinned under a rail it overlaps by exactly the rail's height.
    for (const offset of [OPEN_BOX, SCROLL_OFFSET]) {
      assert.ok(
        offset.includes(`var(--site-header-h)+var(${PINNED_HEIGHT_VAR})`),
        `the card's offset does not add ${PINNED_HEIGHT_VAR}`,
      );
    }
  });

  test("it sits over the card that pins beneath it", () => {
    // The card is `z-20` and this rail must cover it; the subject rail's search
    // panel hangs *down* over this one at `z-40` and must not be covered by it.
    // A rail outside that window either disappears under a row or paints over
    // the panel a reader is typing into.
    assert.match(root({ pinned: true }), /(?:^| )z-30(?: |$)/);
    assert.match(OPEN_BOX, /(?:^| )z-20(?: |$)/);
  });
});

describe("what a pinned rail paints", () => {
  test("it paints the page's ground across its whole box", () => {
    // The billet is opaque but inset from the cards' own edges, so the fill has
    // to be on the box outside that inset — on the billet's own wrapper it would
    // leave a gutter either side for the rows to scroll through.
    const classes = root({ pinned: true });
    assert.match(classes, /bg-\[var\(--background\)\]/);
    assert.doesNotMatch(classes, /(?:^| )px-/);
  });

  test("the ground fades into the page rather than ending against it", () => {
    // A flat edge of `--background` across the page reads as the ambient glow
    // behind it being clipped.
    assert.match(root({ pinned: true }), /after:bg-gradient-to-b/);
  });

  test("a row pinned flush beneath it takes the fade off", () => {
    // An expanded league card pins against this rail, so the fade would land on
    // that card's own head instead of on the page.
    assert.doesNotMatch(root({ pinned: true, fade: false }), /after:bg-gradient/);
  });
});

test("unpinned, the rail is the part it always was", () => {
  // The shares sheet draws it inside a dialog that scrolls its own list: there
  // is nothing above it to scroll away, and a second writer of the pinned height
  // would point an open league card at a rail on a different surface.
  const classes = root({});
  assert.doesNotMatch(classes, /sticky|top-\[|z-30|bg-\[var\(--background\)\]/);
});
