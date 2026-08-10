import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ALL_BACKGROUND_JOBS_VAR,
  BACKGROUND_JOB_VARS,
  type BackgroundJob,
  backgroundJobSwitch,
} from "./background-jobs.ts";

const JOBS = Object.keys(BACKGROUND_JOB_VARS) as BackgroundJob[];

describe("backgroundJobSwitch", () => {
  test("every job runs when nothing is set", () => {
    // The default is what a developer's machine and a single-dyno deployment
    // have always done; this module must not change either.
    for (const job of JOBS) {
      assert.deepEqual(backgroundJobSwitch(job, {}), { enabled: true }, job);
    }
  });

  test("every job has a switch of its own", () => {
    for (const job of JOBS) {
      const env = { [BACKGROUND_JOB_VARS[job]]: "off" };
      assert.equal(backgroundJobSwitch(job, env).enabled, false, job);
      // And it switches only itself.
      for (const other of JOBS.filter((j) => j !== job)) {
        assert.equal(backgroundJobSwitch(other, env).enabled, true, other);
      }
    }
  });

  test("the master switch turns every job off", () => {
    // The web process's whole configuration: one variable, so a job added later
    // is off there without a second edit.
    const env = { [ALL_BACKGROUND_JOBS_VAR]: "off" };
    for (const job of JOBS) {
      assert.equal(backgroundJobSwitch(job, env).enabled, false, job);
    }
  });

  test("the master switch outranks a per-job one that is on", () => {
    const env = { [ALL_BACKGROUND_JOBS_VAR]: "off", LEAGUE_CRAWLER: "on" };
    assert.equal(backgroundJobSwitch("crawler", env).enabled, false);
  });

  test("only the word off turns anything off", () => {
    // Guessing at intent is the wrong default here: a typo that stopped the
    // syncs would leave the database quietly unfilled for hours with nothing
    // failing, where a typo that leaves them running is visible immediately.
    for (const value of ["", " ", "0", "false", "no", "OFFF", "on", "yes"]) {
      assert.equal(
        backgroundJobSwitch("ktc", { KTC_SYNC: value }).enabled,
        true,
        JSON.stringify(value),
      );
    }
  });

  test("off is read case- and space-insensitively", () => {
    for (const value of ["off", "OFF", " Off "]) {
      assert.equal(backgroundJobSwitch("ktc", { KTC_SYNC: value }).enabled, false);
    }
  });

  test("the reason names the variable that did it", () => {
    // A disabled loop logs this, and "which of five variables" is the only
    // question anyone has when they find one unexpectedly quiet.
    assert.equal(
      backgroundJobSwitch("stats", { STATS_SYNC: "off" }).disabledReason,
      "STATS_SYNC=off",
    );
    assert.equal(
      backgroundJobSwitch("stats", { BACKGROUND_JOBS: "off" }).disabledReason,
      "BACKGROUND_JOBS=off",
    );
  });
});
