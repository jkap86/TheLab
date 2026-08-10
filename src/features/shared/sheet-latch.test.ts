import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { closeSheet, latchSheet } from "./sheet-latch.ts";

/**
 * The rail's lazy-sheet latch, out of the render body.
 *
 * It used to be applied *while rendering* —
 * `if (sheet && !mounted.includes(sheet)) setMounted(...)` — which is a
 * render-phase update: opening a browse re-ran the whole rail synchronously
 * before React committed anything, in the same frame as the dialog mounting, two
 * lazy chunks evaluating, and the roster and ADP reads starting. As a fold called
 * from the press handler it is one batched update beside `setSheet`, and the
 * render body is a function of its props again.
 */

describe("latching a browse in", () => {
  test("the first press mounts that kind, and only that kind", () => {
    // The chunk-splitting intent: the players half carries the whole ADP
    // apparatus the leaguemates half has no column for, so a reader who only
    // browses players must never download the other one.
    assert.deepEqual(latchSheet([], "player"), ["player"]);
    assert.deepEqual(latchSheet([], "leaguemate"), ["leaguemate"]);
  });

  test("a second press changes nothing — the same array, not an equal one", () => {
    // Identity is the assertion rather than a detail: this runs from a
    // `setState` updater on every press, and a fresh array would re-render both
    // sheets — including the one that is *not* being opened — each time.
    const mounted: readonly string[] = ["player"];
    assert.equal(latchSheet(mounted, "player"), mounted);
  });

  test("the two kinds latch independently and both stay", () => {
    const one = latchSheet([], "player");
    const both = latchSheet(one, "leaguemate");
    assert.deepEqual(both, ["player", "leaguemate"]);
    // Order is arrival order, and re-latching the first does not disturb it.
    assert.equal(latchSheet(both, "player"), both);
  });
});

describe("closing one", () => {
  test("a sheet clears only itself", () => {
    // A sheet closing is the last thing that happens on the way out of it, so a
    // flat `null` would have one dialog's exit cancel whatever had just been
    // asked for — pressing Leaguemates while the players sheet is going down.
    assert.equal(closeSheet("player", "player"), null);
    assert.equal(closeSheet("leaguemate", "player"), "leaguemate");
    assert.equal(closeSheet(null, "player"), null);
  });

  test("closing never unlatches, so reopening is instant", () => {
    // The other half of why the latch exists: unmounting a dialog inside its own
    // close handler is a component disappearing mid-event, and re-mounting it on
    // the next press waits on a chunk the browser already has.
    const mounted = latchSheet([], "player");
    closeSheet("player", "player");
    assert.deepEqual(mounted, ["player"]);
  });
});
