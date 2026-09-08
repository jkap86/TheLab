import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reuseUnchanged } from "./reuse-unchanged.ts";

type Row = { id: string; name: string; record: { wins: number } | null };

const key = (row: Row) => row.id;
const row = (id: string, name: string, wins: number | null): Row => ({
  id,
  name,
  record: wins === null ? null : { wins },
});

/**
 * Identity is the whole point, so every assertion here is about `===` on
 * objects and arrays rather than about their contents — which are equal by
 * construction and would pass whether or not the sharing worked.
 */
describe("reuseUnchanged", () => {
  it("returns the previous array itself when nothing changed", () => {
    const previous = [row("1", "a", 3), row("2", "b", null)];
    const next = [row("1", "a", 3), row("2", "b", null)];
    assert.equal(reuseUnchanged(previous, next, key), previous);
  });

  it("reuses the previous object for an unchanged item beside a changed one", () => {
    const previous = [row("1", "a", 3), row("2", "b", 1)];
    const next = [row("1", "a", 3), row("2", "b", 2)];
    const merged = reuseUnchanged(previous, next, key);
    assert.notEqual(merged, previous);
    assert.equal(merged[0], previous[0]);
    assert.equal(merged[1], next[1]);
    assert.deepEqual(merged, next);
  });

  it("a reordered list is a new array carrying the old objects", () => {
    // Order is part of what a card list *is* — a memo keyed on the array must
    // recompute — but each card's own object is still the one it had.
    const previous = [row("1", "a", 3), row("2", "b", 1)];
    const next = [row("2", "b", 1), row("1", "a", 3)];
    const merged = reuseUnchanged(previous, next, key);
    assert.notEqual(merged, previous);
    assert.equal(merged[0], previous[1]);
    assert.equal(merged[1], previous[0]);
  });

  it("a longer or shorter list is a new array", () => {
    const previous = [row("1", "a", 3)];
    const grown = reuseUnchanged(previous, [row("1", "a", 3), row("2", "b", 1)], key);
    assert.notEqual(grown, previous);
    assert.equal(grown[0], previous[0]);
    assert.equal(reuseUnchanged(previous, [], key).length, 0);
  });

  it("null and absent are different facts", () => {
    // A record that went from null to `{wins: 0}` is a change, even though a
    // loose equality on the wins figure would call the two the same.
    const previous = [row("1", "a", null)];
    const next = [row("1", "a", 0)];
    assert.equal(reuseUnchanged(previous, next, key)[0], next[0]);
  });

  it("an empty previous list hands back the next one untouched", () => {
    const next = [row("1", "a", 3)];
    assert.equal(reuseUnchanged([], next, key), next);
  });
});
