import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * How the resource guard is wired into the crawl tick, pinned against its
 * source.
 *
 * **This is `crawl-writes.test.ts`' bargain, for its reason.** `crawl.ts` reaches
 * Postgres, Sleeper and the season resolver through `@/…` aliases, so Node's own
 * runner cannot load it and no test can drive `runLeagueCrawl` end to end here.
 * What can be driven is everything the tick's *decisions* are made of —
 * `./crawl-pressure` and `./discovery` are pure and have real tests — and what
 * is left is the wiring: the order the guard is consulted in, the fact that a
 * yield withholds admission rather than killing anything, and the fact that the
 * queue is claimed in the width that runs. Every one of those is silent when it
 * is wrong: the tick still returns a summary, the log line still reads healthy,
 * and the only symptom is a dyno at 500 MB or a batch of leagues deferred a
 * freshness TTL for no visible reason.
 *
 * So these read the file and assert the handful of textual facts the module's
 * doc comments spend paragraphs arguing for, so that an edit which flattens one
 * has to delete an assertion that says why.
 */

const read = (file: string) =>
  readFileSync(join(process.cwd(), "src/shared/manager", file), "utf8");

/** One function's body, from its signature to the next top-level `}`. */
function body(source: string, name: string, exported = true): string {
  const prefix = exported ? "export async function " : "async function ";
  // The name may be followed by a type parameter list, so the anchor stops at
  // the name — `admitInBatches<T>(` and `runLeagueCrawl(` both have to match.
  const start = source.indexOf(`${prefix}${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  // A `}` alone on its own line, rather than the first `\n}` — an inline options
  // type closes with `}): Promise<…> {` at column zero and would otherwise cut
  // the body off at the signature.
  const end = source.slice(start).search(/\n\}\s*(\n|$)/);
  assert.notEqual(end, -1, `${name} should be terminated`);
  return source.slice(start, start + end);
}

/** The same, for a module-private one. */
const anyBody = (source: string, name: string) => body(source, name, false);

/**
 * A source file with its comments taken out.
 *
 * The "never does X" assertions below have to read the *code*, because the
 * argument for not doing X is written down in a comment right beside it — the
 * whole point of this repo's doc comments. Asserted against the raw file, a
 * paragraph explaining why the crawler must never call `process.exit` would fail
 * a test asserting that it never calls `process.exit`.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const crawl = read("crawl.ts");
const scheduler = read("scheduler.ts");
const pressure = read("crawl-pressure.ts");

describe("the tick is admitted before it costs anything", () => {
  const tick = body(crawl, "runLeagueCrawl");

  test("pressure is read before the advisory lock is taken", () => {
    // A tick that cannot afford to crawl must not take a pool connection and
    // park a session on the crawl's lock to find that out — the refusal has to
    // be free, or a memory-pressured process pays for its own guard every
    // minute.
    const opening = tick.indexOf("const opening = gate.read({ pool: poolStats() })");
    const lock = tick.indexOf("withAdvisoryLock(LOCK_KEYS.crawl");
    assert.notEqual(opening, -1, "the tick reads pressure into `opening`");
    assert.notEqual(lock, -1, "the tick takes the crawl lock");
    assert.ok(opening < lock, "pressure is read before the lock is taken");
  });

  test("a refused tick returns before the lock, and before Sleeper", () => {
    const refusal = tick.indexOf("if (!opening.shouldStartTick)");
    const lock = tick.indexOf("withAdvisoryLock(LOCK_KEYS.crawl");
    assert.ok(refusal !== -1 && refusal < lock);
    // Nothing between the reading and the return but the latch and the summary.
    const branch = tick.slice(refusal, lock);
    assert.match(branch, /gate\.yielded\(\)/);
    assert.match(branch, /skipped: "memory"/);
    assert.doesNotMatch(code(branch), /claimStaleLeagues|getNflState|pendingManagers/);
  });

  test("the refusal latches, so the next tick waits for a real recovery", () => {
    assert.match(tick, /gate\.yielded\(\);/);
  });

  test("a tick that merely ran narrow does not latch", () => {
    // Latching on a throttle would turn every warm minute into a paused one.
    assert.match(tick, /if \(yielded\) gate\.yielded\(\);/);
  });
});

describe("yielding withholds admission and kills nothing", () => {
  test("the crawler never exits the process", () => {
    // Heroku owns the process lifecycle. A guard that restarted the dyno would
    // be answering a resource question with an availability one.
    for (const source of [crawl, scheduler, pressure]) {
      assert.doesNotMatch(code(source), /process\.exit/);
    }
  });

  test("nothing forces a collection", () => {
    // `global.gc()` is a synchronous pause on the thread also serving requests,
    // and it needs `--expose-gc` to exist at all. The answer to pressure is to
    // stop making garbage, not to stop the world clearing it.
    for (const source of [crawl, scheduler, pressure]) {
      assert.doesNotMatch(code(source), /\bgc\(/);
    }
  });

  test("the whole tick still runs inside the lock's callback", () => {
    // Which is what keeps `withAdvisoryLock`'s own `finally` — the unlock and
    // the client release — on every path out, a yield included. A yield is a
    // normal return from inside the callback, not an escape from it.
    const tick = body(crawl, "runLeagueCrawl");
    const lock = tick.indexOf("withAdvisoryLock(LOCK_KEYS.crawl");
    const after = tick.slice(lock);
    assert.match(after, /refreshStaleLeagues\(/);
    assert.match(after, /discoverMemberLeagues\(/);
  });

  test("a batch already in flight is awaited whole", () => {
    // `admitInBatches` awaits `run` before the next reading, so a threshold
    // crossed mid-batch cannot interrupt a transaction. Pinned where the
    // guarantee is made rather than where it is relied on.
    const fn = body(pressure, "admitInBatches");
    const runCall = fn.indexOf("await run(items");
    const nextAdmit = fn.indexOf("admit()");
    assert.notEqual(runCall, -1);
    assert.notEqual(nextAdmit, -1);
    // The admit call is at the top of the loop and the run at the bottom, so
    // the only way back to a reading is through a completed batch.
    assert.ok(nextAdmit < runCall);
    assert.doesNotMatch(code(fn), /void run\(|\.catch\(/);
  });
});

describe("the refresh pass claims only what it runs", () => {
  const fn = anyBody(crawl, "refreshStaleLeagues");

  test("the claim is the batch, and the batch is the admitted width", () => {
    // `claimStaleLeagues` *stamps* `sync_attempt_at` on everything it returns,
    // and the claim query refuses a league attempted inside the same freshness
    // TTL — so a league claimed and not run is deferred a whole TTL for a
    // reason nothing outside the process could see. Claiming inside `take`,
    // which `admitInBatches` only calls with the width that is about to run,
    // makes that unreachable.
    assert.match(fn, /admitInBatches<string>\(\{/);
    assert.match(fn, /take: \(width\) => claimStaleLeagues\(season, ttlMs, width\)/);
    // Never the whole budget up front.
    assert.doesNotMatch(code(fn), /claimStaleLeagues\(season, ttlMs, limit\)/);
  });

  test("the budget is the batch size and the width comes from the guard", () => {
    assert.match(fn, /budget: limit/);
    assert.match(fn, /admit,/);
  });

  test("nothing accumulates the batch's graphs", () => {
    // Retention is one batch: the fetched leagues and the sync result are the
    // `run` callback's own locals, so they are collectible the moment it
    // returns. An `allResults` array here would hold every league graph of the
    // tick until its slowest persist finished — which is the shape this guard
    // exists to keep out of a 512 MB process.
    assert.doesNotMatch(code(fn), /const all|results\.push|Promise\.all\(/);
    assert.match(fn, /const leagues: SleeperLeague\[\] = \[\];/);
  });

  test("freshness is still counted from what actually completed", () => {
    // A tick that stops after eight leagues reports eight refreshed and the
    // rest still due; `remaining` is budget it did not spend, and is zero when
    // the queue simply ran dry, which is not a yield.
    assert.match(fn, /due: remainingDue\(dueBefore, refreshed, goneCount\)/);
    assert.match(
      fn,
      /remaining: admission\.yielded \? Math\.max\(limit - admission\.started, 0\) : 0/,
    );
  });
});

describe("discovery is deferred, never lost", () => {
  const tick = body(crawl, "runLeagueCrawl");
  const fn = anyBody(crawl, "discoverMemberLeagues");

  test("the tick re-reads pressure between the two passes", () => {
    // "Do not proceed into discovery after the refresh work turned critical" is
    // a second question from "may I admit another league", and it is asked
    // after the refresh pass rather than inherited from before it.
    const refresh = tick.indexOf("await refreshStaleLeagues(");
    const reread = tick.indexOf("const discoveryPressure = gate.read(");
    const call = tick.indexOf("await discoverMemberLeagues(");
    assert.ok(refresh !== -1 && reread !== -1 && call !== -1);
    assert.ok(refresh < reread && reread < call);
    assert.match(tick, /discoveryPressure\.shouldDiscover/);
  });

  test("a skipped discovery pass is reported as deferred, not as idle", () => {
    assert.match(tick, /\{ \.\.\.NO_DISCOVERY, deferredForPressure: true \}/);
  });

  test("the pass refuses to start when it is handed no width", () => {
    assert.match(fn, /const enumerationWidth = admit\(\);/);
    assert.match(fn, /if \(enumerationWidth <= 0\)/);
  });

  test("leagues the pass never started hold their managers unstamped", () => {
    // The bug this closes has no symptom: an unattempted league is absent from
    // `failedIds`, so `stampableManagers` would stamp the manager waiting on it
    // — suppressing them for six hours and leaving the league unknown to
    // everyone. See `unrecordedDiscoveries`, which is where the rule is tested.
    assert.match(fn, /const unattempted = selection\.leagues\.slice\(attempted\.length\)/);
    assert.match(fn, /unrecordedDiscoveries\(/);
    assert.match(fn, /unattempted\.map\(\(l\) => l\.league_id\)/);
    // And it is the composed set that reaches the stamp, never the old one.
    assert.doesNotMatch(code(fn), /stampableManagers\(\s*selection,\s*unrecordedFailures\(/);
  });

  test("what a failure learned is still written down under pressure", () => {
    // `partitionSyncFailures` is not new work — it is recording what the tick
    // already found — and skipping it would leave a failed league with no row,
    // which is the one state that loses a discovery rather than deferring it.
    assert.match(fn, /admission\.yielded \? 1 : enumerationWidth/);
    const probe = tick.length && anyBody(crawl, "partitionSyncFailures");
    assert.match(String(probe), /Math\.max\(1, width\)/);
  });
});

describe("the scheduler owns the latch and the pause telemetry", () => {
  test("one gate per loop, in the loop's own closure", () => {
    // Not a module singleton: a re-invoked start (dev, HMR) builds a closure the
    // double-start guard never ticks, so the running loop keeps the only live
    // copy — the rule the throttles beside it already follow.
    const fn = scheduler.slice(scheduler.indexOf("export function startLeagueCrawler"));
    assert.match(fn, /const gate = createCrawlPressureGate\(/);
    assert.match(fn, /runLeagueCrawl\(\{ gate \}\)/);
  });

  test("a pause is rate-limited and carries the memory breakdown", () => {
    assert.match(scheduler, /pressureSkips === 1 \|\| now - lastPressureMs >= HEARTBEAT_MS/);
    // `heapUsed` for *diagnosis* — which term is growing is what tells an
    // honestly fat process from a leak — never for the decision.
    assert.match(scheduler, /memorySnapshot\(\)/);
    assert.match(scheduler, /heap=\$\{m\.heapUsedMb\}/);
    assert.match(scheduler, /tick\(s\) paused/);
  });

  test("recovery is announced once, on the tick that resumes", () => {
    assert.match(scheduler, /const wasPaused = pressureSkips > 0;/);
    assert.match(scheduler, /Memory recovered/);
    assert.match(scheduler, /pressureSkips = 0;/);
  });

  test("nothing polls while paused", () => {
    // The loop's own interval is the retry. A backoff timer here would be a
    // second scheduler with no guard against the first.
    const fn = scheduler.slice(scheduler.indexOf("export function startLeagueCrawler"));
    assert.doesNotMatch(code(fn), /setTimeout|setInterval/);
  });
});

describe("the guard reads only what is cheap", () => {
  test("the pool signal takes no connection", () => {
    const pool = readFileSync(join(process.cwd(), "src/shared/db/pool.ts"), "utf8");
    const fn = pool.slice(pool.indexOf("export function poolStats"));
    assert.match(fn, /pool\.waitingCount/);
    assert.doesNotMatch(code(fn), /connect\(|query\(/);
  });

  test("the pressure module has no timers and caches no reading", () => {
    assert.doesNotMatch(code(pressure), /setTimeout|setInterval|Date\.now\(\)/);
  });

  test("and it reaches neither the database nor the network", () => {
    // Which is what lets Node's own runner drive every rule in it.
    assert.doesNotMatch(code(pressure), /from "@\/|require\(|\bfetch\(/);
  });
});
