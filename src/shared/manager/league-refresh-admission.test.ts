import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LEAGUE_REFRESH_LIMIT_VAR,
  leagueRefreshConcurrency,
  leagueRefreshLimit,
} from "./league-refresh-admission.ts";

const env = (value?: string) =>
  value === undefined ? {} : { [LEAGUE_REFRESH_LIMIT_VAR]: value };

describe("leagueRefreshLimit", () => {
  test("nothing configured takes the default", () => {
    const limit = leagueRefreshLimit(env());
    assert.equal(limit.requested, null);
    assert.equal(limit.limit, limit.ceiling);
  });

  test("a smaller request is honoured", () => {
    assert.equal(leagueRefreshLimit(env("1")).limit, 1);
  });

  test("the variable requests a bound and cannot raise one", () => {
    // The whole point of the ceiling: a knob that can be set to the pool size is
    // the failure the bound exists for, reached through the setting meant to
    // prevent it.
    const limit = leagueRefreshLimit(env("50"));
    assert.equal(limit.requested, 50);
    assert.equal(limit.limit, limit.ceiling);
  });

  test("junk falls back rather than failing the boot", () => {
    // A typo in a dashboard should not be why the sync key stops answering.
    for (const bad of ["", "  ", "abc", "0", "-2", "2.5", "NaN"]) {
      const limit = leagueRefreshLimit(env(bad));
      assert.equal(limit.requested, null, bad);
      assert.equal(limit.limit, limit.ceiling, bad);
    }
  });

  test("whitespace around a real number is tolerated", () => {
    assert.equal(leagueRefreshLimit(env(" 2 ")).limit, 2);
  });

  test("the concurrency is the clamped limit, never the request", () => {
    assert.equal(leagueRefreshConcurrency(env("50")), leagueRefreshLimit(env()).ceiling);
    assert.equal(leagueRefreshConcurrency(env("1")), 1);
  });

  test("the bound leaves room in the pool for the work it admits", () => {
    // A press holds a Postgres session (the advisory lock) across the Sleeper
    // fan-out *and* needs connections for the writes. A ceiling at or near the
    // pool size is a deadlock rather than a throughput setting.
    assert.ok(leagueRefreshLimit(env()).ceiling <= 3);
  });
});
