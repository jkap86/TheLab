/**
 * Whether the league crawler may spend anything right now.
 *
 * The crawler shares a process — and on a Heroku Basic dyno a 512 MB quota —
 * with the web server it exists to fill the cache for, and it is the only thing
 * in that process that can be asked to wait. A tick is a Sleeper fan-out over a
 * batch of leagues whose parsed graphs, rosters, transactions and matchups all
 * live in memory at once, so it is also the one workload that can walk the dyno
 * into swapping while a request is being served. This module is what lets it
 * stand down: **background freshness is opportunistic, user-facing traffic is
 * not.**
 *
 * **The signal is RSS, deliberately, and not `heapUsed`.** What the platform
 * kills a dyno for is resident memory, and this process holds a great deal that
 * V8's heap does not account for — `Buffer`s, the HTTP and TLS buffers under
 * `fetch`, `pg`'s own allocations, Next's runtime, and the strings a 5 MB
 * Sleeper response is parsed out of. A guard reading `heapUsed` would report a
 * comfortable 90 MB while the dyno was at 480 and about to be told about it.
 * `heapUsed` is still read — by {@link memorySnapshot}, for the diagnostic line
 * a long pause prints — because a *diagnosis* wants the breakdown even though a
 * *decision* must not be made on one term of it.
 *
 * **Nothing here calls `global.gc()`**, and nothing depends on `--expose-gc`.
 * The correct answer to memory pressure is to stop creating new work and let the
 * collector do its job on the garbage the last batch already made; forcing a
 * collection is a synchronous pause on the thread that is also serving requests,
 * which trades the problem for a worse one.
 *
 * Pure and synchronous throughout: the RSS reading, the pool's counters, the
 * environment and the production flag all arrive as arguments, so every level,
 * every clamp and the hysteresis latch are driven by a test without touching the
 * machine's real memory. There are no timers here and no cached readings — each
 * call reflects RSS *now*, which is the whole point of checking between batches
 * rather than once per tick.
 *
 * It lives beside `./crawl-ttl` and `./crawl-priority` rather than in a folder
 * of its own for their reason: these are the crawler's policy modules, held to
 * the same bar — no `pg`, no `fetch`, relative `.ts` imports — so Node's own
 * runner resolves them.
 */

/** Bytes in a mebibyte. Every threshold in this module is stated in these. */
const MB = 1024 * 1024;

/** Megabytes, from bytes. */
export function toMb(bytes: number): number {
  return bytes / MB;
}

/**
 * This process's resident set size, in MB.
 *
 * The one place `process.memoryUsage()` is read for a *decision*, so a caller
 * that wants to know how much memory the crawler thinks it has does not have to
 * spell the conversion again — and so the reading can be replaced wholesale by
 * an injected one in a test.
 */
export function getRssMb(): number {
  return toMb(process.memoryUsage().rss);
}

/** Everything `process.memoryUsage()` reports, in MB, for a diagnostic line. */
export type MemorySnapshot = {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  arrayBuffersMb: number;
};

/**
 * The whole breakdown, rounded, for the warning a long pause prints.
 *
 * **This is the one place `heapUsed` is read, and it is not a decision.** A
 * crawler that stays paused across many ticks while traffic is low is either
 * telling the truth about a genuinely fat process or hiding a leak, and the two
 * are told apart by which term is growing — a rising `heapUsed` is the app's own
 * objects, a rising `external`/`arrayBuffers` against a flat heap is buffers.
 * Raising the thresholds until the crawler runs again would bury exactly that.
 */
export function memorySnapshot(
  usage: NodeJS.MemoryUsage = process.memoryUsage(),
): MemorySnapshot {
  const round = (bytes: number) => Math.round(toMb(bytes));
  return {
    rssMb: round(usage.rss),
    heapUsedMb: round(usage.heapUsed),
    heapTotalMb: round(usage.heapTotal),
    externalMb: round(usage.external),
    arrayBuffersMb: round(usage.arrayBuffers ?? 0),
  };
}

