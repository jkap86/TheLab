import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { databaseBudget } from "./budget.ts";
import { dbRead, loadEnrichments, memoryRead } from "./fanout.ts";
import { createHeavyReadAdmission } from "./heavy-admission.ts";

/**
 * The bound, driven by deferred promises rather than by timers.
 *
 * Every task here resolves only when the test says so, so "at most three in
 * flight" is asserted as a *fact about the counter* at the moment each task
 * starts — not inferred from how long anything took. A sleep-based version of
 * this test passes on a fast machine and flakes on a loaded one, which is the
 * one outcome worse than not having it.
 */

/** A promise plus the two handles that settle it. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending microtasks run, so "has it started yet" is answerable. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * A gate per name: records the order tasks start in, tracks how many are in
 * flight, and hands each a promise the test settles by hand.
 */
function gates(names: readonly string[]) {
  const pending = new Map(names.map((name) => [name, deferred<string>()]));
  const started: string[] = [];
  let live = 0;
  let peak = 0;

  const load = (name: string) => async () => {
    started.push(name);
    live += 1;
    peak = Math.max(peak, live);
    try {
      return await pending.get(name)!.promise;
    } finally {
      live -= 1;
    }
  };

  return {
    load,
    started,
    peak: () => peak,
    live: () => live,
    settle: (name: string) => pending.get(name)!.resolve(`${name}-value`),
    fail: (name: string, error: unknown) => pending.get(name)!.reject(error),
  };
}

const NAMES = ["a", "b", "c", "d", "e"] as const;

