import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  backgroundJobsSkipReason,
  PROCESS_ROLE_VAR,
  processRole,
  runsBackgroundJobs,
} from "./process-role.ts";

/**
 * Which process runs the background loops.
 *
 * **Both ways of getting this wrong are silent.** A web dyno that starts the
 * crawler competes with the request a reader is waiting on and nothing on
 * screen says so; a worker whose role was misspelled starts nothing, and a
 * database that stops being refreshed looks exactly like one that is up to
 * date until somebody reads a stale page days later. So the rule is a pure
 * function with the environment as an argument, on `db/config`'s terms, and
 * it is read here rather than by a deployment.
 */
describe("processRole", () => {
  test("names the three roles, case- and whitespace-insensitively", () => {
    assert.equal(processRole({ [PROCESS_ROLE_VAR]: "web" }), "web");
    assert.equal(processRole({ [PROCESS_ROLE_VAR]: "worker" }), "worker");
    assert.equal(processRole({ [PROCESS_ROLE_VAR]: "all" }), "all");
    assert.equal(processRole({ [PROCESS_ROLE_VAR]: "  WORKER " }), "worker");
  });

  test("an absent or unreadable value is `all`, which is what this app did", () => {
    // The opposite call from `parseRequestedSeason`, and right for the opposite
    // reason: a season names *which data* a page is about, so an unreadable one
    // must fail. This names which of two jobs a process does, and the honest
    // fallback for "we could not tell" is the behaviour the app had before
    // anybody asked — a process that both serves and maintains.
    assert.equal(processRole({}), "all");
    assert.equal(processRole({ [PROCESS_ROLE_VAR]: "" }), "all");
    assert.equal(processRole({ [PROCESS_ROLE_VAR]: "wrker" }), "all");
    assert.equal(processRole({ [PROCESS_ROLE_VAR]: "background" }), "all");
  });
});

describe("runsBackgroundJobs", () => {
  test("only `web` declines them", () => {
    assert.equal(runsBackgroundJobs({ [PROCESS_ROLE_VAR]: "web" }), false);
    assert.equal(runsBackgroundJobs({ [PROCESS_ROLE_VAR]: "worker" }), true);
    assert.equal(runsBackgroundJobs({ [PROCESS_ROLE_VAR]: "all" }), true);
    assert.equal(runsBackgroundJobs({}), true, "the default is unchanged");
  });

  test("a skipped boot carries the reason it skipped", () => {
    assert.equal(
      backgroundJobsSkipReason({ [PROCESS_ROLE_VAR]: "web" }),
      `${PROCESS_ROLE_VAR}=web`,
    );
    assert.equal(backgroundJobsSkipReason({ [PROCESS_ROLE_VAR]: "worker" }), null);
    assert.equal(backgroundJobsSkipReason({}), null);
  });
});