/** RSS at log precision — `"327MB"`. */
export const fmtMb = (mb: number): string => `${Math.round(mb)}MB`;

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/** Set to `false`/`off` to restore the crawler's unguarded behaviour exactly. */
export const CRAWLER_MEMORY_GUARD_VAR = "CRAWLER_MEMORY_GUARD_ENABLED";
/** Below this RSS the crawler runs at full width. */
export const CRAWLER_MEMORY_NORMAL_VAR = "CRAWLER_MEMORY_NORMAL_MB";
/** At this RSS the crawler drops to its minimum width. */
export const CRAWLER_MEMORY_THROTTLE_VAR = "CRAWLER_MEMORY_THROTTLE_MB";
/** At this RSS the crawler admits no new work at all. */
export const CRAWLER_MEMORY_STOP_VAR = "CRAWLER_MEMORY_STOP_MB";
/** RSS a yielded crawler has to fall back below before it works again. */
export const CRAWLER_MEMORY_RESUME_VAR = "CRAWLER_MEMORY_RESUME_MB";
/** Overrides the width taken from `CRAWL_CONCURRENCY`. */
export const CRAWLER_NORMAL_CONCURRENCY_VAR = "CRAWLER_MEMORY_NORMAL_CONCURRENCY";
/** Width under moderate pressure. */
export const CRAWLER_THROTTLED_CONCURRENCY_VAR =
  "CRAWLER_MEMORY_THROTTLED_CONCURRENCY";
/** Width under high pressure. */
export const CRAWLER_HIGH_CONCURRENCY_VAR = "CRAWLER_MEMORY_HIGH_CONCURRENCY";
/**
 * A fake RSS reading, honoured **outside production only**.
 *
 * The manual way to drive the levels without exhausting a machine's memory, and
 * it is an env var rather than an endpoint on purpose: a route that could tell
 * the crawler it was out of memory is a route that can stop the crawler, and
 * this guard must not become a lever anybody but the operator can pull. Ignored
 * in production, where the only honest reading is the real one.
 */
export const CRAWLER_MEMORY_FAKE_RSS_VAR = "CRAWLER_MEMORY_FAKE_RSS_MB";

/**
 * The thresholds a 512 MB dyno is sized for.
 *
 * Conservative against that quota rather than against the process's ordinary
 * footprint: what the numbers leave room for is a burst of *interactive*
 * traffic arriving while the crawler is mid-batch, which is the case the whole
 * guard exists for. At 400 MB there is still ~110 MB of headroom for the
 * requests the crawler is standing down in favour of.
 *
 * `resumeMb` is deliberately not one of the other three — see
 * {@link createCrawlPressureGate} for why the recovery point has to sit well
 * below the stopping point rather than on it.
 */
export const PRODUCTION_MEMORY_THRESHOLDS = {
  normalMb: 300,
  throttleMb: 350,
  stopMb: 400,
  resumeMb: 340,
} as const;

/**
 * How much more room development gets.
 *
 * `next dev` carries source maps, HMR state and an uncompiled module graph, and
 * routinely sits past the production `stopMb` doing nothing at all — so the
 * production numbers there would pause the crawler permanently and teach a
 * developer that the guard is broken. Scaling rather than listing a second set
 * keeps the *shape* identical, ordering rules included, and leaves one number
 * to move.
 *
 * The guard stays **on** in development, so its decisions are observable and its
 * logs are exercised; what changes is only the RSS at which they fire.
 */
export const DEV_HEADROOM_MULTIPLE = 3;

/** Everything the guard reads, resolved once. */
export type CrawlerPressureConfig = {
  /** False restores the crawler's pre-guard behaviour exactly. */
  enabled: boolean;
  /** RSS below which the crawler runs at `normalConcurrency`. */
  normalMb: number;
  /** RSS at which the crawler drops to `highConcurrency`. */
  throttleMb: number;
  /** RSS at which the crawler admits nothing new. */
  stopMb: number;
  /** RSS a yielded crawler must fall below before it works again. */
  resumeMb: number;
  normalConcurrency: number;
  throttledConcurrency: number;
  highConcurrency: number;
  /** A non-production RSS override, or null. */
  fakeRssMb: number | null;
  /** One line for an operator whose configuration was not honoured, or null. */
  notice: string | null;
};

/** Defaults for an environment, before anything is read. */
function defaultThresholds(production: boolean) {
  const scale = production ? 1 : DEV_HEADROOM_MULTIPLE;
  return {
    normalMb: PRODUCTION_MEMORY_THRESHOLDS.normalMb * scale,
    throttleMb: PRODUCTION_MEMORY_THRESHOLDS.throttleMb * scale,
    stopMb: PRODUCTION_MEMORY_THRESHOLDS.stopMb * scale,
    resumeMb: PRODUCTION_MEMORY_THRESHOLDS.resumeMb * scale,
  };
}

