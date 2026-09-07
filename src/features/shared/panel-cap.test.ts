import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { panelCap } from "./panel-cap.ts";

/** A manager card's measured shape: ~210px of header plus the panel's margin. */
const PARKED = { parked: true, panelOffset: 224, freezeTop: 87 } as const;

describe("panelCap — the parked arm", () => {
  test("is the viewport less the freeze, the header and a little breath", () => {
    // 1080 − 87 − 224 − 16.
    assert.equal(panelCap(1080, PARKED), 753);
  });

  test("takes its floor rather than a height nothing fits in", () => {
    // 600 − 87 − 224 − 16 = 273, which is under the bars a pane stands on.
    assert.equal(panelCap(600, PARKED), 320);
  });

  test("shrinks with a taller header, which is the whole point of measuring one", () => {
    const tall = { parked: true, panelOffset: 320, freezeTop: 87 } as const;
    assert.ok(panelCap(1080, tall) < panelCap(1080, PARKED));
  });
});

describe("panelCap — the un-parked arm", () => {
  const UNPARKED = { parked: false } as const;

  test("takes a share of a short viewport", () => {
    // 700 × 0.7 = 490, against 700 − 120 = 580.
    assert.equal(panelCap(700, UNPARKED), 490);
    assert.equal(panelCap(800, UNPARKED), 560);
    assert.equal(panelCap(900, UNPARKED), 630);
    assert.equal(panelCap(1080, UNPARKED), 756);
  });

  test("leaves a fixed margin on a tall one, where the share would swallow it", () => {
    // 2000 × 0.7 = 1400 against 2000 − 120 = 1880: the smaller wins.
    assert.equal(panelCap(2000, UNPARKED), 1400);
  });

  test("takes its own floor on a viewport too short for either", () => {
    assert.equal(panelCap(400, UNPARKED), 460);
  });

  /**
   * The reason this arm exists at all: a trade card's header is roughly twice a
   * manager card's, and running it through the parked arm subtracts a freeze it
   * never takes on top of a header it does not hold on screen. At an 800px
   * viewport that is the floor — a panel with no room for a list.
   */
  test("is not the parked arm's answer for a trade card's header", () => {
    const asParked = { parked: true, panelOffset: 428, freezeTop: 87 } as const;
    assert.equal(panelCap(800, asParked), 320);
    assert.ok(panelCap(800, UNPARKED) > panelCap(800, asParked));
  });

  test("ignores a header entirely — there is none frozen to subtract", () => {
    assert.equal(panelCap(900, UNPARKED), panelCap(900, { parked: false }));
  });
});
