import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { narrowedEmptyState } from "./narrowed-empty-state.ts";

describe("narrowedEmptyState", () => {
  test("filters alone name the filters and offer to clear them", () => {
    const state = narrowedEmptyState(true, false, "dynasty");
    assert.equal(state.message, "No leagues match these filters.");
    assert.equal(state.summary, "dynasty");
    assert.equal(state.action, "filters");
    assert.equal(state.label, "Clear filters");
  });

  test("subjects alone name the selection and offer to clear it", () => {
    const state = narrowedEmptyState(false, true, "all leagues");
    assert.equal(state.message, "No leagues match this selection.");
    assert.equal(state.action, "subjects");
    assert.equal(state.label, "Clear selection");
  });

  test("a subject-only narrowing prints no filter summary", () => {
    // The bug this exists for: with nothing filtering, `filterSummary` reads
    // "all leagues", so a page emptied by a player nobody rosters used to say
    // "No leagues match these filters" over the words "all leagues" — two
    // contradictory claims on one plate. The tokens are named in the tray above
    // instead.
    assert.equal(narrowedEmptyState(false, true, "all leagues").summary, null);
  });

  test("both narrowings name both and clear both", () => {
    const state = narrowedEmptyState(true, true, "dynasty · qb+sf ≥ 2");
    assert.equal(
      state.message,
      "No leagues match the current filters and selection.",
    );
    assert.equal(state.summary, "dynasty · qb+sf ≥ 2");
    assert.equal(state.action, "all");
    assert.equal(state.label, "Clear all");
  });

  test("every arm offers exactly the control that undoes what it named", () => {
    // The key a wrong message comes with is one that does nothing, which is the
    // whole failure. Pinned as a table so a reworded arm cannot quietly point
    // at the other control.
    assert.deepEqual(
      (
        [
          [true, false],
          [false, true],
          [true, true],
        ] as const
      ).map(([f, s]) => narrowedEmptyState(f, s, "x").action),
      ["filters", "subjects", "all"],
    );
  });
});
