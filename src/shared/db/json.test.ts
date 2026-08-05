import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { jsonb } from "./json.ts";

/**
 * A value on its way into a `JSONB` column.
 *
 * Sleeper's nested payloads — settings, scoring, metadata, id arrays — are
 * stored whole, and they arrive with fields omitted rather than nulled. So the
 * case worth pinning is the guard: `== null` catches both spellings of absent,
 * while everything falsy that *isn't* absent has to survive, since `0` and
 * `false` are real scoring values.
 */

describe("jsonb", () => {
  test("null and undefined both store as a SQL null", () => {
    // Sleeper omits a field it has no value for, so `undefined` is the common
    // spelling and `null` the one a database round trip hands back.
    assert.equal(jsonb(null), null);
    assert.equal(jsonb(undefined), null);
  });

  test("a falsy value that isn't absent is serialized, not nulled", () => {
    // `rec: 0` is a standard-scoring league, not a missing setting — and the
    // league filters read exactly that difference.
    assert.equal(jsonb(0), "0");
    assert.equal(jsonb(false), "false");
    assert.equal(jsonb(""), '""');
  });

  test("objects and arrays go down whole", () => {
    assert.equal(jsonb({ type: 2, best_ball: 0 }), '{"type":2,"best_ball":0}');
    assert.equal(jsonb(["QB", "RB", "WR", "BN"]), '["QB","RB","WR","BN"]');
  });

  test("an empty collection is stored rather than dropped", () => {
    // A league with no traded picks holds `[]`, which is an answer; nulling it
    // would make "none" indistinguishable from "never synced".
    assert.equal(jsonb([]), "[]");
    assert.equal(jsonb({}), "{}");
  });

  test("a nested payload survives a round trip unchanged", () => {
    const settings = { type: 2, scoring: { rec: 0.5, bonus_rec_te: 0 }, slots: ["QB", "SUPER_FLEX"] };
    assert.deepEqual(JSON.parse(jsonb(settings)!), settings);
  });
});