describe("loadEnrichments", () => {
  test("every enrichment is requested, and each answer arrives under its name", async () => {
    const g = gates(NAMES);
    const run = loadEnrichments(
      Object.fromEntries(NAMES.map((n) => [n, dbRead(g.load(n))])) as Record<
        (typeof NAMES)[number],
        ReturnType<typeof dbRead<string>>
      >,
      5,
    );
    await flush();
    for (const name of NAMES) g.settle(name);

    assert.deepEqual(await run, {
      a: "a-value",
      b: "b-value",
      c: "c-value",
      d: "d-value",
      e: "e-value",
    });
    assert.deepEqual([...g.started].sort(), [...NAMES].sort());
  });

  test("database-backed reads never exceed the fan-out budget", async () => {
    // The invariant, at the number the app actually resolves — five tasks
    // against a budget of three on the default pool.
    const limit = databaseBudget({}).fanout;
    assert.ok(limit < NAMES.length, "fixture must be wider than the budget");

    const g = gates(NAMES);
    const run = loadEnrichments(
      Object.fromEntries(NAMES.map((n) => [n, dbRead(g.load(n))])) as Record<
        string,
        ReturnType<typeof dbRead<string>>
      >,
    );

    await flush();
    assert.equal(g.live(), limit, "more reads opened at once than the budget");
    assert.equal(g.started.length, limit);

    // Draining one admits exactly one more, never two.
    g.settle(g.started[0]);
    await flush();
    assert.equal(g.live(), limit);

    for (const name of NAMES) g.settle(name);
    await run;
    assert.equal(g.peak(), limit, "peak concurrency exceeded the budget");
  });

  test("the default limit is the database budget, not a constant of its own", async () => {
    // Set the other way, the bound would drift from every other fan-out here.
    const g = gates(NAMES);
    const run = loadEnrichments(
      Object.fromEntries(NAMES.map((n) => [n, dbRead(g.load(n))])) as Record<
        string,
        ReturnType<typeof dbRead<string>>
      >,
    );
    await flush();
    assert.equal(g.started.length, databaseBudget(process.env).fanout);
    for (const name of NAMES) g.settle(name);
    await run;
  });

  test("work that reads no database is not queued behind work that does", async () => {
    // The rule the limiter must not swallow: a cached or upstream-limited read
    // takes no connection, so serialising it is latency bought for nothing.
    const g = gates(["db1", "db2", "db3", "db4", "memo"]);
    const run = loadEnrichments(
      {
        db1: dbRead(g.load("db1")),
        db2: dbRead(g.load("db2")),
        db3: dbRead(g.load("db3")),
        db4: dbRead(g.load("db4")),
        memo: memoryRead(g.load("memo")),
      },
      2,
    );

    await flush();
    // Two database reads and the memory one — the fourth waiter is a database
    // read, and the memory task did not have to wait for it.
    assert.deepEqual([...g.started].sort(), ["db1", "db2", "memo"]);
    assert.equal(g.started.includes("db3"), false);

    for (const name of ["db1", "db2", "db3", "db4", "memo"]) g.settle(name);
    await run;
  });

  test("a rejection gives its slot back, and the rest of the work proceeds", async () => {
    const g = gates(NAMES);
    const run = loadEnrichments(
      Object.fromEntries(NAMES.map((n) => [n, dbRead(g.load(n))])) as Record<
        string,
        ReturnType<typeof dbRead<string>>
      >,
      2,
    );

    await flush();
    assert.deepEqual(g.started, ["a", "b"]);

    // A failure is not a lost permit: the next queued read starts at once.
    g.fail("a", new Error("boom"));
    await flush();
    assert.deepEqual(g.started, ["a", "b", "c"]);
    assert.equal(g.live(), 2);

    // And the rest still run to completion rather than being abandoned.
    g.settle("b");
    await flush();
    g.settle("c");
    await flush();
    g.settle("d");
    g.settle("e");

    await assert.rejects(run, /boom/);
    assert.deepEqual([...g.started].sort(), [...NAMES].sort());
    assert.equal(g.live(), 0, "a task was left in flight");
  });

  test("the first rejection to arrive is the one thrown", async () => {
    // `Promise.all`'s own semantics: which error reaches the route decides
    // whether it answers 503 (busy) or 500 (broken), so it cannot become a fact
    // about the order the object literal was written in.
    const g = gates(["a", "b"]);
    const run = loadEnrichments(
      { a: dbRead(g.load("a")), b: dbRead(g.load("b")) },
      2,
    );
    await flush();
    g.fail("b", new Error("second-declared, first to fail"));
    await flush();
    g.fail("a", new Error("first-declared, second to fail"));

    await assert.rejects(run, /second-declared, first to fail/);
  });

  test("an empty set resolves to an empty object", async () => {
    assert.deepEqual(await loadEnrichments({}), {});
  });

  test("a task holding the shared heavy-read admission does not deadlock", async () => {
    // The auction enrichment's shape: it takes the process-wide heavy-read slot
    // *inside* the route slot this hands it. The two limiters can only deadlock
    // if something holding a heavy slot waits on a route slot — nothing does,
    // and this pins it: the heavy budget is saturated by an outsider first, and
    // every enrichment still completes once that outsider lets go.
    const heavy = createHeavyReadAdmission(1);
    const outsider = deferred<void>();
    const heldByOutsider = heavy.run(() => outsider.promise);

    const g = gates(["players", "ktc", "picks", "auction"]);
    const run = loadEnrichments(
      {
        players: dbRead(g.load("players")),
        ktc: dbRead(g.load("ktc")),
        picks: dbRead(g.load("picks")),
        auction: dbRead(() => heavy.run(g.load("auction"))),
      },
      2,
    );

    await flush();
    // The auction task is queued on the heavy budget while holding a route
    // slot; the other reads keep flowing through the slot beside it.
    g.settle("players");
    await flush();
    g.settle("ktc");
    await flush();
    assert.equal(g.started.includes("auction"), false, "heavy budget was bypassed");

    outsider.resolve();
    await heldByOutsider;
    await flush();
    assert.ok(g.started.includes("auction"), "auction never admitted");
    g.settle("picks");
    g.settle("auction");

    assert.deepEqual(await run, {
      players: "players-value",
      ktc: "ktc-value",
      picks: "picks-value",
      auction: "auction-value",
    });
  });
});
