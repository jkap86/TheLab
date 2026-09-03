import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { msInterval } from "./interval.ts";

/**
 * A TTL as the interval literal a freshness gate binds against
 * `now() - $n::interval`.
 *
 * It is one line, and the line is where a unit mismatch would live: the app
 * holds every TTL in milliseconds and Postgres wants a duration it can parse, so
 * anything that reads the number without the conversion gates a ten-minute cache
 * at ten minutes' worth of *seconds* — a week and a half.
 */

describe("msInterval", () => {
  test("milliseconds become the seconds Postgres will read", () => {
    assert.equal(msInterval(10 * 60 * 1000), "600 seconds");
    assert.equal(msInterval(60 * 60 * 1000), "3600 seconds");
    assert.equal(msInterval(24 * 60 * 60 * 1000), "86400 seconds");
  });

  test("the unit is always spelled, so the literal parses on its own", () => {
    // A bare number is not an interval; the suffix is what makes the bound
    // legal wherever it is bound.
    assert.match(msInterval(1000), /^\d+ seconds$/);
  });

  test("sub-second precision is rounded away rather than emitted", () => {
    // TTLs here are minutes to days, so a fraction would be noise — and a
    // fractional literal is a second thing for Postgres to parse.
    assert.equal(msInterval(1500), "2 seconds");
    assert.equal(msInterval(1499), "1 seconds");
    assert.equal(msInterval(400), "0 seconds");
  });

  test("zero is a real bound, not an absent one", () => {
    // `now() - '0 seconds'` is now, which is what a zero TTL should mean —
    // everything is stale — rather than a literal Postgres would reject.
    assert.equal(msInterval(0), "0 seconds");
  });
});
