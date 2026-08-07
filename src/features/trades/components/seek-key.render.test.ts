import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SeekKey } from "./seek-key.tsx";

/**
 * The pinned seek key, closed.
 *
 * The panel behind it opens on a press and there is no DOM here to press with,
 * so what this pins is the *resting* part — which is the half a reader spends
 * every scroll looking at, and the half that has to say where the board is
 * standing without being opened at all: the plate, the lit block and the label.
 *
 * The panel's own rules are elsewhere on purpose. What a picked date resolves to
 * is `tradeSeekBounds`, pure and tested beside the filters; that a travel
 * scrolls the board back to the top is `TradesHome`'s effect.
 */

const TODAY = "2026-08-07";

function key(value: string | null): string {
  return renderToStaticMarkup(
    createElement(SeekKey, { value, today: TODAY, onChange: () => {} }),
  );
}

describe("the pinned seek key", () => {
  test("at the top of the board it is unlit and wears no plate", () => {
    // No bound is a real state rather than a date: a plate reading "today" would
    // put a bound on screen that the query string deliberately does not carry.
    const rest = key(null);
    assert.ok(!rest.includes("lab-billet-lit"));
    assert.ok(!rest.includes("lab-nameplate"));
    assert.ok(rest.includes("showing the newest trades"));
  });

  test("a travelled board lights the key and stamps its date underneath", () => {
    // The plate is what keeps a pinned icon from lying about where the board is:
    // an icon alone says a control exists, where the plate says the board begins
    // at June 30.
    const travelled = key("2026-06-30");
    assert.ok(travelled.includes("lab-billet-lit"));
    assert.ok(travelled.includes("lab-nameplate"));
    assert.ok(travelled.includes("Jun 30"));
    assert.ok(travelled.includes("trades from Jun 30, 2026 back"));
  });

  test("the plate takes a year only when it is not this one", () => {
    // Two characters at 8.5px are spent only where they say something: a board
    // positioned inside the season being read needs a month and a day, and one
    // positioned in a past season needs to say which.
    assert.ok(!key("2026-06-30").includes("Jun 30 26"));
    assert.ok(key("2024-06-30").includes("Jun 30 24"));
  });

  test("the plate is a sibling of the block, never inside it", () => {
    // `clip-path` clips a whole subtree, so a plate rendered within the notched
    // face would be severed at the exact edge it exists to straddle. The billet
    // closes before the plate opens.
    const travelled = key("2026-06-30");
    const face = travelled.indexOf("lab-billet-face");
    const plate = travelled.indexOf("lab-nameplate");
    assert.ok(face < plate);
    assert.ok(travelled.slice(face, plate).includes("</span></button>"));
  });

  test("the panel is not in the document until it is opened", () => {
    // The date field is the whole of what a press reveals, so it standing in the
    // markup at rest would mean the key opens nothing.
    assert.ok(!key(null).includes('type="date"'));
  });
});
