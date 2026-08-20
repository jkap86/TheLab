import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import { BACKGROUND_JOB_VARS, type BackgroundJob } from "../util/background-jobs.ts";
import type { BackgroundLoopHandle } from "../util/background-loop.ts";

import {
  BACKGROUND_JOB_ORDER,
  type BackgroundJobStarters,
  startBackgroundJobs,
  stopBackgroundJobs,
} from "./start.ts";

/**
 * Every starter here is a fake handle: nothing arms a timer, nothing talks to
 * Postgres and nothing waits. What is under test is the *registration* — who
 * asks, how many times, and what comes back — which is exactly the part that a
 * real scheduler interval would make untestable.
 */
type Recorder = {
  starters: BackgroundJobStarters;
  calls: BackgroundJob[];
  stops: BackgroundJob[];
};

function recorder(
  options: { disabled?: BackgroundJob[]; throwOn?: BackgroundJob } = {},
): Recorder {
  const calls: BackgroundJob[] = [];
  const stops: BackgroundJob[] = [];
  const starters = Object.fromEntries(
    BACKGROUND_JOB_ORDER.map((job) => [
      job,
      (): BackgroundLoopHandle => {
        calls.push(job);
        if (options.throwOn === job) throw new Error(`${job} failed to start`);
        const disabled = options.disabled?.includes(job) ?? false;
        return {
          name: job,
          guardKey: job,
          running: !disabled,
          reason: disabled ? `${BACKGROUND_JOB_VARS[job]}=off` : undefined,
          stop: () => stops.push(job),
        };
      },
    ]),
  ) as BackgroundJobStarters;

  return { starters, calls, stops };
}

const console_ = { log: console.log, warn: console.warn };
before(() => {
  console.log = () => {};
  console.warn = () => {};
});
after(() => {
  console.log = console_.log;
  console.warn = console_.warn;
});

afterEach(() => {
  // The run is cached on `globalThis`, which is shared across this file.
  stopBackgroundJobs();
});

describe("startBackgroundJobs", () => {
  test("the worker starts every job, exactly once each", async () => {
    const { starters, calls } = recorder();
    const run = await startBackgroundJobs({ role: "worker", env: {}, starters });

    assert.equal(run.enabled, true);
    assert.deepEqual(calls, BACKGROUND_JOB_ORDER);
    assert.deepEqual(run.started, BACKGROUND_JOB_ORDER);
    assert.deepEqual(run.skipped, []);
  });

  test("the registration list is derived, so a new job cannot be forgotten", () => {
    // The failure this prevents is a job added to one entry point and not the
    // other, which is a sync that silently stops the day the recommended
    // deployment is adopted.
    assert.deepEqual(BACKGROUND_JOB_ORDER, Object.keys(BACKGROUND_JOB_VARS));
  });

  test("a second call registers nothing and says so", async () => {
    const { starters, calls } = recorder();
    const first = await startBackgroundJobs({ role: "worker", env: {}, starters });
    const second = await startBackgroundJobs({ role: "worker", env: {}, starters });

    assert.equal(first.alreadyStarted, false);
    assert.equal(second.alreadyStarted, true);
    assert.deepEqual(calls, BACKGROUND_JOB_ORDER, "no starter is called twice");
  });

  test("BACKGROUND_JOBS=off asks for nothing, in either role", async () => {
    for (const role of ["web", "worker"] as const) {
      const { starters, calls } = recorder();
      const run = await startBackgroundJobs({
        role,
        env: { BACKGROUND_JOBS: "off" },
        starters,
      });

      assert.equal(run.enabled, false, role);
      assert.equal(run.reason, "BACKGROUND_JOBS=off");
      assert.deepEqual(run.started, []);
      assert.deepEqual(calls, [], "a disabled process must not even load them");
      stopBackgroundJobs();
    }
  });

  test("BACKGROUND_JOBS=worker: web asks for nothing, the worker runs the lot", async () => {
    const web = recorder();
    const webRun = await startBackgroundJobs({
      role: "web",
      env: { BACKGROUND_JOBS: "worker" },
      starters: web.starters,
    });
    assert.equal(webRun.enabled, false);
    assert.deepEqual(web.calls, []);
    stopBackgroundJobs();

    // Same variable, same value — this is the one deployment setting, and the
    // dedicated worker is deliberately exempt from it.
    const worker = recorder();
    const workerRun = await startBackgroundJobs({
      role: "worker",
      env: { BACKGROUND_JOBS: "worker" },
      starters: worker.starters,
    });
    assert.equal(workerRun.enabled, true);
    assert.deepEqual(workerRun.started, BACKGROUND_JOB_ORDER);
  });

  test("a per-job switch is still the scheduler's own answer, and is reported", async () => {
    // This layer decides whether the process asks; `backgroundJobSwitch` inside
    // each scheduler decides whether that job runs. A worker that started three
    // of five loops should say which two and why.
    const { starters } = recorder({ disabled: ["crawler", "ktc"] });
    const run = await startBackgroundJobs({
      role: "worker",
      env: { LEAGUE_CRAWLER: "off", KTC_SYNC: "off" },
      starters,
    });

    assert.deepEqual(run.started, ["projections", "stats", "nflDraft"]);
    assert.deepEqual(run.skipped, [
      { job: "ktc", reason: "KTC_SYNC=off" },
      { job: "crawler", reason: "LEAGUE_CRAWLER=off" },
    ]);
  });

  test("stop stops every loop it started, once, and lets a restart happen", async () => {
    const { starters, stops } = recorder();
    const run = await startBackgroundJobs({ role: "worker", env: {}, starters });

    run.stop();
    run.stop();
    assert.deepEqual(
      stops,
      [...BACKGROUND_JOB_ORDER].reverse(),
      "stopped in reverse registration order, and only once",
    );

    const second = recorder();
    const restarted = await startBackgroundJobs({
      role: "worker",
      env: {},
      starters: second.starters,
    });
    assert.equal(restarted.alreadyStarted, false);
    assert.deepEqual(second.calls, BACKGROUND_JOB_ORDER);
  });

  test("a starter that throws is not swallowed", async () => {
    // The worker turns this into a non-zero exit; what must not happen is a
    // process that reports itself healthy having started half its loops.
    const { starters } = recorder({ throwOn: "projections" });
    await assert.rejects(
      startBackgroundJobs({ role: "worker", env: {}, starters }),
      /projections failed to start/,
    );
  });
});
