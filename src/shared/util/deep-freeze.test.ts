import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { deepFreeze } from "./deep-freeze.ts";

describe("deepFreeze", () => {
  test("freezes nested objects and arrays", () => {
    const value = deepFreeze({ rows: [{ adp: 1.2 }], count: 3 });
    assert.throws(() => {
      (value as { count: number }).count = 4;
    }, TypeError);
    assert.throws(() => {
      (value.rows as { adp: number }[])[0].adp = 9;
    }, TypeError);
    assert.throws(() => value.rows.push({ adp: 5 }), TypeError);
  });

  test("terminates on a cycle", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    assert.equal(deepFreeze(a), a);
    assert.ok(Object.isFrozen(a));
  });

  test("passes primitives and null through", () => {
    assert.equal(deepFreeze(null), null);
    assert.equal(deepFreeze(7), 7);
    assert.equal(deepFreeze("x"), "x");
  });
});
