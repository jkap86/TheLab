import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CRAWLER_HIGH_CONCURRENCY_VAR,
  CRAWLER_MEMORY_FAKE_RSS_VAR,
  CRAWLER_MEMORY_GUARD_VAR,
  CRAWLER_MEMORY_NORMAL_VAR,
  CRAWLER_MEMORY_RESUME_VAR,
  CRAWLER_MEMORY_STOP_VAR,
  CRAWLER_MEMORY_THROTTLE_VAR,
  CRAWLER_NORMAL_CONCURRENCY_VAR,
  CRAWLER_THROTTLED_CONCURRENCY_VAR,
  DEV_HEADROOM_MULTIPLE,
  PRODUCTION_MEMORY_THRESHOLDS,
  admitInBatches,
  concurrencyFor,
  createCrawlPressureGate,
  crawlerPressureConfig,
  fmtMb,
  getCrawlerResourcePressure,
  getRssMb,
  memorySnapshot,
  pressureLevel,
  toMb,
} from "./crawl-pressure.ts";

/**
 * The crawler's resource guard, driven entirely on injected readings.
 *
 * **Nothing here reads this process's real memory for an assertion**, which is
 * the property the module is shaped around: every threshold, every width and
 * the hysteresis latch take their RSS as an argument, so the four bands and the
 * pause-and-recover cycle are exercised without allocating a byte. A test that
 * had to reach 400 MB to check the 400 MB rule would be a test that only runs on
 * some machines.
 */

const MB = 1024 * 1024;
const mb = (n: number) => n * MB;

/** The crawler's own maximum width, as `crawl.ts` passes it. */
const MAX = 4;

const prodConfig = (env: Record<string, string | undefined> = {}) =>
  crawlerPressureConfig({ maxConcurrency: MAX, env, production: true });

const devConfig = (env: Record<string, string | undefined> = {}) =>
  crawlerPressureConfig({ maxConcurrency: MAX, env, production: false });

/** Pressure at an RSS in MB, against the production defaults. */
const at = (
  rssMb: number,
  extra: Parameters<typeof getCrawlerResourcePressure>[1] = {},
  config = prodConfig(),
) => getCrawlerResourcePressure(config, { rssBytes: mb(rssMb), ...extra });

describe("units", () => {
  test("bytes convert to MB and round for a log line", () => {
    assert.equal(toMb(mb(327)), 327);
    assert.equal(fmtMb(327.4), "327MB");
    assert.equal(fmtMb(0), "0MB");
  });

  test("the RSS reading is the process's own resident set", () => {
    // The one assertion that touches the machine, and it only checks that the
    // reading is a plausible positive number in MB rather than in bytes — the
    // unit mix-up that would put every threshold three orders of magnitude out.
    const rss = getRssMb();
    assert.ok(rss > 1, `expected a positive RSS in MB, got ${rss}`);
    assert.ok(rss < 100_000, `expected MB rather than bytes, got ${rss}`);
  });

  test("the diagnostic snapshot reports every term, rounded, in MB", () => {
    const snapshot = memorySnapshot({
      rss: mb(410.4),
      heapUsed: mb(120),
      heapTotal: mb(180),
      external: mb(31.6),
      arrayBuffers: mb(12),
    });
    assert.deepEqual(snapshot, {
      rssMb: 410,
      heapUsedMb: 120,
      heapTotalMb: 180,
      externalMb: 32,
      arrayBuffersMb: 12,
    });
  });
});

