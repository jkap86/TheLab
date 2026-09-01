/**
 * One process-wide cap on how many requests are in flight to Sleeper at once.
 *
 * **Every bound short of this one is local, and local bounds do not add up.** A
 * page that fetches four leagues at a time and eight weeks within each is
 * defensible on its own; so is a second one doing six and eight. Neither knows
 * about the other, so two of them at once is twice the fan-out anyone signed off
 * on — and request-driven work is as concurrent as the number of people asking.
 *
 * So the bound lives in the one place every path passes through: `sleeperGet`.
 * What each caller's own concurrency constant then expresses is how much of the
 * process's budget that unit of work may *ask* for, which is what those numbers
 * were always meant to be.
 *
 * Pure and dependency-free — the queue is thirty lines, and a dependency for it
 * would be a dependency to audit — and exported as a factory so the semantics
 * can be tested without a network behind them.
 *
 * ## Ported deliberately narrow
 *
 * TheLabX's limiter also carries an admission half: `tryAcquire` for callers
 * that would rather shed than queue, `AbortSignal`/`maxWaitMs` bounds on the
 * wait, and the `AdmissionAbortedError` / `AdmissionTimeoutError` pair that lets
 * `shared/db/timeout` tell a refused caller from failed work. Every one of those
 * exists for something this app does not have yet — a streaming manager-leagues
 * route holding a response open, a request budget, advisory-locked syncs. None
 * is ported here, because a limiter carrying three error classes nothing throws
 * and a shed path nothing calls is harder to read than the thing it bounds.
 * Bring that half over with the route that needs it; the queue below is the part
 * it builds on and is faithful.
 */

/**
 * How many Sleeper requests one process may have open at once.
 *
 * A *ceiling*, not a target: on an idle process the limiter is a counter
 * increment and nothing else. `SLEEPER_MAX_CONCURRENCY` overrides it — the knob
 * to reach for on a 429, and the one to lower before touching any per-caller
 * number, since this is the only one that bounds the process rather than one
 * call site.
 */
export const DEFAULT_SLEEPER_CONCURRENCY = 24;

/** Runs work with a bound on how much of it is in flight. */
export type Limiter = {
  /**
   * Run `fn` once a slot is free, releasing the slot however it settles.
   *
   * The slot is held *around the call and nothing else*, so a caller must not be
   * holding a database transaction or an advisory lock while it waits — the
   * queue can be long, and a pooled connection held across it is how a bounded
   * upstream becomes an unbounded database problem.
   */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** In flight, waiting, and the high-water mark — for a log line or a test. */
  stats(): LimiterStats;
};

export type LimiterStats = {
  limit: number;
  active: number;
  queued: number;
  /** The most ever in flight at once, since the process started. */
  peak: number;
};

/**
 * A counting semaphore with a FIFO queue.
 *
 * FIFO because the alternative is starvation with no symptom: background work
 * arrives in a steady trickle and request-driven work in bursts, so an unordered
 * queue would let a busy page indefinitely defer a tick that had been waiting
 * since before it started.
 */
export function createLimiter(limit: number): Limiter {
  const max = Math.max(1, Math.trunc(limit));
  const waiting: (() => void)[] = [];
  let active = 0;
  let peak = 0;

  const take = () => {
    active += 1;
    if (active > peak) peak = active;
  };

  /**
   * Hand the slot to the next waiter, or give it back.
   *
   * **The slot is transferred rather than freed and re-taken.** Decrementing
   * here and letting the resumed caller increment leaves a synchronous window —
   * the waiter is resolved but its continuation is still a microtask away — in
   * which `active` reads below `max`. Kept counted, the slot belongs to the
   * waiter from the instant it is shifted, and the bound holds through the gap.
   */
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };

  /**
   * Run `fn` on a slot this caller is already counted for.
   *
   * `fn` is invoked **synchronously** by the `await` below, which is a property
   * callers rely on: a limiter with room must not defer the work it admits by a
   * microtask, or a caller that starts a job and interacts with it in the same
   * turn finds it has not begun.
   */
  const runAdmitted = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } finally {
      // In a `finally`, which is the whole of the correctness argument: a slot
      // that leaks on a thrown request is a limiter that tightens by one every
      // time Sleeper times out, and ends up admitting nobody. Sleeper times out
      // often enough that this is a matter of hours, not of theory.
      release();
    }
  };

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      // The caller that finds room takes a slot for itself, and does so
      // *synchronously* — which is why this is not an `async` function. Queued
      // callers are instead handed a slot already counted by `release`.
      if (active < max) {
        take();
        return runAdmitted(fn);
      }
      return new Promise<void>((resolve) => waiting.push(resolve)).then(() =>
        runAdmitted(fn),
      );
    },
    stats: () => ({ limit: max, active, queued: waiting.length, peak }),
  };
}

/** The configured limit, or the default for anything unreadable. */
export function sleeperConcurrency(
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = Number(env.SLEEPER_MAX_CONCURRENCY?.trim());
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SLEEPER_CONCURRENCY;
}
