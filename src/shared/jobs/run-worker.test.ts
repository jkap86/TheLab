import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { runWorker, SHUTDOWN_SIGNALS, type WorkerDeps } from "./run-worker.ts";
import type { BackgroundJobsRun } from "./start.ts";

/**
 * Every dependency is a fake and every signal is a function call: nothing here
 * opens a database, arms a timer or waits for one. `keepAlive` returns a
 * release the assertions read, which is how "the worker holds the process open
 * and lets go on shutdown" is checked without a process to hold open.
 */
type Harness = {
  deps: WorkerDeps;
  signal: (name: string) => void;
  state: {
    migrated: number;
    started: number;
    stopped: number;
    poolClosed: number;
    keptAlive: number;
    released: number;
    logs: string[];
    warnings: string[];
    errors: string[];
  };
};

/**
 * Let the boot path settle. `runWorker` awaits the database check, the
 * migration and the job start before it holds the process open, so a single
 * microtask turn is not enough — and a fixed number of them would be a fact
 * about today's `await`s rather than about the worker.
 */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function jobsRun(started: BackgroundJobsRun["started"], reason?: string) {
  return (state: Harness["state"]): BackgroundJobsRun => ({
    role: "worker",
    enabled: started.length > 0,
    reason,
    started,
    skipped: [],
    alreadyStarted: false,
    stop: () => {
      state.stopped += 1;
    },
  });
}

function harness(
  overrides: {
    databaseConfigured?: () => { ok: boolean; message?: string };
    migrate?: () => Promise<void>;
    startJobs?: (state: Harness["state"]) => Promise<BackgroundJobsRun>;
    closePool?: () => Promise<void>;
    run?: (state: Harness["state"]) => BackgroundJobsRun;
  } = {},
): Harness {
  const state: Harness["state"] = {
    migrated: 0,
    started: 0,
    stopped: 0,
    poolClosed: 0,
    keptAlive: 0,
    released: 0,
    logs: [],
    warnings: [],
    errors: [],
  };

  const handlers = new Map<string, () => void>();
  const makeRun = overrides.run ?? jobsRun(["ktc", "crawler"]);

  const deps: WorkerDeps = {
    env: {},
    databaseConfigured: overrides.databaseConfigured ?? (() => ({ ok: true })),
    migrate:
      overrides.migrate ??
      (async () => {
        state.migrated += 1;
      }),
    startJobs: overrides.startJobs
      ? () => overrides.startJobs!(state)
      : async () => {
          state.started += 1;
          return makeRun(state);
        },
    closePool:
      overrides.closePool ??
      (async () => {
        state.poolClosed += 1;
      }),
    onSignal: (name, handler) => handlers.set(name, handler),
    keepAlive: () => {
      state.keptAlive += 1;
      return () => {
        state.released += 1;
      };
    },
    log: (message) => state.logs.push(message),
    warn: (message) => state.warnings.push(message),
    error: (message) => state.errors.push(message),
  };

  return {
    deps,
    state,
    signal: (name) => {
      const handler = handlers.get(name);
      assert.ok(handler, `no handler registered for ${name}`);
      handler();
    },
  };
}

