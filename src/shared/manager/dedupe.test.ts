import assert from "node:assert/strict";
import { test } from "node:test";

import { dedupeBy } from "./dedupe.ts";

const row = (id: string, value: number) => ({ id, value });

test("keeps one row per key, taking the last", () => {
  const rows = [row("a", 1), row("a", 2)];
  assert.deepEqual(
    dedupeBy(rows, (r) => r.id),
    [row("a", 2)],
  );
});

test("distinct keys are all kept, in first-seen order", () => {
  const rows = [row("b", 1), row("a", 2), row("c", 3)];
  assert.deepEqual(
    dedupeBy(rows, (r) => r.id),
    rows,
  );
});

test("a repeat keeps the position of its first mention", () => {
  // The order is what a draft's picks are read back in before `pick_no` sorts
  // them, so a late duplicate must not move the row to the end.
  const rows = [row("a", 1), row("b", 2), row("a", 3)];
  assert.deepEqual(
    dedupeBy(rows, (r) => r.id),
    [row("a", 3), row("b", 2)],
  );
});

test("an empty fetch is an empty write", () => {
  assert.deepEqual(
    dedupeBy([], (r: { id: string }) => r.id),
    [],
  );
});

test("a composite key cannot be spelled two ways", () => {
  // `${draft_id}:${pick_no}` is only a valid key because neither part can carry
  // the separator; ids that concatenate the same way must stay distinct rows.
  const picks = [
    { draft_id: "1", pick_no: 12 },
    { draft_id: "11", pick_no: 2 },
  ];
  assert.equal(
    dedupeBy(picks, (p) => `${p.draft_id}:${p.pick_no}`).length,
    2,
  );
});

test("the whole payload is deduplicated, not a window of it", () => {
  // bulkInsert chunks at 500 rows and `ON CONFLICT` covers only those seams, so
  // a repeat separated by more than a chunk is exactly the one this must catch.
  const rows = [row("a", 1), ...Array.from({ length: 600 }, (_, i) => row(`k${i}`, i)), row("a", 2)];
  const deduped = dedupeBy(rows, (r) => r.id);
  assert.equal(deduped.length, 601);
  assert.deepEqual(deduped[0], row("a", 2));
});
