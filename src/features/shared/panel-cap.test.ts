import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  FREEZE_TOP_FALLBACK,
  MIN_PARKED,
  PLATE_OVERHANG,
  SHELL_BREATH,
  freezeTopFrom,
  panelFit,
  panelRoom,
  parkedShell,
} from "./panel-cap.ts";

describe("freezeTopFrom — the park offset", () => {
  test("is the rack's underside plus breath plus the plate's overhang", () => {
    // The `md` rack: 62 + 6 + 13. Against the old token's 87, which is what
    // measuring rather than compiling it in was for.
    assert.equal(freezeTopFrom(62), 81);
  });

  test("follows the rack down to its shorter arms", () => {
    assert.equal(freezeTopFrom(52), 71);
    assert.equal(freezeTopFrom(50), 69);
  });

  test("falls back to the token where there is no rack to measure", () => {
    assert.equal(freezeTopFrom(null), FREEZE_TOP_FALLBACK);
    assert.equal(freezeTopFrom(Number.NaN), FREEZE_TOP_FALLBACK);
  });
});

describe("parkedShell — the box the card stands in", () => {
  test("starts at the plate's line, not the card's", () => {
    // The plate hangs above the card's edge and the shell clips, so the shell
    // opens the overhang early and carries it as padding.
    assert.equal(parkedShell(900, 81).top, 81 - PLATE_OVERHANG);
  });

  test("takes the rest of the viewport, less breath", () => {
    assert.equal(parkedShell(900, 81).height, 900 - 68 - SHELL_BREATH);
    assert.equal(parkedShell(1080, 81).height, 996);
  });

  test("never answers a negative height", () => {
    assert.equal(parkedShell(40, 81).height, 0);
  });
});

describe("panelRoom — what is left under the panel's own top edge", () => {
  /** A manager card: ~210px of header plus the panel's 14px margin. */
  const HEADER = 224;

  test("is the shell less the overhang it padded with, less the header", () => {
    const shell = parkedShell(1080, 81);
    assert.equal(panelRoom(shell.height, HEADER), 996 - PLATE_OVERHANG - 224);
  });

  test("shrinks with a taller header, which is the whole point of measuring one", () => {
    const shell = parkedShell(1080, 81);
    assert.ok(panelRoom(shell.height, 428) < panelRoom(shell.height, HEADER));
  });

  test("shrinks with a taller rack, for the same reason", () => {
    const viewport = 900;
    const tall = parkedShell(viewport, freezeTopFrom(62));
    const short = parkedShell(viewport, freezeTopFrom(50));
    assert.ok(panelRoom(tall.height, HEADER) < panelRoom(short.height, HEADER));
  });
});

describe("panelFit — the cap, the floor, and which is which", () => {
  test("takes the room it was given, and spends no floor doing it", () => {
    const fit = panelFit(700);
    assert.deepEqual(fit, { cap: 700, minHeight: 0, floored: false });
  });

  /**
   * **The floor is only a floor where the room is under it.** Spent otherwise
   * it would hold the panel taller than the space it is in, and the collapse
   * would open with a jump before it moved.
   */
  test("leaves the panel free to be shorter than the floor's own figure", () => {
    assert.equal(panelFit(MIN_PARKED + 1).minHeight, 0);
    assert.equal(panelFit(MIN_PARKED).minHeight, 0);
  });

  test("holds the floor where the room is under it, and says the shell scrolls", () => {
    const fit = panelFit(200);
    assert.deepEqual(fit, { cap: MIN_PARKED, minHeight: MIN_PARKED, floored: true });
  });

  /**
   * The one case a league card does not reach and a trade card does: its
   * summary carries both hauls in full, measured 413px, so it is the header
   * that runs the room under the floor on an ordinary laptop rather than the
   * viewport being cramped.
   */
  test("is what a trade card's header reaches on a short viewport", () => {
    const shell = parkedShell(800, 81);
    assert.ok(panelFit(panelRoom(shell.height, 427)).floored);
    assert.ok(!panelFit(panelRoom(shell.height, 224)).floored);
  });

  test("is a pixel count, so it is one", () => {
    assert.equal(panelFit(489.99999999999994).cap, 490);
  });
});
