/**
 * One process-wide cap on how many requests are in flight to Sleeper at once.
 *
 * **Every bound before this one was local, and local bounds do not add up.** The
 * crawler fetches four leagues at a time and eight weeks within each; a manager
 * sync fetches six leagues at a time and eight weeks within each; the discovery
 * pass runs its own four. Each of those numbers is defensible on its own and
 * none of them knows about the others, so two manager syncs plus a crawl tick is
 * three times the fan-out anyone signed off on — and the manager syncs are
 * *request*-driven, so their number is however many distinct usernames someone
 * decides to ask for. The advisory locks do not help here: they are per manager
 * by construction, so two different managers is two locks and no coordination at
 * all.
 *
 * So the bound moves to the one place every one of those paths passes through:
 * `sleeperGet`. What each caller's own concurrency constant now expresses is how
 * much of the process's budget that unit of work may *ask* for, which is what
 * those numbers were always meant to be.
 *
 * Pure and dependency-free — the queue is thirty lines and a dependency for it
 * would be a dependency to audit — and exported as a factory so the semantics can
 * be tested without a network behind them.
 */

/**
 * How many Sleeper requests one process may have open at once.
 *
 * Sized above the largest single fan-out any one path takes (the crawler's four
 * leagues × eight weeks) so nothing that used to run in parallel is serialised
 * by arithmetic, and well under what a burst of concurrent manager syncs would
 * otherwise produce. It is a *ceiling*, not a target: on an idle process the
 * limiter is a counter increment and nothing else.
 *
 * `SLEEPER_MAX_CONCURRENCY` overrides it — the knob to reach for on a 429, and
 * the one to lower before touching any of the per-path numbers, since this is
 * the only one that bounds the process rather than one caller.
 */
export const DEFAULT_SLEEPER_CONCURRENCY = 24;

/** Runs work with a bound on how much of it is in flight. */
export type Limiter = {
  /**
   * Run `fn` once a slot is free, releasing the slot however it settles.
   *
   * The slot is taken *around the call and nothing else*, so a caller must not
   * be holding a database transaction or an advisory lock while it waits — the
   * queue can be long, and a pool connection held across it is how a bounded
   * upstream becomes an unbounded database problem. Every caller here acquires
   * outside its transaction; `fetchLeagueGraph` reads Sleeper and *then*
   * `persistLeagueGraph` opens one.
   */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** In flight, waiting, and the high-water mark — for a log line or a test. */
  stats(): LimiterStats;
};

export type LimiterStats = {
  limit: number;
  active: number;
  queued: number;
  /** The most that have ever been in flight at once, since the process started. */
  peak: number;
};

/**
 * A counting semaphore with a FIFO queue.
 *
 * FIFO because the alternative is starvation with no symptom: the crawler's
 * requests are issued in a steady trickle and a request-driven sync's arrive in
 * bursts, so a LIFO or unordered queue would let a busy page indefinitely defer
 * a background tick that had been waiting since before it started.
 */
export function createLimiter(limit: number): Limiter {
  const max = Math.max(1, Math.trunc(limit));
  const waiting: Array<() => void> = [];
  let active = 0;
  let peak = 0;

  const release = () => {
    active -= 1;
    const next = waiting.shift();
    // Resumed rather than run here, so the slot handoff cannot recurse through
    // a long queue on one stack.
    if (next) next();
  };

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= max) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      active += 1;
      if (active > peak) peak = active;
      try {
        return await fn();
      } finally {
        // In a `finally`, which is the whole of the correctness argument: a slot
        // that leaks on a thrown request is a limiter that tightens by one every
        // time Sleeper times out, and ends up admitting nobody. Sleeper times out
        // often enough that this is a matter of hours, not of theory.
        release();
      }
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