/**
 * The three widths, derived from whatever the crawler's own maximum is.
 *
 * `normalConcurrency` **is** that maximum rather than a number of its own: the
 * guard's job is to take width away under pressure, never to hand out more than
 * the crawler was already budgeted (see `CRAWL_CONCURRENCY`, which is a share of
 * the database pool). Halving is the moderate step and one is the floor, so a
 * later change to the maximum carries the reduced levels with it instead of
 * leaving a hard-coded 4/2/1 describing a crawler that no longer exists.
 */
function defaultConcurrency(maxConcurrency: number) {
  const normal = Math.max(1, Math.trunc(maxConcurrency));
  return {
    normalConcurrency: normal,
    throttledConcurrency: Math.max(1, Math.floor(normal / 2)),
    highConcurrency: 1,
  };
}

/** A positive finite number, or null — with junk recorded rather than thrown. */
function readNumber(
  env: Record<string, string | undefined>,
  name: string,
  invalid: string[],
): number | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    invalid.push(`${name}="${raw}"`);
    return null;
  }
  return parsed;
}

/** A positive integer, or null. Decimals are junk here, not something to round. */
function readInteger(
  env: Record<string, string | undefined>,
  name: string,
  invalid: string[],
): number | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    invalid.push(`${name}="${raw}"`);
    return null;
  }
  return parsed;
}

/**
 * Whether the guard is on.
 *
 * `false` and `off` turn it off and everything else leaves it on, which is
 * `loopSwitch`'s asymmetry for `loopSwitch`'s reason: a typo that fails to
 * disable a guard is visible in the first log line it prints, where a typo that
 * silently disables one is invisible until the dyno is killed.
 */
function readEnabled(
  env: Record<string, string | undefined>,
  invalid: string[],
): boolean {
  const raw = env[CRAWLER_MEMORY_GUARD_VAR]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  if (raw === "false" || raw === "off" || raw === "0" || raw === "no") return false;
  if (raw === "true" || raw === "on" || raw === "1" || raw === "yes") return true;
  invalid.push(`${CRAWLER_MEMORY_GUARD_VAR}="${raw}"`);
  return true;
}

/**
 * Resolve the guard's configuration.
 *
 * Pure — the environment and the production flag are arguments, on
 * `db/config`'s and `player-seasons/availability`'s shape — and it never
 * throws: a typo in a dashboard must not be why a deployment refuses to boot.
 * Anything unreadable falls back to the default for its own variable, and the
 * whole set is then checked for **ordering**:
 *
 * ```
 * resume < stop
 * normal <= throttle < stop
 * ```
 *
 * A set that fails that is discarded *whole* rather than repaired piecemeal:
 * a half-normalised set is a configuration nobody wrote, and the one thing worse
 * than ignoring an operator's numbers is obeying three of their four. The
 * defaults are safe by construction, and {@link CrawlerPressureConfig.notice}
 * says so in one line the caller logs once.
 */