describe("crawlerPressureConfig", () => {
  test("production takes the 512MB-dyno thresholds and the crawler's own width", () => {
    const config = prodConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.normalMb, 300);
    assert.equal(config.throttleMb, 350);
    assert.equal(config.stopMb, 400);
    assert.equal(config.resumeMb, 340);
    assert.equal(config.normalConcurrency, MAX);
    assert.equal(config.throttledConcurrency, 2);
    assert.equal(config.highConcurrency, 1);
    assert.equal(config.notice, null);
  });

  test("the reduced widths are derived from the maximum, not written down", () => {
    // The guard takes width away; it never invents a ladder of its own. Move
    // `CRAWL_CONCURRENCY` and the throttled level moves with it.
    const wide = crawlerPressureConfig({
      maxConcurrency: 6,
      env: {},
      production: true,
    });
    assert.equal(wide.normalConcurrency, 6);
    assert.equal(wide.throttledConcurrency, 3);
    assert.equal(wide.highConcurrency, 1);

    const narrow = crawlerPressureConfig({
      maxConcurrency: 1,
      env: {},
      production: true,
    });
    assert.equal(narrow.normalConcurrency, 1);
    assert.equal(narrow.throttledConcurrency, 1);
    assert.equal(narrow.highConcurrency, 1);
  });

  test("development gets headroom, and the same shape", () => {
    const config = devConfig();
    assert.equal(config.enabled, true);
    assert.equal(
      config.stopMb,
      PRODUCTION_MEMORY_THRESHOLDS.stopMb * DEV_HEADROOM_MULTIPLE,
    );
    assert.equal(
      config.resumeMb,
      PRODUCTION_MEMORY_THRESHOLDS.resumeMb * DEV_HEADROOM_MULTIPLE,
    );
    assert.ok(config.resumeMb < config.stopMb);
    assert.ok(config.normalMb <= config.throttleMb);
    assert.ok(config.throttleMb < config.stopMb);
  });

  test("every threshold is overridable", () => {
    const config = prodConfig({
      [CRAWLER_MEMORY_NORMAL_VAR]: "200",
      [CRAWLER_MEMORY_THROTTLE_VAR]: "240",
      [CRAWLER_MEMORY_STOP_VAR]: "280",
      [CRAWLER_MEMORY_RESUME_VAR]: "220",
    });
    assert.equal(config.normalMb, 200);
    assert.equal(config.throttleMb, 240);
    assert.equal(config.stopMb, 280);
    assert.equal(config.resumeMb, 220);
    assert.equal(config.notice, null);
  });

  test("the guard can be turned off, and off restores full width", () => {
    for (const off of ["false", "off", "0", "no", "OFF", " off "]) {
      assert.equal(prodConfig({ [CRAWLER_MEMORY_GUARD_VAR]: off }).enabled, false, off);
    }
    for (const on of ["true", "on", "1", "yes"]) {
      assert.equal(prodConfig({ [CRAWLER_MEMORY_GUARD_VAR]: on }).enabled, true, on);
    }
  });

  test("junk leaves the guard on and says so once", () => {
    // The asymmetry `loopSwitch` already lives by: a typo that fails to disable
    // a guard is visible, a typo that silently disables one is not.
    const config = prodConfig({ [CRAWLER_MEMORY_GUARD_VAR]: "maybe" });
    assert.equal(config.enabled, true);
    assert.match(config.notice ?? "", /CRAWLER_MEMORY_GUARD_ENABLED="maybe"/);
  });

  test("unreadable numbers fall back per variable and are named in one notice", () => {
    const config = prodConfig({
      [CRAWLER_MEMORY_NORMAL_VAR]: "lots",
      [CRAWLER_MEMORY_STOP_VAR]: "-4",
    });
    assert.equal(config.normalMb, 300);
    assert.equal(config.stopMb, 400);
    const notice = config.notice ?? "";
    assert.match(notice, /CRAWLER_MEMORY_NORMAL_MB="lots"/);
    assert.match(notice, /CRAWLER_MEMORY_STOP_MB="-4"/);
    // One line, not two: an operator hears about it once.
    assert.equal(notice.split("\n").length, 1);
  });

  test("a set that is not ordered is discarded whole, never half-repaired", () => {
    // resume >= stop: a crawler that resumed at the point it stops is a crawler
    // that oscillates, which is the thing the resume threshold exists to stop.
    const resumeTooHigh = prodConfig({
      [CRAWLER_MEMORY_RESUME_VAR]: "420",
      [CRAWLER_MEMORY_STOP_VAR]: "400",
      [CRAWLER_MEMORY_NORMAL_VAR]: "200",
    });
    assert.equal(resumeTooHigh.resumeMb, 340);
    assert.equal(resumeTooHigh.stopMb, 400);
    // The whole set, including the perfectly reasonable `normal` beside it.
    assert.equal(resumeTooHigh.normalMb, 300);
    assert.match(resumeTooHigh.notice ?? "", /not ordered/);
  });

  test("normal above throttle, and throttle at stop, are both rejected", () => {
    const inverted = prodConfig({
      [CRAWLER_MEMORY_NORMAL_VAR]: "360",
      [CRAWLER_MEMORY_THROTTLE_VAR]: "350",
    });
    assert.equal(inverted.normalMb, 300);
    assert.match(inverted.notice ?? "", /not ordered/);

    const flush = prodConfig({
      [CRAWLER_MEMORY_THROTTLE_VAR]: "400",
      [CRAWLER_MEMORY_STOP_VAR]: "400",
    });
    assert.equal(flush.throttleMb, 350);
    assert.match(flush.notice ?? "", /not ordered/);
  });

  test("configured widths clamp downward and never widen the crawler", () => {
    const config = prodConfig({
      [CRAWLER_NORMAL_CONCURRENCY_VAR]: "2",
      [CRAWLER_THROTTLED_CONCURRENCY_VAR]: "8",
      [CRAWLER_HIGH_CONCURRENCY_VAR]: "5",
    });
    assert.equal(config.normalConcurrency, 2);
    assert.equal(config.throttledConcurrency, 2);
    assert.equal(config.highConcurrency, 2);
  });

  test("a decimal width is junk, not something to round", () => {
    const config = prodConfig({ [CRAWLER_THROTTLED_CONCURRENCY_VAR]: "2.5" });
    assert.equal(config.throttledConcurrency, 2);
    assert.match(config.notice ?? "", /CRAWLER_MEMORY_THROTTLED_CONCURRENCY="2.5"/);
  });

  test("the RSS override is a development lever and production ignores it", () => {
    assert.equal(devConfig({ [CRAWLER_MEMORY_FAKE_RSS_VAR]: "410" }).fakeRssMb, 410);
    assert.equal(prodConfig({ [CRAWLER_MEMORY_FAKE_RSS_VAR]: "410" }).fakeRssMb, null);
  });

  test("an override drives the levels without allocating anything", () => {
    const config = devConfig({
      [CRAWLER_MEMORY_FAKE_RSS_VAR]: "3600",
      [CRAWLER_MEMORY_STOP_VAR]: "1200",
    });
    // No `rssBytes` — the reading comes from the override rather than `process`.
    const pressure = getCrawlerResourcePressure(config);
    assert.equal(pressure.rssMb, 3600);
    assert.equal(pressure.level, "critical");
    assert.equal(pressure.shouldStartTick, false);
  });
});

