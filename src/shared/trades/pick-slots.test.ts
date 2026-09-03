import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { draftOrderKey, pickSlotKey } from "./pick-slots.ts";

/**
 * The keys a page's resolved draft slots are stored under.
 *
 * Both ends read this module — the route writes the map and the client
 * deep-imports the same function to look a pick up in it — so a key that
 * disagreed by a separator would leave every pick unnamed with nothing to
 * report. The separator itself is load-bearing twice over: it cannot appear
 * inside either half (Sleeper's ids are digit strings, its seasons four-digit
 * years), which is what lets the query split these back apart with `split_part`.
 */

describe("pickSlotKey", () => {
  test("all three parts are in the key, in order", () => {
    assert.equal(pickSlotKey("123", "2026", 5), "123|2026|5");
  });

  test("none of the three is redundant", () => {
    // One league's 2026 order says nothing about another's, a league's 2026 and
    // 2027 orders are different orders, and which roster's slot it is *is* the
    // lookup — so changing any one part has to change the key.
    const base = pickSlotKey("123", "2026", 5);
    assert.notEqual(base, pickSlotKey("124", "2026", 5));
    assert.notEqual(base, pickSlotKey("123", "2027", 5));
    assert.notEqual(base, pickSlotKey("123", "2026", 6));
  });

  test("the same pick keys the same however many trades name it", () => {
    assert.equal(pickSlotKey("123", "2026", 5), pickSlotKey("123", "2026", 5));
  });

  test("no two distinct picks collide across the separator", () => {
    // The trap a separator invites: `12|32026|5` against `123|2026|5`. Safe only
    // because neither half can carry a `|`, which is what makes the boundary
    // unambiguous — asserted rather than assumed.
    assert.notEqual(pickSlotKey("12", "32026", 5), pickSlotKey("123", "2026", 5));
    assert.notEqual(pickSlotKey("123", "20265", 1), pickSlotKey("123", "2026", 51));
  });

  test("a roster id is written as digits, whichever way it arrived", () => {
    // Sleeper has been seen to send roster ids as numbers and as strings; the
    // key takes a number, so the spelling is settled here.
    assert.equal(pickSlotKey("123", "2026", 10), "123|2026|10");
  });
});

describe("draftOrderKey", () => {
  test("is the league and season a whole order is cached under", () => {
    assert.equal(draftOrderKey("123", "2026"), "123|2026");
  });

  test("is the prefix of every slot key in that draft", () => {
    // One query and one cache entry per draft, however many of its rosters a
    // page names — so the two keys have to agree about where the draft ends.
    const order = draftOrderKey("123", "2026");
    for (const roster of [1, 7, 12]) {
      assert.ok(pickSlotKey("123", "2026", roster).startsWith(`${order}|`));
    }
  });

  test("two drafts of one league are two orders", () => {
    assert.notEqual(draftOrderKey("123", "2026"), draftOrderKey("123", "2027"));
    assert.notEqual(draftOrderKey("123", "2026"), draftOrderKey("124", "2026"));
  });
});
