import assert from "node:assert/strict";
import { test } from "node:test";

import { collectWithConcurrency } from "./concurrency.ts";

test("results come back in the input's order, not completion order", async () => {
  const results = await collectWithConcurrency([30, 10, 20], 3, async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return ms;
  });
  assert.deepEqual(results, [30, 10, 20]);
});

test("never more than the limit are in flight", async () => {
  let inFlight = 0;
  let peak = 0;
  await collectWithConcurrency([...Array(12).keys()], 3, async (n) => {
    peak = Math.max(peak, ++inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight--;
    return n;
  });
  assert.equal(peak, 3);
});

test("a limit at or below zero still makes progress", async () => {
  // Serialised rather than deadlocked: a budget computed down to nothing is a
  // slow request, never a hung one.
  assert.deepEqual(await collectWithConcurrency([1, 2], 0, async (n) => n * 2), [
    2, 4,
  ]);
});

test("an empty list runs nothing and resolves", async () => {
  assert.deepEqual(
    await collectWithConcurrency([], 4, async () => {
      throw new Error("should not run");
    }),
    [],
  );
});
