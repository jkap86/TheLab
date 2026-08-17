import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { databaseBudget } from "../db/budget.ts";
import { compsReadConcurrency } from "./read-admission.ts";

/**
 * The number, and why it is derived rather than typed.
 *
 * The limiter's own semantics — FIFO, the slot released in a `finally`, a
 * waiter handed a slot that is already counted — belong to `createLimiter` and
 * are asserted in `sleeper/limiter.test.ts`. What is this module's own is which
 * bound it takes: a *share of the pool*, so it moves with `DATABASE_POOL_MAX`
 * rather than sitting at a number somebody chose against a pool size that has
 * since changed.
 */

describe("compsReadConcurrency", () => {
  test("is the request fan-out share of the pool", () => {
    // The same derivation `MANAGER_SYNC_LIMIT` takes for the other expensive
    // thing a web process does. A comps request *is* a fan-out — over seasons
    // and datasets rather than leagues — so "how much of the pool may one
    // fan-out hold" is exactly the question being answered.
    const env = { DATABASE_POOL_MAX: "12" };
    assert.equal(compsReadConcurrency(env), databaseBudget(env).fanout);
  });

  test("moves with the pool", () => {
    const small = compsReadConcurrency({ DATABASE_POOL_MAX: "6" });
    const large = compsReadConcurrency({ DATABASE_POOL_MAX: "30" });
    assert.ok(large > small, "a bigger pool should admit more comps reads");
  });

  test("never takes the whole pool, however big it is", () => {
    // The failure this bound exists for: comps reads queueing every other route
    // on the dyno behind them on `pool.connect()`.
    for (const poolMax of ["4", "10", "30", "100"]) {
      const env = { DATABASE_POOL_MAX: poolMax };
      assert.ok(compsReadConcurrency(env) < databaseBudget(env).poolMax);
    }
  });

  test("admits more than one wherever the pool has room for it", () => {
    // The budget's floor of two — so a season's stat lines and its profiles
    // aren't serialised by arithmetic — holds at every real pool size. The one
    // exception is inherited deliberately: on a pool of two, "never the whole
    // pool" wins over the floor, because a comps read holding both connections
    // is the outage this bound exists to prevent.
    assert.ok(compsReadConcurrency({ DATABASE_POOL_MAX: "10" }) >= 2);
    assert.ok(compsReadConcurrency({ DATABASE_POOL_MAX: "6" }) >= 2);
    assert.equal(compsReadConcurrency({ DATABASE_POOL_MAX: "2" }), 1);
  });

  test("COMPS_READ_LIMIT overrides it", () => {
    assert.equal(
      compsReadConcurrency({ DATABASE_POOL_MAX: "10", COMPS_READ_LIMIT: "7" }),
      7,
    );
  });

  test("junk falls back rather than failing the boot", () => {
    // The budget module's own rule: a typo in a dashboard should not be why the
    // comps tool stops answering — and a 0 or a negative would be a limiter
    // that admits nobody.
    const env = { DATABASE_POOL_MAX: "10" };
    for (const value of ["", " ", "nope", "0", "-3", "2.5"]) {
      assert.equal(
        compsReadConcurrency({ ...env, COMPS_READ_LIMIT: value }),
        databaseBudget(env).fanout,
        `COMPS_READ_LIMIT=${value}`,
      );
    }
  });
});
