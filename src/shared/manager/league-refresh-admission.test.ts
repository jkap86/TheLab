import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { databaseBudget } from "../db/budget.ts";
import {
  LEAGUE_REFRESH_LIMIT_VAR,
  leagueRefreshConcurrency,
  leagueRefreshLimit,
} from "./league-refresh-admission.ts";

/**
 * The process-wide bound on reader-driven league refreshes.
 *
 * A refresh is a public write path: the per-league advisory lock is per league,
 * so a hundred different league ids is a hundred locks that never contend, each
 * holding a Postgres session across a Sleeper fan-out. The number below is
 * therefore the only thing between a burst of presses and the role's connection
 * limit — which is why `LEAGUE_REFRESH_LIMIT` is a *request* and not a grant.
 */
describe("leagueRefreshConcurrency", () => {
  test("defaults to the database budget's fan-out share", () => {
    const budget = databaseBudget({});
    assert.equal(leagueRefreshConcurrency({}), budget.fanout);
    assert.equal(leagueRefreshConcurrency({}), 3, "three at the default pool size");
  });

  test("follows the pool size rather than being pinned to three", () => {
    assert.equal(
      leagueRefreshConcurrency({ DATABASE_POOL_MAX: "30" }),
      databaseBudget({ DATABASE_POOL_MAX: "30" }).fanout,
    );
  });

  test("reads a positive integer override", () => {
    assert.equal(leagueRefreshConcurrency({ LEAGUE_REFRESH_LIMIT: " 2 " }), 2);
    assert.equal(leagueRefreshConcurrency({ LEAGUE_REFRESH_LIMIT: "3" }), 3);
  });

  test("the override is a request, not a grant", () => {
    // `LEAGUE_REFRESH_LIMIT=10` on the default pool of ten is not a wider
    // budget, it is no budget: enough presses on distinct leagues take every
    // connection, including the ones the writes underneath them are queued for.
    const fanout = databaseBudget({}).fanout;
    for (const value of ["4", "10", "100", "1000000"]) {
      assert.equal(
        leagueRefreshConcurrency({ LEAGUE_REFRESH_LIMIT: value }),
        fanout,
        value,
      );
    }
    assert.equal(leagueRefreshConcurrency({ LEAGUE_REFRESH_LIMIT: "10" }), 3);
  });

  test("the clamp holds across pool sizes", () => {
    for (const poolMax of ["2", "3", "4", "10", "12", "30", "100"]) {
      const fanout = databaseBudget({ DATABASE_POOL_MAX: poolMax }).fanout;
      for (const value of [undefined, "1", "3", "9", "500"]) {
        const limit = leagueRefreshConcurrency({
          DATABASE_POOL_MAX: poolMax,
          LEAGUE_REFRESH_LIMIT: value,
        });
        assert.ok(limit >= 1, `pool ${poolMax}, ${value}: admits nobody`);
        assert.ok(limit <= fanout, `pool ${poolMax}, ${value}: ${limit} over ${fanout}`);
      }
    }
  });

  test("falls back rather than failing on junk", () => {
    // A typo in a dashboard should not be why the refresh button stops working,
    // and a zero or a negative would be a limiter that admits nobody. A decimal
    // is refused rather than rounded, the same rule the budget keeps.
    const fallback = databaseBudget({}).fanout;
    for (const value of ["", "  ", "lots", "0", "-2", "1.5", "2.9", "NaN", "Infinity"]) {
      assert.equal(
        leagueRefreshConcurrency({ LEAGUE_REFRESH_LIMIT: value }),
        fallback,
        value,
      );
    }
  });

  test("reports what was asked for beside what it granted", () => {
    assert.deepEqual(leagueRefreshLimit({ LEAGUE_REFRESH_LIMIT: "20" }), {
      requested: 20,
      ceiling: 3,
      limit: 3,
    });
    assert.deepEqual(leagueRefreshLimit({}), {
      requested: null,
      ceiling: 3,
      limit: 3,
    });
  });

  test("the knob it reads is the one it is named after", () => {
    // The variable name is shared by the read and the clamp warning, so this is
    // what keeps the message from naming something nobody set.
    assert.equal(
      leagueRefreshConcurrency({ [LEAGUE_REFRESH_LIMIT_VAR]: "1" }),
      1,
    );
  });
});

describe("the two admissions are bounded alike", () => {
  test("neither path can be configured past a single request's share", async () => {
    // Manager sync and league refresh are the same shape of work — an advisory
    // lock's session held across a Sleeper fan-out — and the failure they can
    // cause is the pool, which does not care which of them spent it. So the
    // ceiling is asserted over both together rather than once per module.
    const { managerSyncConcurrency } = await import("./sync-admission.ts");

    for (const poolMax of ["2", "10", "20", "100"]) {
      const { fanout } = databaseBudget({ DATABASE_POOL_MAX: poolMax });
      const env = {
        DATABASE_POOL_MAX: poolMax,
        MANAGER_SYNC_LIMIT: "1000",
        LEAGUE_REFRESH_LIMIT: "1000",
      };
      assert.equal(managerSyncConcurrency(env), fanout, `manager, pool ${poolMax}`);
      assert.equal(leagueRefreshConcurrency(env), fanout, `refresh, pool ${poolMax}`);
    }
  });
});