describe("classification", () => {
  test("the four bands", () => {
    assert.equal(at(250).level, "normal");
    assert.equal(at(320).level, "moderate");
    assert.equal(at(370).level, "high");
    assert.equal(at(410).level, "critical");
  });

  test("each threshold belongs to the band it opens", () => {
    const config = prodConfig();
    assert.equal(pressureLevel(299.9, config), "normal");
    assert.equal(pressureLevel(300, config), "moderate");
    assert.equal(pressureLevel(349.9, config), "moderate");
    assert.equal(pressureLevel(350, config), "high");
    assert.equal(pressureLevel(399.9, config), "high");
    assert.equal(pressureLevel(400, config), "critical");
  });

  test("width per band, and critical is zero", () => {
    const config = prodConfig();
    assert.equal(concurrencyFor("normal", config), 4);
    assert.equal(concurrencyFor("moderate", config), 2);
    assert.equal(concurrencyFor("high", config), 1);
    assert.equal(concurrencyFor("critical", config), 0);
  });

  test("a normal tick runs at full width and may discover", () => {
    const p = at(242);
    assert.equal(p.allowedConcurrency, 4);
    assert.equal(p.shouldStartTick, true);
    assert.equal(p.shouldAcceptNewWork, true);
    assert.equal(p.shouldDiscover, true);
    assert.equal(p.hold, null);
  });

  test("moderate narrows the width and still discovers", () => {
    const p = at(318);
    assert.equal(p.allowedConcurrency, 2);
    assert.equal(p.shouldAcceptNewWork, true);
    assert.equal(p.shouldDiscover, true);
  });

  test("high is one league at a time, and no discovery", () => {
    // Discovery costs ~41 Sleeper requests and a whole first graph against a
    // refresh's ~11, so it is the first thing given up and the last taken back.
    const p = at(366);
    assert.equal(p.allowedConcurrency, 1);
    assert.equal(p.shouldStartTick, true);
    assert.equal(p.shouldDiscover, false);
  });

  test("critical admits nothing at all", () => {
    const p = at(407);
    assert.equal(p.allowedConcurrency, 0);
    assert.equal(p.shouldStartTick, false);
    assert.equal(p.shouldAcceptNewWork, false);
    assert.equal(p.shouldDiscover, false);
    assert.equal(p.hold, "memory");
  });

  test("a disabled guard is the crawler as it was, at any RSS", () => {
    const off = prodConfig({ [CRAWLER_MEMORY_GUARD_VAR]: "false" });
    const p = at(900, {}, off);
    assert.equal(p.level, "normal");
    assert.equal(p.allowedConcurrency, 4);
    assert.equal(p.shouldStartTick, true);
    assert.equal(p.shouldAcceptNewWork, true);
    assert.equal(p.shouldDiscover, true);
    assert.equal(p.hold, null);
    // The reading is still taken, so a disabled guard is still observable.
    assert.equal(p.rssMb, 900);
  });
});