describe("runWorker — startup", () => {
  test("an unconfigured database is fatal, and nothing starts", async () => {
    // In the web process a missing DATABASE_URL is only fatal in production,
    // because a dev server still renders. A worker has no half-useful state.
    const h = harness({
      databaseConfigured: () => ({ ok: false, message: "DATABASE_URL is not set." }),
    });
    const result = await runWorker(h.deps);

    assert.equal(result.exitCode, 1);
    assert.equal(result.failure, "database");
    assert.equal(h.state.migrated, 0);
    assert.equal(h.state.started, 0);
    assert.equal(h.state.keptAlive, 0, "a failed boot must not hold the process open");
    assert.equal(h.state.errors.length, 1);
  });

  test("a failed migration exits non-zero rather than running against the old schema", async () => {
    const h = harness({
      migrate: async () => {
        throw new Error("relation does not exist");
      },
    });
    const result = await runWorker(h.deps);

    assert.equal(result.exitCode, 1);
    assert.equal(result.failure, "migrations");
    assert.equal(h.state.started, 0);
    assert.equal(h.state.keptAlive, 0);
  });

  test("a scheduler that throws on start exits non-zero", async () => {
    // The failure this is here for: a process the platform reports as healthy
    // that is running no loops at all.
    const h = harness({
      startJobs: async () => {
        throw new Error("boom");
      },
    });
    const result = await runWorker(h.deps);

    assert.equal(result.exitCode, 1);
    assert.equal(result.failure, "start");
    assert.equal(h.state.keptAlive, 0);
  });

  test("migrations run before any job starts", async () => {
    const order: string[] = [];
    const h = harness({
      migrate: async () => {
        order.push("migrate");
      },
      startJobs: async () => {
        order.push("start");
        return jobsRun(["ktc"])(h.state);
      },
    });

    const running = runWorker(h.deps);
    await settle();
    h.signal("SIGTERM");
    await running;

    assert.deepEqual(order, ["migrate", "start"]);
  });

  test("a worker with no jobs warns loudly but stays up", async () => {
    // Reached by configuration — somebody's explicit instruction, often a
    // deliberate incident measure. Exiting would crash-loop the dyno for as
    // long as the setting stood.
    const h = harness({ run: jobsRun([], "BACKGROUND_JOBS=off") });

    const running = runWorker(h.deps);
    await settle();
    assert.equal(h.state.warnings.length, 1);
    assert.match(h.state.warnings[0], /BACKGROUND_JOBS=off/);
    assert.equal(h.state.keptAlive, 1, "still holding the process open");

    h.signal("SIGTERM");
    const result = await running;
    assert.equal(result.exitCode, 0);
  });
});

describe("runWorker — shutdown", () => {
  for (const signal of SHUTDOWN_SIGNALS) {
    test(`${signal} stops the jobs, releases the keep-alive and closes the pool`, async () => {
      const h = harness();
      const running = runWorker(h.deps);
      await settle();

      assert.equal(h.state.keptAlive, 1);
      h.signal(signal);
      const result = await running;

      assert.equal(result.exitCode, 0);
      assert.equal(result.stoppedBy, signal);
      assert.equal(h.state.stopped, 1);
      assert.equal(h.state.released, 1);
      assert.equal(h.state.poolClosed, 1);
    });
  }

  test("a second signal does not re-enter the teardown", async () => {
    // A platform sends SIGTERM then SIGKILL; a second ctrl-C is somebody who
    // thought the first did nothing.
    const h = harness();
    const running = runWorker(h.deps);
    await settle();

    h.signal("SIGTERM");
    h.signal("SIGINT");
    await running;

    assert.equal(h.state.stopped, 1);
    assert.equal(h.state.poolClosed, 1);
    assert.match(h.state.logs.join("\n"), /Already shutting down/);
  });

  test("a pool that will not close cleanly does not change the exit code", async () => {
    // The jobs are stopped by then, which is what shutting down meant.
    const h = harness({
      closePool: async () => {
        throw new Error("connection already destroyed");
      },
    });
    const running = runWorker(h.deps);
    await settle();
    h.signal("SIGTERM");
    const result = await running;

    assert.equal(result.exitCode, 0);
    assert.equal(h.state.stopped, 1);
    assert.equal(h.state.errors.length, 1);
  });

  test("the jobs are stopped before the pool is closed", async () => {
    const order: string[] = [];
    const h = harness({
      run: (state) => ({
        role: "worker",
        enabled: true,
        started: ["ktc"],
        skipped: [],
        alreadyStarted: false,
        stop: () => {
          state.stopped += 1;
          order.push("stop");
        },
      }),
      closePool: async () => {
        order.push("closePool");
      },
    });

    const running = runWorker(h.deps);
    await settle();
    h.signal("SIGTERM");
    await running;

    // The other order is a tick mid-query losing its connection, which is a
    // stack trace describing a clean shutdown.
    assert.deepEqual(order, ["stop", "closePool"]);
  });
});
