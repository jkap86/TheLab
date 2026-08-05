import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_POOL_MAX,
  REQUEST_DEADLINE_MS,
  databaseBudget,
} from "./budget.ts";

test("every wait is shorter than the deadline it is a share of", () => {
  const budget = databaseBudget({});

  assert.ok(budget.connectionMs < REQUEST_DEADLINE_MS);
  assert.ok(budget.statementMs < REQUEST_DEADLINE_MS);
  assert.ok(budget.lockWaitMs < REQUEST_DEADLINE_MS);
});

test("the waits are ordered connect < lock wait < statement", () => {
  // The ordering is what keeps `lock_timeout` the bound that cuts a contended
  // acquisition: were the statement timeout the shorter of the two, a waiting
  // caller would be cancelled as a failed query rather than reported as a
  // caller that lost the lock, which is a different answer.
  const budget = databaseBudget({});

  assert.ok(budget.connectionMs < budget.lockWaitMs);
  assert.ok(budget.lockWaitMs < budget.statementMs);
});

test("a shorter deadline tightens every wait with it", () => {
  const tight = databaseBudget({ REQUEST_DEADLINE_MS: "6000" });

  assert.equal(tight.connectionMs, 1000);
  assert.equal(tight.lockWaitMs, 3000);
  assert.equal(tight.statementMs, 4000);
});

test("the fan-out is a share of the pool and never the whole of it", () => {
  // The lower bound is two — a route reading two things at once shouldn't be
  // serialised by arithmetic — except where the pool is too small to grant it,
  // which the "never the whole pool" clamp settles rather than the floor.
  assert.equal(databaseBudget({ DATABASE_POOL_MAX: "2" }).fanout, 1);
  assert.equal(databaseBudget({ DATABASE_POOL_MAX: "3" }).fanout, 2);
  assert.equal(databaseBudget({ DATABASE_POOL_MAX: "10" }).fanout, 3);
  assert.equal(databaseBudget({ DATABASE_POOL_MAX: "12" }).fanout, 4);

  for (const poolMax of [2, 3, 5, 10, 12, 40]) {
    const budget = databaseBudget({ DATABASE_POOL_MAX: String(poolMax) });
    assert.ok(budget.fanout >= 1, `fanout ${budget.fanout} for pool ${poolMax}`);
    assert.ok(budget.fanout < poolMax, `fanout ${budget.fanout} of ${poolMax}`);
  }
});

test("junk and non-positive settings fall back rather than failing the boot", () => {
  for (const value of ["", "  ", "abc", "0", "-4", "10.5", undefined]) {
    const budget = databaseBudget({
      DATABASE_POOL_MAX: value,
      REQUEST_DEADLINE_MS: value,
    });
    assert.equal(budget.poolMax, DEFAULT_POOL_MAX, `pool max for ${value}`);
    assert.equal(
      budget.statementMs,
      databaseBudget({}).statementMs,
      `statement for ${value}`,
    );
  }
});

test("a pool of one is raised to the two a concurrent read needs", () => {
  // Not a knob anyone should reach for, but a `DATABASE_POOL_MAX=1` would
  // deadlock a route that reads two things at once behind a lock that holds a
  // connection of its own.
  assert.equal(databaseBudget({ DATABASE_POOL_MAX: "1" }).poolMax, 2);
});
