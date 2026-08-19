import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_POOL_MAX,
  REQUEST_DEADLINE_MS,
  clampNotice,
  databaseBudget,
  fanoutLimit,
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

/**
 * A configured concurrency is a *request*, and the clamp is what makes it one.
 *
 * The hole this closes: `MANAGER_SYNC_LIMIT=10` against a pool of ten let one
 * manager's sync hold every connection the process has, which is the failure
 * the fan-out share exists to prevent, reached through the variable meant to
 * prevent it and with nothing failing to say so.
 */
test("a requested limit is clamped to the fan-out share", () => {
  const budget = databaseBudget({ DATABASE_POOL_MAX: "10" });
  assert.equal(budget.fanout, 3, "the pool this table is written against");

  // Below the share as readily as above it: an operator asking for *less*
  // concurrency gets it — the clamp is a ceiling, not a target.
  assert.equal(fanoutLimit("2", budget).limit, 2);
  assert.equal(fanoutLimit("3", budget).limit, 3);
  assert.equal(fanoutLimit("4", budget).limit, 3);
  assert.equal(fanoutLimit("100", budget).limit, 3);
  assert.equal(fanoutLimit("10", budget).limit, 3, "never the whole pool");
  // A huge integer is "as much as possible", not a refusal.
  assert.equal(fanoutLimit("1000000", budget).limit, 3);
  assert.equal(fanoutLimit(" 2 ", budget).limit, 2, "surrounding space is trimmed");
});

test("junk, zero, negatives and decimals fall back to the derived default", () => {
  // Every one of these would otherwise be an admission that admits nobody —
  // an outage rather than a bound — and a typo in a dashboard must not be why
  // a manager page or a refresh button stops answering. A decimal is *rejected*
  // rather than rounded: what a fractional permit means is a question with no
  // good answer, and falling back is the one that cannot surprise anybody.
  const budget = databaseBudget({});
  for (const value of [
    undefined,
    "",
    "   ",
    "three",
    "0",
    "-2",
    "-0.5",
    "1.5",
    "2.9",
    "NaN",
    "Infinity",
    "1e",
  ]) {
    const limit = fanoutLimit(value, budget);
    assert.equal(limit.requested, null, `${value} should read as nothing asked`);
    assert.equal(limit.limit, budget.fanout, `${value} should fall back`);
  }
});

test("the limit can never exceed the fan-out share, on any pool", () => {
  // The property, not the table: whatever is configured and whatever the pool
  // is, one of these bounds is at most what a single request may hold.
  for (const poolMax of ["2", "3", "4", "10", "12", "20", "30", "100"]) {
    const budget = databaseBudget({ DATABASE_POOL_MAX: poolMax });
    for (const value of [undefined, "1", "2", "5", "10", "50", "999", "0", "junk"]) {
      const { limit } = fanoutLimit(value, budget);
      assert.ok(limit >= 1, `pool ${poolMax}, ${value}: a bound that admits nobody`);
      assert.ok(
        limit <= budget.fanout,
        `pool ${poolMax}, ${value}: ${limit} is over the fan-out ${budget.fanout}`,
      );
      assert.ok(limit < budget.poolMax, `pool ${poolMax}, ${value}: the whole pool`);
    }
  }
});

test("the derived default is never clamped away", () => {
  // It *is* the reserved share, so an unconfigured process gets exactly
  // `databaseBudget().fanout` on every pool — a ceiling under the number the
  // app picks for itself would be a clamp arguing with its own default.
  for (const poolMax of ["2", "3", "4", "10", "30", "100"]) {
    const budget = databaseBudget({ DATABASE_POOL_MAX: poolMax });
    assert.equal(fanoutLimit(undefined, budget).limit, budget.fanout, poolMax);
  }
});

test("a clamped request says so once, and an honoured one says nothing", () => {
  const budget = databaseBudget({ DATABASE_POOL_MAX: "10" });

  assert.match(
    clampNotice("MANAGER_SYNC_LIMIT", fanoutLimit("20", budget)) ?? "",
    /MANAGER_SYNC_LIMIT=20.*fan-out=3.*using 3/,
  );
  // Nothing to say where nothing was cut: a line on every boot is a line
  // nobody reads, which is how the one that mattered gets missed.
  for (const value of [undefined, "junk", "0", "1", "3"]) {
    assert.equal(clampNotice("LEAGUE_REFRESH_LIMIT", fanoutLimit(value, budget)), null, value);
  }
});
