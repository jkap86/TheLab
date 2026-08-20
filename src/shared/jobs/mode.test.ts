import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  backgroundJobsGate,
  backgroundJobsMode,
  webBackgroundJobsAdvice,
} from "./mode.ts";

describe("backgroundJobsMode", () => {
  test("unset is the legacy shape: jobs everywhere", () => {
    // What a single dyno and every developer's machine have always done. This
    // module must not change either.
    assert.equal(backgroundJobsMode({}), "everywhere");
  });

  test("only the exact words off and worker mean anything", () => {
    assert.equal(backgroundJobsMode({ BACKGROUND_JOBS: "off" }), "off");
    assert.equal(backgroundJobsMode({ BACKGROUND_JOBS: "worker" }), "worker");
    for (const value of ["", " ", "on", "web", "0", "false", "workers", "OFFF"]) {
      assert.equal(
        backgroundJobsMode({ BACKGROUND_JOBS: value }),
        "everywhere",
        JSON.stringify(value),
      );
    }
  });

  test("both are read case- and space-insensitively", () => {
    assert.equal(backgroundJobsMode({ BACKGROUND_JOBS: " OFF " }), "off");
    assert.equal(backgroundJobsMode({ BACKGROUND_JOBS: "Worker" }), "worker");
  });
});

describe("backgroundJobsGate", () => {
  test("unset runs jobs in both roles", () => {
    for (const role of ["web", "worker"] as const) {
      assert.equal(backgroundJobsGate(role, {}).enabled, true, role);
    }
  });

  test("off stops jobs in both roles, the worker included", () => {
    // The value that has always meant "stop the syncs" keeps meaning it
    // everywhere: an operator should not have to know how many roles exist.
    const env = { BACKGROUND_JOBS: "off" };
    for (const role of ["web", "worker"] as const) {
      const gate = backgroundJobsGate(role, env);
      assert.equal(gate.enabled, false, role);
      assert.equal(gate.reason, "BACKGROUND_JOBS=off");
    }
  });

  test("worker moves the jobs off the web process and leaves the worker running", () => {
    // The whole point of the value: one variable, set once on the app — Heroku
    // config vars are per-app, not per-dyno — that does not need a second
    // variable to turn the worker back on.
    const env = { BACKGROUND_JOBS: "worker" };
    assert.equal(backgroundJobsGate("web", env).enabled, false);
    assert.match(backgroundJobsGate("web", env).reason ?? "", /worker/);
    assert.equal(backgroundJobsGate("worker", env).enabled, true);
  });

  test("off outranks worker's exemption", () => {
    assert.equal(
      backgroundJobsGate("worker", { BACKGROUND_JOBS: "off" }).enabled,
      false,
    );
  });
});

describe("webBackgroundJobsAdvice", () => {
  test("a production web process on the legacy default is told about the worker", () => {
    const advice = webBackgroundJobsAdvice({ NODE_ENV: "production" });
    assert.ok(advice);
    assert.match(advice, /npm run worker/);
    assert.match(advice, /BACKGROUND_JOBS=worker/);
    // And it must warn against the half-configuration, which is the one that
    // stops every refresh with nothing failing.
    assert.match(advice, /until a worker is running/);
  });

  test("nothing is said once the split is configured", () => {
    for (const value of ["worker", "off"]) {
      assert.equal(
        webBackgroundJobsAdvice({ NODE_ENV: "production", BACKGROUND_JOBS: value }),
        null,
        value,
      );
    }
  });

  test("development says nothing", () => {
    // In-process loops are what you want on a laptop; a line per boot telling
    // you otherwise is a line people learn to skip.
    assert.equal(webBackgroundJobsAdvice({ NODE_ENV: "development" }), null);
    assert.equal(webBackgroundJobsAdvice({}), null);
  });
});
