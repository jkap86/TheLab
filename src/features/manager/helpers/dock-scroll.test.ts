import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DOCK_AT_REST,
  DOCK_FLOOR_PX,
  DOCK_JITTER_PX,
  dockScroll,
  type DockScroll,
} from "./dock-scroll.ts";

/** A state with a baseline already read, so a delta means something. */
function at(from: number, docked = true): DockScroll {
  return { from, docked };
}

describe("dockScroll", () => {
  test("the first event after a reset sets the baseline and decides nothing", () => {
    // The page's own jumps — `useActiveCard` parking a card and walking back
    // from one — land here, and neither is the reader scrolling.
    const next = dockScroll(DOCK_AT_REST, 4000);
    assert.equal(next.from, 4000);
    assert.equal(next.docked, true);
  });

  test("a reset keeps whatever the dock was doing rather than standing it up", () => {
    assert.equal(dockScroll({ from: null, docked: false }, 900).docked, false);
  });

  test("scrolling down past the threshold sends it away", () => {
    assert.equal(dockScroll(at(900), 900 + DOCK_JITTER_PX).docked, false);
  });

  test("scrolling up brings it back", () => {
    assert.equal(
      dockScroll(at(900, false), 900 - DOCK_JITTER_PX).docked,
      true,
    );
  });

  test("a sub-threshold delta is ignored, baseline included", () => {
    // Not moving the baseline is what lets a slow drift still add up to a
    // decision rather than being filtered away one pixel at a time.
    const prev = at(900);
    const next = dockScroll(prev, 900 + DOCK_JITTER_PX - 1);
    assert.equal(next, prev);
    assert.equal(dockScroll(next, 900 + DOCK_JITTER_PX).docked, false);
  });

  test("a drift accumulates across several sub-threshold events", () => {
    let state = at(900);
    for (let i = 1; i <= 5; i += 1) state = dockScroll(state, 900 + i);
    assert.equal(state.docked, true);
    assert.equal(dockScroll(state, 906).docked, false);
  });

  test("the top of the page stands it up whatever the direction", () => {
    // Scrolling *down* into the floor still docks: a reader at the head of the
    // list has not chosen to send it away.
    assert.equal(dockScroll(at(0, false), DOCK_FLOOR_PX - 1).docked, true);
    assert.equal(dockScroll(at(1000, false), 0).docked, true);
  });

  test("the floor is exclusive — a scroll to it reads as a scroll down", () => {
    assert.equal(dockScroll(at(0), DOCK_FLOOR_PX).docked, false);
  });

  test("an unchanged reading is returned by identity", () => {
    // What lets the caller skip a re-render of a hundred league cards.
    const prev = at(900);
    assert.equal(dockScroll(prev, 900), prev);
  });

  test("the baseline still moves where the reading does not", () => {
    // Two down-scrolls in a row: the second must be measured from the first
    // rather than from where the reader started.
    const first = dockScroll(at(900), 1000);
    assert.equal(first.docked, false);
    assert.equal(first.from, 1000);
    assert.equal(dockScroll(first, 1000 - DOCK_JITTER_PX).docked, true);
  });
});