describe("the database pool as a secondary signal", () => {
  const pool = (over: Partial<{ total: number; idle: number; waiting: number; max: number }>) => ({
    total: 4,
    idle: 3,
    waiting: 0,
    max: 10,
    ...over,
  });

  test("a queue for a connection narrows the width and defers discovery", () => {
    const p = at(242, { pool: pool({ waiting: 2, idle: 0, total: 10 }) });
    assert.equal(p.pool?.saturated, true);
    assert.equal(p.hold, "pool");
    assert.equal(p.allowedConcurrency, 1);
    assert.equal(p.shouldDiscover, false);
  });

  test("but it never refuses the tick", () => {
    // Waiting for a perfectly idle pool is a crawler that never runs on a busy
    // deployment, and the counters move between the reading and the batch it
    // would be refusing.
    const p = at(242, { pool: pool({ waiting: 9, idle: 0, total: 10 }) });
    assert.equal(p.shouldStartTick, true);
    assert.equal(p.shouldAcceptNewWork, true);
    assert.ok(p.allowedConcurrency > 0);
  });

  test("fully checked out with nobody queued is still saturation", () => {
    const p = at(242, { pool: pool({ waiting: 0, idle: 0, total: 10 }) });
    assert.equal(p.pool?.saturated, true);
  });

  test("idle capacity is not", () => {
    const p = at(242, { pool: pool({ waiting: 0, idle: 3, total: 4 }) });
    assert.equal(p.pool?.saturated, false);
    assert.equal(p.allowedConcurrency, 4);
    assert.equal(p.shouldDiscover, true);
    assert.equal(p.hold, null);
  });

  test("it can only narrow, never widen a memory decision", () => {
    const p = at(366, { pool: pool({ waiting: 0, idle: 3 }) });
    assert.equal(p.allowedConcurrency, 1);
    const critical = at(410, { pool: pool({ waiting: 0, idle: 3 }) });
    assert.equal(critical.allowedConcurrency, 0);
    assert.equal(critical.hold, "memory");
  });

  test("no reading supplied is not a claim that the pool is healthy", () => {
    assert.equal(at(242).pool, null);
  });
});

describe("hysteresis", () => {
  test("a gate with no history behaves exactly like a bare reading", () => {
    const gate = createCrawlPressureGate(prodConfig());
    assert.equal(gate.latched(), false);
    assert.equal(gate.read({ rssBytes: mb(382) }).shouldStartTick, true);
  });

  test("a yield latches, and 399MB is not a recovery", () => {
    const gate = createCrawlPressureGate(prodConfig());
    // 12:00 — the tick goes critical and stands down.
    assert.equal(gate.read({ rssBytes: mb(406) }).shouldStartTick, false);
    gate.yielded();

    // 12:01 — off the stop threshold, nowhere near the resume one.
    const next = gate.read({ rssBytes: mb(382) });
    assert.equal(next.shouldStartTick, false);
    assert.equal(next.hold, "recovering");
    assert.equal(next.recovering, true);
    assert.equal(gate.latched(), true);

    // One megabyte of luck is still not a recovery.
    assert.equal(gate.read({ rssBytes: mb(399) }).shouldStartTick, false);
    assert.equal(gate.latched(), true);
  });

  test("falling below the resume threshold releases it, and it stays released", () => {
    const gate = createCrawlPressureGate(prodConfig());
    gate.yielded();

    // 12:02 — recovered.
    const resumed = gate.read({ rssBytes: mb(329) });
    assert.equal(resumed.shouldStartTick, true);
    assert.equal(resumed.level, "moderate");
    assert.equal(resumed.allowedConcurrency, 2);
    assert.equal(resumed.recovering, false);
    assert.equal(gate.latched(), false);

    // And the same 382MB that was refused a moment ago now runs, narrowly —
    // which is the whole difference between a latch and a third threshold.
    const after = gate.read({ rssBytes: mb(382) });
    assert.equal(after.shouldStartTick, true);
    assert.equal(after.allowedConcurrency, 1);
  });

  test("the resume threshold cannot rescue a tick that is still critical", () => {
    const gate = createCrawlPressureGate(prodConfig());
    gate.yielded();
    const p = gate.read({ rssBytes: mb(410) });
    assert.equal(p.hold, "memory");
    assert.equal(p.shouldStartTick, false);
    assert.equal(gate.latched(), true);
  });

  test("a disabled guard never latches", () => {
    const gate = createCrawlPressureGate(
      prodConfig({ [CRAWLER_MEMORY_GUARD_VAR]: "off" }),
    );
    gate.yielded();
    const p = gate.read({ rssBytes: mb(900) });
    assert.equal(p.shouldStartTick, true);
    assert.equal(p.recovering, false);
  });
});