export function crawlerPressureConfig(options: {
  /** The crawler's own maximum width — `CRAWL_CONCURRENCY`. */
  maxConcurrency: number;
  env?: Record<string, string | undefined>;
  production?: boolean;
}): CrawlerPressureConfig {
  const {
    maxConcurrency,
    env = process.env,
    production = process.env.NODE_ENV === "production",
  } = options;

  const invalid: string[] = [];
  const notices: string[] = [];

  const enabled = readEnabled(env, invalid);
  const fallback = defaultThresholds(production);

  const requested = {
    normalMb: readNumber(env, CRAWLER_MEMORY_NORMAL_VAR, invalid),
    throttleMb: readNumber(env, CRAWLER_MEMORY_THROTTLE_VAR, invalid),
    stopMb: readNumber(env, CRAWLER_MEMORY_STOP_VAR, invalid),
    resumeMb: readNumber(env, CRAWLER_MEMORY_RESUME_VAR, invalid),
  };

  let thresholds = {
    normalMb: requested.normalMb ?? fallback.normalMb,
    throttleMb: requested.throttleMb ?? fallback.throttleMb,
    stopMb: requested.stopMb ?? fallback.stopMb,
    resumeMb: requested.resumeMb ?? fallback.resumeMb,
  };

  const ordered =
    thresholds.resumeMb < thresholds.stopMb &&
    thresholds.normalMb <= thresholds.throttleMb &&
    thresholds.throttleMb < thresholds.stopMb;

  if (!ordered) {
    notices.push(
      `thresholds normal=${thresholds.normalMb} throttle=${thresholds.throttleMb} ` +
        `stop=${thresholds.stopMb} resume=${thresholds.resumeMb} are not ordered ` +
        `(resume < stop, normal <= throttle < stop); using the defaults`,
    );
    thresholds = { ...fallback };
  }

  const widths = defaultConcurrency(maxConcurrency);
  const normalConcurrency =
    readInteger(env, CRAWLER_NORMAL_CONCURRENCY_VAR, invalid) ??
    widths.normalConcurrency;
  // Clamped downward only, and to each other in order, so `high <= throttled <=
  // normal` holds however the three were written. A guard that could be
  // configured to widen the crawler is the failure it exists to prevent reached
  // through the variable meant to prevent it.
  const throttledConcurrency = Math.min(
    readInteger(env, CRAWLER_THROTTLED_CONCURRENCY_VAR, invalid) ??
      widths.throttledConcurrency,
    normalConcurrency,
  );
  const highConcurrency = Math.min(
    readInteger(env, CRAWLER_HIGH_CONCURRENCY_VAR, invalid) ??
      widths.highConcurrency,
    throttledConcurrency,
  );

  // Development only: in production the real reading is the only honest one.
  const fakeRssMb = production
    ? null
    : readNumber(env, CRAWLER_MEMORY_FAKE_RSS_VAR, invalid);

  if (invalid.length > 0) {
    notices.push(`ignoring ${invalid.join(", ")}`);
  }

  return {
    enabled,
    ...thresholds,
    normalConcurrency,
    throttledConcurrency,
    highConcurrency,
    fakeRssMb,
    notice: notices.length > 0 ? notices.join("; ") : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Reading pressure                                                           */
/* -------------------------------------------------------------------------- */

export type CrawlerPressureLevel = "normal" | "moderate" | "high" | "critical";

/** What is holding the crawler back, when something is. */
export type CrawlerPressureHold =
  /** RSS is at or above `stopMb`. */
  | "memory"
  /** RSS fell below `stopMb` but not yet to `resumeMb` after a yield. */
  | "recovering"
  /** Interactive traffic is queueing for a database connection. */
  | "pool";

/** The pg pool's counters, as the guard reads them. */
export type PoolSignal = {
  total: number;
  idle: number;
  waiting: number;
  max: number;
};

/** That signal, classified. */
export type PoolPressure = PoolSignal & {
  /**
   * Somebody is queued for a connection, or every connection is checked out.
   *
   * `waitingCount > 0` is the direct evidence — a caller is *already* paying for
   * the crawler's share of the pool — and the second clause catches the moment
   * before that, where the pool is fully checked out and the next request will
   * queue. Both are read at a batch boundary, where the crawler itself holds one
   * lock session and no transactions, so what they measure is mostly somebody
   * else.
   */
  saturated: boolean;
};

/** What a reading may be told rather than measure for itself. */
export type CrawlerPressureSignals = {
  /** RSS in bytes. Read from `process` when absent. */
  rssBytes?: number;
  /** Whether a previous tick yielded and has not recovered — the latch. */
  recovering?: boolean;
  /** The pool's counters, when the caller read them. */
  pool?: PoolSignal;
};

/** One reading. Cheap, synchronous, and never cached. */
export type CrawlerResourcePressure = {
  rssMb: number;
  level: CrawlerPressureLevel;
  /** How many league syncs may be *started* right now. 0 means none. */
  allowedConcurrency: number;
  /** Whether a tick may begin at all. */
  shouldStartTick: boolean;
  /** Whether a tick already running may admit another batch. */
  shouldAcceptNewWork: boolean;
  /** Whether the discovery pass may run — see the note below. */
  shouldDiscover: boolean;
  /** True while the recovery latch is still holding work back. */
  recovering: boolean;
  hold: CrawlerPressureHold | null;
  /** The pool reading, when one was supplied. */
  pool: PoolPressure | null;
};

/** Which band an RSS reading falls in. */
export function pressureLevel(
  rssMb: number,
  config: Pick<CrawlerPressureConfig, "normalMb" | "throttleMb" | "stopMb">,
): CrawlerPressureLevel {
  if (rssMb >= config.stopMb) return "critical";
  if (rssMb >= config.throttleMb) return "high";
  if (rssMb >= config.normalMb) return "moderate";
  return "normal";
}

/** The width a level allows. Critical is zero — nothing new starts. */
export function concurrencyFor(
  level: CrawlerPressureLevel,
  config: Pick<
    CrawlerPressureConfig,
    "normalConcurrency" | "throttledConcurrency" | "highConcurrency"
  >,
): number {
  switch (level) {
    case "normal":
      return config.normalConcurrency;
    case "moderate":
      return config.throttledConcurrency;
    case "high":
      return config.highConcurrency;
    case "critical":
      return 0;
  }
}

/**
 * Read the pressure right now.
 *
 * **Discovery is held back a whole band earlier than refresh work**, and that is
 * a priority rather than a safety margin: discovering a league costs ~41 Sleeper
 * requests and a first full graph where refreshing a known one costs ~11, and a
 * corpus whose known leagues are stale is a worse state than one that grew more
 * slowly. Nothing is lost by deferring it — the discovery queue is a join over
 * `league_users`, so a manager not enumerated this tick is simply enumerated on
 * a later one.
 *
 * **The pool is a secondary signal and can never stop a tick.** It narrows the
 * width to the minimum and defers discovery; it does not refuse work, because
 * waiting for a perfectly idle pool is a crawler that never runs on a busy
 * deployment, and because the counters move on their own between the read and
 * the batch it would be refusing.
 */
export function getCrawlerResourcePressure(
  config: CrawlerPressureConfig,
  signals: CrawlerPressureSignals = {},
): CrawlerResourcePressure {
  const rssMb =
    signals.rssBytes !== undefined
      ? toMb(signals.rssBytes)
      : (config.fakeRssMb ?? getRssMb());

  const pool: PoolPressure | null = signals.pool
    ? {
        ...signals.pool,
        saturated:
          signals.pool.waiting > 0 ||
          (signals.pool.idle === 0 && signals.pool.total >= signals.pool.max),
      }
    : null;

  if (!config.enabled) {
    return {
      rssMb,
      level: "normal",
      allowedConcurrency: config.normalConcurrency,
      shouldStartTick: true,
      shouldAcceptNewWork: true,
      shouldDiscover: true,
      recovering: false,
      hold: null,
      pool,
    };
  }

  const level = pressureLevel(rssMb, config);
  // The latch only *holds* while RSS is still above the resume point; below it
  // the tick runs and `createCrawlPressureGate` clears the latch.
  const recovering = signals.recovering === true && rssMb >= config.resumeMb;

  let allowedConcurrency = concurrencyFor(level, config);
  let shouldDiscover = level === "normal" || level === "moderate";
  let hold: CrawlerPressureHold | null = null;

  if (level === "critical") {
    hold = "memory";
    allowedConcurrency = 0;
    shouldDiscover = false;
  } else if (recovering) {
    hold = "recovering";
    allowedConcurrency = 0;
    shouldDiscover = false;
  } else if (pool?.saturated) {
    hold = "pool";
    allowedConcurrency = Math.min(allowedConcurrency, config.highConcurrency);
    shouldDiscover = false;
  }

  return {
    rssMb,
    level,
    allowedConcurrency,
    // The same predicate today, and two fields because they are two questions:
    // one is asked before a pool connection or an advisory lock is taken, the
    // other between batches of a tick already holding both.
    shouldStartTick: allowedConcurrency > 0,
    shouldAcceptNewWork: allowedConcurrency > 0,
    shouldDiscover,
    recovering,
    hold,
    pool,
  };
}

/* -------------------------------------------------------------------------- */
/* Hysteresis                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A crawler's memory of having yielded — the whole of the hysteresis, and the
 * only mutable state in this module.
 *
 * **A bare threshold oscillates**, which is worse than it sounds: 401 MB stops
 * the tick, the pause frees a little, 399 MB starts a full-width fan-out, the
 * fan-out is back over 400 within seconds, and the crawler spends every minute
 * launching work it immediately abandons — at exactly the moment the process can
 * least afford it. So a yield **latches**, and the latch is released only by RSS
 * falling to `resumeMb` (340 MB by default, a whole band below the 400 that set
 * it). In between, ticks are refused and the scheduled interval is what retries;
 * nothing here polls.
 *
 * It is deliberately **not** a global. The gate is created in the crawl loop's
 * own closure, beside the throttles that already live there, so a second start
 * (dev, HMR) builds a closure the double-start guard never ticks and the running
 * loop keeps the only live copy — and a one-off `runLeagueCrawl()` from a script
 * or a test gets a gate with no memory, which is the truthful answer when there
 * is no previous tick to remember.
 */
export type CrawlPressureGate = {
  readonly config: CrawlerPressureConfig;
  /**
   * Pressure now, with the latch applied — and cleared, when RSS has come back
   * below `resumeMb`.
   */
  read(signals?: Omit<CrawlerPressureSignals, "recovering">): CrawlerResourcePressure;
  /** Latch: this tick yielded, or was refused, for pressure. */
  yielded(): void;
  /** Whether the latch is currently set. */
  latched(): boolean;
};

export function createCrawlPressureGate(
  config: CrawlerPressureConfig,
): CrawlPressureGate {
  let latched = false;

  return {
    config,
    read(signals = {}) {
      const pressure = getCrawlerResourcePressure(config, {
        ...signals,
        recovering: latched,
      });
      // Cleared by *recovery*, never merely by a reading that stopped being
      // critical: 399 MB is not a recovery, it is one megabyte of luck.
      if (latched && pressure.rssMb < config.resumeMb) latched = false;
      return pressure;
    },
    yielded() {
      latched = true;
    },
    latched: () => latched,
  };
}

/* -------------------------------------------------------------------------- */
/* Incremental admission                                                      */
/* -------------------------------------------------------------------------- */

/** What one pass of {@link admitInBatches} did. */
export type AdmissionResult = {
  /** Units taken from the queue — and therefore run to completion. */
  started: number;
  /** How many batches that took. */
  batches: number;
  /**
   * True when admission stopped for pressure with budget and queue left. False
   * when the budget was spent or the queue ran dry, which are not yields.
   */
  yielded: boolean;
};

/**
 * Spend a budget of work, taking it from the queue only as fast as pressure
 * allows.
 *
 * **The point is what it refuses to do.** `Promise.all(leagues.map(sync))` — and
 * equally a single claim of the whole batch followed by a bounded map over it —
 * commits to every unit before the first one has run, so a memory check between
 * them can only watch. Here nothing is taken until it is about to be run, and
 * the amount taken is the width pressure allows right now, so a tick that starts
 * at 240 MB and reaches 410 MB simply stops asking for more.
 *
 * **`take` is never asked for more than will be run**, which is the freshness
 * guarantee at this grain rather than a nicety: the crawler's queue is claimed
 * by an `UPDATE … RETURNING` that *stamps* what it hands back, so a unit taken
 * and not run is a league marked attempted that nothing attempted — deferred a
 * whole freshness TTL for a reason no operator could see. Taking exactly the
 * batch that runs makes that state unreachable.
 *
 * **A batch is awaited whole before the next reading**, which is how already-
 * running work is allowed to finish safely: there is no cancellation here and no
 * abandoned promise, so a transaction mid-write is never interrupted by a
 * threshold being crossed. What pressure controls is admission and nothing else.
 */
export async function admitInBatches<T>(options: {
  /** The most units this pass may start. */
  budget: number;
  /** How many may start right now; 0 stops admission. */
  admit: () => number;
  /** Take up to `width` units from the queue, or `[]` when it is empty. */
  take: (width: number) => Promise<T[]> | T[];
  /** Run one batch, `width` at a time, to completion. */
  run: (items: T[], width: number) => Promise<void>;
}): Promise<AdmissionResult> {
  const { budget, admit, take, run } = options;

  let started = 0;
  let batches = 0;
  let yielded = false;

  while (started < budget) {
    const width = Math.trunc(admit());
    if (width <= 0) {
      yielded = true;
      break;
    }
    const items = await take(Math.min(width, budget - started));
    if (items.length === 0) break;
    started += items.length;
    batches += 1;
    await run(items, Math.min(width, items.length));
  }

  return { started, batches, yielded };
}
