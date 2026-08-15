import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PREFETCH_DELAY_MS } from "./use-league-prefetch.ts";
import { hasFinePointer } from "./pointer.ts";

/**
 * The two bounds that keep "warm the league a reader is about to open" from
 * becoming a request per card a pointer crosses.
 *
 * The hook itself needs a renderer and a query client, and what it *does* — warm
 * the core entry, and only the core entry — is pinned as a request count in
 * `league-cache.test.ts`. What is left here is the arithmetic and the platform
 * question, both of which are one value each and both of which are the sort of
 * thing a later edit relaxes without noticing: a delay tuned to zero is a
 * network storm on a hundred-league list, and a pointer test that answered true
 * by default would prefetch on every tap and then immediately fetch again.
 */

describe("the debounce", () => {
  test("is long enough to survive a pointer sweeping the list", () => {
    // A pointer crossing a card spends single-digit milliseconds on it. Anything
    // under a few tens of milliseconds is a request per row.
    assert.ok(PREFETCH_DELAY_MS >= 80);
  });

  test("is short enough that a deliberate hover still lands before the press", () => {
    // The saving is the request being in flight by the time the click arrives;
    // a delay near the reaction time it is racing buys nothing.
    assert.ok(PREFETCH_DELAY_MS <= 250);
  });
});

describe("the pointer gate", () => {
  test("a mouse prefetches", () => {
    assert.equal(hasFinePointer(() => ({ matches: true })), true);
  });

  test("a finger does not", () => {
    // `pointerenter` fires on touch too, so without this a tap would prefetch
    // and then immediately fetch — the request twice, on the connection least
    // able to afford it, for a hover that does not exist.
    assert.equal(hasFinePointer(() => ({ matches: false })), false);
  });

  test("unknown does not", () => {
    // A server render, or an engine with no `matchMedia`. The asymmetry is the
    // point: withholding a prefetch costs a reader nothing they can see.
    assert.equal(hasFinePointer(undefined), false);
  });
});
