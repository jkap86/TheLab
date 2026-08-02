import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { decodeTradeCursor, encodeTradeCursor } from "./cursor.ts";

/**
 * A cursor is a value a reader holds across a filter change, a redeploy and a
 * bookmark, so the interesting cases are all the ways one arrives malformed —
 * and the rule that none of them is an error.
 */
describe("trade cursors", () => {
  test("round trips a position", () => {
    const cursor = { at: 1786000000000, transaction_id: "1234567890" };
    assert.deepEqual(decodeTradeCursor(encodeTradeCursor(cursor)), cursor);
  });

  test("the undated tail's zero survives", () => {
    // `coalesce(status_updated, created, 0)` is the sort key, so a trade Sleeper
    // filed with no timestamp resumes at zero — and a cursor that couldn't
    // carry it would end the board one page early.
    const cursor = { at: 0, transaction_id: "t1" };
    assert.deepEqual(decodeTradeCursor(encodeTradeCursor(cursor)), cursor);
  });

  test("the token is url-safe", () => {
    const token = encodeTradeCursor({ at: 1786000000000, transaction_id: "9" });
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.equal(token, encodeURIComponent(token));
  });

  test("an unreadable token is null, never a throw", () => {
    // Null degrades to "start at the beginning"; a throw would show a reader an
    // error page for a stale URL.
    for (const bad of [
      null,
      "",
      "not base64!!",
      encodeTradeCursor({ at: 1, transaction_id: "x" }).slice(0, 3),
      Buffer.from("nocolon").toString("base64url"),
      Buffer.from(":empty-id-side").toString("base64url"),
      Buffer.from("abc:1").toString("base64url"),
      Buffer.from("-5:1").toString("base64url"),
      Buffer.from("1.5:1").toString("base64url"),
      Buffer.from("1234:").toString("base64url"),
    ]) {
      assert.equal(decodeTradeCursor(bad), null, `expected null for ${bad}`);
    }
  });

  test("an id containing the delimiter round trips", () => {
    // Sleeper's ids are digit strings today; splitting on the *first* colon is
    // what keeps that from being an assumption this has to hold to.
    const cursor = { at: 12, transaction_id: "a:b:c" };
    assert.deepEqual(decodeTradeCursor(encodeTradeCursor(cursor)), cursor);
  });
});
