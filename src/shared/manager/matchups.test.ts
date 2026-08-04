import assert from "node:assert/strict";
import { test } from "node:test";

import { dedupeMatchups } from "./matchups.ts";

const row = (week: number, roster_id: number, points: number) => ({
  week, roster_id, points,
});

test("keeps one row per roster-week, taking the last", () => {
  const rows = [row(2, 1, 88), row(2, 1, 90.5)];
  assert.deepEqual(dedupeMatchups(rows), [row(2, 1, 90.5)]);
});

test("a roster is a different row in every week", () => {
  const rows = [row(1, 1, 101), row(2, 1, 88)];
  assert.deepEqual(dedupeMatchups(rows), rows);
});

test("rosters within a week are not collapsed into each other", () => {
  const rows = [row(1, 1, 101), row(1, 2, 98)];
  assert.deepEqual(dedupeMatchups(rows), rows);
});

test("the key cannot be spelled two ways", () => {
  // `${week}:${roster_id}` is only a valid key because neither part can carry
  // the separator; ids that concatenate the same way must stay distinct rows.
  const rows = [row(1, 12, 10), row(11, 2, 20)];
  assert.equal(dedupeMatchups(rows).length, 2);
});

test("an empty fetch is an empty write", () => {
  assert.deepEqual(dedupeMatchups([]), []);
});
