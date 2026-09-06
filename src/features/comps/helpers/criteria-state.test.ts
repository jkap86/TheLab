import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  activeCount,
  activePairs,
  defaultCriteria,
  setWeight,
  toggleCriterion,
  toggleWindow,
  visibleCriteria,
  windowKeyDisabled,
} from "./criteria-state.ts";

const find = (list: ReturnType<typeof defaultCriteria>, id: string) =>
  list.find((c) => c.id === id)!;

describe("the criteria state", () => {
  test("opens on the handoff's defaults: seven on, PPG on two windows", () => {
    const list = defaultCriteria();
    assert.equal(activeCount(list), 7);
    assert.deepEqual(find(list, "ppg").wins, [
      { id: "last", w: 1.6 },
      { id: "chigh", w: 0.8 },
    ]);
    // A fresh copy each time, so one page's edits cannot leak into another's.
    assert.notEqual(defaultCriteria()[0].wins, defaultCriteria()[0].wins);
  });

  test("toggling a criterion flips `on` and nothing else", () => {
    const list = toggleCriterion(defaultCriteria(), "pts");
    assert.equal(find(list, "pts").on, true);
    assert.deepEqual(find(list, "pts").wins, [{ id: "last", w: 1 }]);
    assert.equal(activeCount(list), 8);
  });

  test("an arriving window takes weight 1 and lands in canonical order", () => {
    // YPRR opens on `avg2` alone; adding `last` must put it *before* avg2,
    // and adding `chigh` after.
    let list = toggleWindow(defaultCriteria(), "yprr", "last");
    assert.deepEqual(find(list, "yprr").wins, [
      { id: "last", w: 1 },
      { id: "avg2", w: 1 },
    ]);
    list = toggleWindow(list, "yprr", "chigh");
    assert.deepEqual(
      find(list, "yprr").wins.map((w) => w.id),
      ["last", "avg2", "chigh"],
    );
  });

  test("removing a window keeps the others' weights, and the last cannot go", () => {
    let list = toggleWindow(defaultCriteria(), "ppg", "last");
    assert.deepEqual(find(list, "ppg").wins, [{ id: "chigh", w: 0.8 }]);
    list = toggleWindow(list, "ppg", "chigh");
    assert.deepEqual(find(list, "ppg").wins, [{ id: "chigh", w: 0.8 }]);
  });

  test("a weight lands on the pair named and no other", () => {
    const list = setWeight(defaultCriteria(), "ppg", "chigh", 2.4);
    assert.deepEqual(find(list, "ppg").wins, [
      { id: "last", w: 1.6 },
      { id: "chigh", w: 2.4 },
    ]);
  });

  test("the active pairs are every window of every criterion that is on, in panel order", () => {
    const pairs = activePairs(defaultCriteria());
    assert.deepEqual(
      pairs.map((p) => `${p.criterion}:${p.window}@${p.weight}`),
      [
        "age:last@1.4",
        "draft:last@0.6",
        "ppg:last@1.6",
        "ppg:chigh@0.8",
        "recyd:last@1",
        "tgtsh:last@1",
        "yprr:avg2@1",
        "exp:last@0.8",
      ],
    );
  });

  test("a window key is disabled on a switched-off criterion and on the last window standing", () => {
    const list = defaultCriteria();
    assert.equal(windowKeyDisabled(find(list, "pts"), "last"), true);
    assert.equal(windowKeyDisabled(find(list, "pts"), "avg2"), true);
    assert.equal(windowKeyDisabled(find(list, "yprr"), "avg2"), true);
    assert.equal(windowKeyDisabled(find(list, "yprr"), "last"), false);
    assert.equal(windowKeyDisabled(find(list, "ppg"), "last"), false);
    assert.equal(windowKeyDisabled(find(list, "ppg"), "chigh"), false);
  });
});

/**
 * The panel and the request must agree about which criteria exist for a
 * position. A criterion hidden from the panel and still in the request would
 * be a board partly ranked on something with nothing on screen naming it.
 */
describe("the position filter", () => {
  test("opens on the position's own preset", () => {
    const rb = defaultCriteria("RB");
    assert.equal(rb.find((c) => c.id === "rush")!.on, true);
    const wr = defaultCriteria("WR");
    assert.equal(wr.find((c) => c.id === "rush")!.on, false);
  });

  test("hides the criteria a position has no answer for", () => {
    const shown = visibleCriteria(defaultCriteria("QB"), "QB").map((c) => c.id);
    for (const hidden of ["recyd", "tgtsh", "yprr"]) {
      assert.ok(!shown.includes(hidden as never), hidden);
    }
    assert.ok(shown.includes("rush"));
  });

  test("a hidden criterion cannot reach the request, however the state got that way", () => {
    // A reader who leaves target share on for a receiver and then picks a
    // quarterback must not be handed a board partly ranked on target share.
    const carried = toggleCriterion(defaultCriteria("WR"), "tgtsh");
    const stillOn = toggleCriterion(carried, "tgtsh");
    assert.equal(stillOn.find((c) => c.id === "tgtsh")!.on, true);

    const pairs = activePairs(stillOn, "QB").map((p) => p.criterion);
    assert.ok(!pairs.includes("tgtsh"), "the request carries a hidden criterion");
    assert.ok(!visibleCriteria(stillOn, "QB").some((c) => c.id === "tgtsh"));
    // The count on the panel's header counts what the panel shows, so it and
    // the pairs behind it cannot disagree either.
    assert.equal(
      activeCount(stillOn, "QB"),
      new Set(pairs).size,
    );
  });

  test("with no position nothing is hidden, which is the state before a subject is picked", () => {
    const list = defaultCriteria();
    assert.equal(visibleCriteria(list, null).length, list.length);
    assert.equal(activeCount(list, null), activeCount(list));
  });

  test("an unknown position hides nothing rather than emptying the panel", () => {
    const list = defaultCriteria();
    assert.equal(visibleCriteria(list, "K").length, list.length);
  });
});
