import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { BOOT_STAGGER_MS } from "./boot-stagger.ts";
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

/**
 * What the deployment actually ships, pinned textually on `crawl-writes.test.ts`'
 * terms: the roles a dyno runs under live in a `Procfile` no test imports, and a
 * line that lost its role would be a database going quiet for hours with a green
 * suite behind it.
 */
describe("the Procfile", () => {
  const procfile = readFileSync(join(process.cwd(), "Procfile"), "utf8");
  const line = (type: string): string =>
    procfile
      .split("\n")
      .find((row) => row.startsWith(`${type}:`))
      ?.trim() ?? "";

  test("the web dyno runs the loops by default, which is the single-dyno case", () => {
    // One $7 Basic dyno serving requests *and* maintaining the database is the
    // shipped deployment; the crawler's RSS guard is what keeps the two out of
    // each other's way. A `web` here would be a dyno that serves and never
    // crawls, with no worker scaled up to do it instead.
    const web = line("web");
    assert.match(web, /APP_PROCESS_ROLE=\$\{APP_PROCESS_ROLE:-all\}/);
    assert.equal(
      processRole({ [PROCESS_ROLE_VAR]: "all" }),
      "all",
      "and `all` is a role this app answers to",
    );
    assert.equal(runsBackgroundJobs({ [PROCESS_ROLE_VAR]: "all" }), true);
  });

  test("the web line defers to a config var, so the split needs no redeploy", () => {
    // `${VAR:-all}` is a default rather than an assignment, which is what lets
    // one `heroku config:set APP_PROCESS_ROLE=web` move a deployment from the
    // single dyno to the split. Written `APP_PROCESS_ROLE=all` outright, a shell
    // assignment in front of a command beats the inherited environment and the
    // config var would be silently ignored.
    assert.match(line("web"), /:-all\}/);
    assert.equal(runsBackgroundJobs({ [PROCESS_ROLE_VAR]: "web" }), false);
  });

  test("the worker line assigns its role outright, so that config var cannot stop it", () => {
    // Heroku applies a config var to *every* dyno, so the `APP_PROCESS_ROLE=web`
    // that quietens the web process would also reach the worker. An assignment
    // in front of the command wins over the environment, which is the whole
    // reason these two lines read the variable differently.
    assert.match(line("worker"), /^worker: APP_PROCESS_ROLE=worker /);
    assert.equal(runsBackgroundJobs({ [PROCESS_ROLE_VAR]: "worker" }), true);
  });
});

/**
 * The boot stagger, which is an order rather than four numbers — see
 * `boot-stagger.ts` for the dependencies each is chosen from.
 */
describe("BOOT_STAGGER_MS", () => {
  test("the players map goes first and undelayed, because two loops read it", () => {
    // The KTC matcher resolves `sleeper_id` against the stored map and the
    // comps loader joins every season row to it. A stagger that put either in
    // front of it would be a first boot that did less than it could.
    assert.equal(BOOT_STAGGER_MS.players, 0);
    assert.ok(BOOT_STAGGER_MS.ktc > BOOT_STAGGER_MS.players);
    assert.ok(BOOT_STAGGER_MS.comps > BOOT_STAGGER_MS.players);
  });

  test("the four are distinct and strictly ordered", () => {
    // Two loops on one delay is two loops starting together, which is the thing
    // being fixed rather than a smaller version of it.
    const order = [
      BOOT_STAGGER_MS.players,
      BOOT_STAGGER_MS.ktc,
      BOOT_STAGGER_MS.crawl,
      BOOT_STAGGER_MS.comps,
    ];
    for (let i = 1; i < order.length; i++) {
      assert.ok(order[i]! > order[i - 1]!, `delay ${i} is not past the one before`);
    }
  });

  test("every loop still takes its first tick inside two minutes of boot", () => {
    // It is a stagger, not a throttle: the freshness checks are what decide
    // whether a boot tick does any work, and a delay long enough to be a policy
    // of its own would be a second staleness rule nobody wrote.
    for (const [name, delay] of Object.entries(BOOT_STAGGER_MS)) {
      assert.ok(delay < 120_000, `${name} waits ${delay}ms, which is a throttle`);
    }
  });
});