describe("admitInBatches", () => {
  /** A queue of ids, handing out at most `width` at a time. */
  function queue(size: number) {
    const items = Array.from({ length: size }, (_, i) => `L${i + 1}`);
    const asked: number[] = [];
    return {
      items,
      asked,
      take(width: number) {
        asked.push(width);
        return items.splice(0, width);
      },
      get left() {
        return items.length;
      },
    };
  }

  test("a steady width spends the whole budget in batches", async () => {
    const q = queue(15);
    const ran: string[][] = [];
    const result = await admitInBatches<string>({
      budget: 15,
      admit: () => 4,
      take: (w) => q.take(w),
      run: async (items) => {
        ran.push(items);
      },
    });
    assert.deepEqual(result, { started: 15, batches: 4, yielded: false });
    assert.deepEqual(ran.map((b) => b.length), [4, 4, 4, 3]);
    assert.equal(q.left, 0);
  });

  test("the queue is never asked for more than the budget has left", async () => {
    // The freshness guarantee at this grain: the crawler's queue *stamps* what
    // it hands back, so a unit taken and not run is a league deferred a whole
    // TTL for a reason nothing outside could see.
    const q = queue(15);
    await admitInBatches<string>({
      budget: 10,
      admit: () => 4,
      take: (w) => q.take(w),
      run: async () => {},
    });
    assert.deepEqual(q.asked, [4, 4, 2]);
    assert.equal(q.left, 5);
  });

  test("no width means nothing is taken at all", async () => {
    const q = queue(15);
    const result = await admitInBatches<string>({
      budget: 15,
      admit: () => 0,
      take: (w) => q.take(w),
      run: async () => {
        assert.fail("nothing should run");
      },
    });
    assert.deepEqual(result, { started: 0, batches: 0, yielded: true });
    assert.deepEqual(q.asked, []);
    assert.equal(q.left, 15);
  });

  test("pressure mid-pass stops admission and leaves the rest in the queue", async () => {
    const q = queue(15);
    const widths = [4, 4, 0];
    let call = 0;
    const ran: string[] = [];
    const result = await admitInBatches<string>({
      budget: 15,
      admit: () => widths[call++] ?? 0,
      take: (w) => q.take(w),
      run: async (items) => {
        ran.push(...items);
      },
    });
    assert.deepEqual(result, { started: 8, batches: 2, yielded: true });
    // Every unit that was taken was also run — nothing is stranded mid-flight.
    assert.equal(ran.length, result.started);
    assert.deepEqual(ran, ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"]);
    // And the seven the guard stopped us reaching are untouched, still queued.
    assert.equal(q.left, 7);
    assert.deepEqual(q.items, ["L9", "L10", "L11", "L12", "L13", "L14", "L15"]);
  });

  test("a drained queue is not a yield", async () => {
    const q = queue(3);
    const result = await admitInBatches<string>({
      budget: 15,
      admit: () => 4,
      take: (w) => q.take(w),
      run: async () => {},
    });
    assert.deepEqual(result, { started: 3, batches: 1, yielded: false });
  });

  test("a spent budget is not a yield either", async () => {
    const q = queue(15);
    const result = await admitInBatches<string>({
      budget: 4,
      admit: () => 4,
      take: (w) => q.take(w),
      run: async () => {},
    });
    assert.equal(result.yielded, false);
  });

  test("a batch is awaited whole before pressure is read again", async () => {
    // The "already-running work finishes safely" guarantee, stated as ordering:
    // there is no reading between a batch starting and that batch finishing, so
    // nothing in flight can be cancelled by a threshold being crossed.
    const events: string[] = [];
    const q = queue(6);
    await admitInBatches<string>({
      budget: 6,
      admit: () => {
        events.push("admit");
        return 3;
      },
      take: (w) => {
        events.push("take");
        return q.take(w);
      },
      run: async (items) => {
        events.push(`run:${items.length}:start`);
        await Promise.resolve();
        events.push(`run:${items.length}:end`);
      },
    });
    assert.deepEqual(events, [
      "admit",
      "take",
      "run:3:start",
      "run:3:end",
      "admit",
      "take",
      "run:3:start",
      "run:3:end",
    ]);
  });

  test("the width handed to a run never exceeds the batch", async () => {
    const q = queue(2);
    const widths: number[] = [];
    await admitInBatches<string>({
      budget: 15,
      admit: () => 4,
      take: (w) => q.take(w),
      run: async (_items, width) => {
        widths.push(width);
      },
    });
    assert.deepEqual(widths, [2]);
  });

  test("a failing batch propagates rather than looping, and strands nothing", async () => {
    const q = queue(9);
    let admitted = 0;
    await assert.rejects(
      admitInBatches<string>({
        budget: 9,
        admit: () => {
          admitted += 1;
          return 3;
        },
        take: (w) => q.take(w),
        run: async () => {
          throw new Error("claim failed");
        },
      }),
      /claim failed/,
    );
    // One admission, one batch, and no further work was started behind it.
    assert.equal(admitted, 1);
    assert.equal(q.left, 6);
  });
});

describe("a tick that walks into pressure", () => {
  /**
   * The scenario the guard exists for, end to end on injected readings: a tick
   * starts comfortable, the memory it allocates carries it through every band,
   * and the leagues it never reached are still in the queue for the next one.
   */
  test("the batch stops, the rest stays queued, and the gate latches", async () => {
    const gate = createCrawlPressureGate(prodConfig());
    const claimed: string[] = [];
    const queued = Array.from({ length: 15 }, (_, i) => `L${i + 1}`);
    // RSS at each pressure reading, rising as the tick allocates.
    const readings = [242, 318, 366, 407];
    let reading = 0;
    const rss = () => mb(readings[Math.min(reading, readings.length - 1)]);

    const widths: number[] = [];
    const opening = gate.read({ rssBytes: rss() });
    assert.equal(opening.shouldStartTick, true);
    assert.equal(opening.allowedConcurrency, 4);

    const result = await admitInBatches<string>({
      budget: 15,
      admit: () => {
        const p = gate.read({ rssBytes: rss() });
        reading += 1;
        widths.push(p.allowedConcurrency);
        return p.shouldAcceptNewWork ? p.allowedConcurrency : 0;
      },
      take: (width) => queued.splice(0, width),
      run: async (batch) => {
        claimed.push(...batch);
      },
    });

    // 4 at 242MB, 2 at 318, 1 at 366, then nothing at 407.
    assert.deepEqual(widths, [4, 2, 1, 0]);
    assert.deepEqual(result, { started: 7, batches: 3, yielded: true });
    assert.equal(claimed.length, 7);
    // Eight leagues were never claimed, so nothing stamped them and they are
    // the next tick's first candidates.
    assert.deepEqual(queued, ["L8", "L9", "L10", "L11", "L12", "L13", "L14", "L15"]);

    if (result.yielded) gate.yielded();
    assert.equal(gate.latched(), true);

    // 12:01 — still elevated. Refused, and it costs nothing to find out.
    assert.equal(gate.read({ rssBytes: mb(382) }).shouldStartTick, false);
    // 12:02 — recovered. The remaining eight are crawled.
    assert.equal(gate.read({ rssBytes: mb(329) }).shouldStartTick, true);
    assert.equal(gate.latched(), false);
  });

  test("discovery is given up a band before refresh work is", async () => {
    const gate = createCrawlPressureGate(prodConfig());
    // High pressure: the refresh pass still admits one league at a time...
    const high = gate.read({ rssBytes: mb(366) });
    assert.equal(high.shouldAcceptNewWork, true);
    assert.equal(high.allowedConcurrency, 1);
    // ...and discovery does not run at all.
    assert.equal(high.shouldDiscover, false);
  });
});
