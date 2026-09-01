/**
 * One process-wide cap on how many requests are in flight to Sleeper at once.
 *
 * **Every bound short of this one is local, and local bounds do not add up.** A
 * manager sync fetches six leagues at a time and eight weeks within each; that
 * is defensible on its own, and so is a second one running for a different
 * manager. Neither knows about the other, so two of them at once is twice the
 * fan-out anyone signed off on — and they are *request*-driven, so their number
 * is however many distinct usernames someone decides to ask for. The advisory
 * locks do not help here: they are per manager by construction, so two
 * different managers is two locks and no coordination at all.
 *
 * So the bound lives in the one place every path passes through: `sleeperGet`.
 * What each caller's own concurrency constant then expresses is how much of the
 * process's budget that unit of work may *ask* for, which is what those numbers
 * were always meant to be.
 *
 * Pure and dependency-free — the queue is thirty lines and a dependency for it
 * would be a dependency to audit — and exported as a factory so the semantics can
 * be tested without a network behind them.
 */

/**
 * How many Sleeper requests one process may have open at once.
 *
 * Sized above the largest single fan-out any one path takes (a manager sync's
 * six leagues × eight weeks would ask for more, and gets it a slot at a time)
 * so nothing that would run in parallel is serialised by arithmetic, and well
 * under what a burst of concurrent manager syncs would otherwise produce. It is
 * a *ceiling*, not a target: on an idle process the limiter is a counter
 * increment and nothing else.
 *
 * `SLEEPER_MAX_CONCURRENCY` overrides it — the knob to reach for on a 429, and
 * the one to lower before touching any per-caller number, since this is the
 * only one that bounds the process rather than one call site.
 */
export const DEFAULT_SLEEPER_CONCURRENCY = 24;

/**
 * How long a caller is willing to *queue*, and what cancels the queueing.
 *
 * **Only the wait is bounded, never the work.** Once a slot has been handed
 * over the task runs to completion under whatever deadlines already govern it
 * — `statement_timeout`, the pool's connect timeout, the platform's own — and
 * neither of these fields is consulted again. What they exist to stop is the
 * opposite shape: a request the platform abandoned at 30 seconds whose queued
 * task is handed a permit at 34 and then spends half a minute of database time
 * computing an answer nobody is listening for. That is not merely wasted, it is
 * a connection the *next* request queues behind, which is how one slow read
 * becomes an outage.
 */
export type LimiterWaitOptions = {
  /**
   * Aborts the queueing — a request's own `AbortSignal` is what this is for.
   *
   * An already-aborted signal is refused before a slot is taken at all, so a
   * caller whose client has gone never starts the work; a signal that fires
   * while queued removes the waiter and rejects with
   * {@link AdmissionAbortedError}. A signal that fires *after* the slot is
   * granted does nothing here, deliberately — see {@link LimiterWaitOptions}.
   */
  signal?: AbortSignal;
  /**
   * The longest this caller will queue before giving up, in ms.
   *
   * A backstop for the signal rather than a substitute for it: a platform that
   * kills a request without telling the process leaves no signal to fire, so
   * the queue needs a clock of its own. Expiry rejects with
   * {@link AdmissionTimeoutError}. Omitted means "wait as long as it takes",
   * which is the right answer for a background loop and the wrong one for
   * anything holding a response open.
   */
  maxWaitMs?: number;
};

/**
 * A caller that gave up queueing because whatever it was answering for went
 * away — the client disconnected, or the request was aborted.
 *
 * Distinct from {@link AdmissionTimeoutError} because the two mean opposite
 * things operationally: this one is *expected*, says nothing about load, and
 * should not be logged as a server fault.
 */
export class AdmissionAbortedError extends Error {
  constructor(message = "Admission was aborted before a slot came free") {
    super(message);
    // Matched by name rather than with `instanceof`, so a reader can classify
    // it without importing this module — the same arrangement
    // `AdvisoryLockTimeoutError` already has.
    this.name = "AdmissionAbortedError";
  }
}

/** A caller that queued for a slot longer than its own budget allowed. */
export class AdmissionTimeoutError extends Error {
  /** What the caller was willing to wait, in ms — for the log line. */
  readonly waitedMs: number;

  constructor(waitedMs: number) {
    super(`Waited ${waitedMs}ms for admission without a slot coming free`);
    this.name = "AdmissionTimeoutError";
    this.waitedMs = waitedMs;
  }
}

/**
 * Names of every refusal that means "this caller was not admitted", rather than
 * the work itself failing.
 *
 * Matched by name rather than by class, which is what lets a reader of this
 * predicate stay free of runtime imports. TheLabX's set carries a third,
 * `RequestBudgetExhaustedError` — the request ran out of safe lifetime before a
 * slot was ever taken — which joins this list when the request budget ports.
 */
const ADMISSION_REFUSALS = new Set([
  "AdmissionAbortedError",
  "AdmissionTimeoutError",
]);

/**
 * Whether an error is one of those refusals, rather than the work itself
 * failing.
 */
export function isAdmissionRefusal(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name } = error as { name?: unknown };
  return typeof name === "string" && ADMISSION_REFUSALS.has(name);
}

/** Whether an error is specifically the client-went-away half. */
export function isAdmissionAbort(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { name?: unknown }).name === "AdmissionAbortedError";
}

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
   *
   * `options` bounds the *queueing* and nothing else — see
   * {@link LimiterWaitOptions}. Omitted, this waits indefinitely, which is what
   * every background caller wants.
   */
  run<T>(fn: () => Promise<T>, options?: LimiterWaitOptions): Promise<T>;
  /**
   * Take a slot if one is free *right now*, or answer null — the non-queueing
   * half, for a caller that would rather shed than wait.
   *
   * {@link Limiter.run} is the right shape where waiting costs nothing but time.
   * It is the wrong shape for a caller already holding something that expires:
   * the manager leagues route has a streaming response open per request, so a
   * caller that queued would hold it through a wait the platform's own deadline
   * may end first — it sheds instead, and the manager sync admission built on
   * this is why (`shared/manager/sync-admission`).
   *
   * Acquire and answer are one synchronous step, which is the property that
   * makes the bound hold: a check followed by an `await` followed by a
   * reservation is two requests both passing the check.
   *
   * The returned release is **idempotent** — called twice it does nothing the
   * second time. A `finally` that can run on two paths is the ordinary way a
   * release doubles up, and a doubled release does not merely miscount, it
   * *widens* the bound permanently, which is the same failure as a leaked slot
   * wearing the opposite sign.
   */
  tryAcquire(): (() => void) | null;
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
 * One caller queued for a slot.
 *
 * A record rather than the bare `resolve` this used to hold, because a queue
 * whose entries can be *cancelled* needs somewhere to say so: `settled` is the
 * single flag every one of the three endings checks and sets, which is what
 * makes cleanup idempotent under a permit-release, an abort and a timeout
 * arriving in any order.
 */
type Waiter = {
  /** Take the counted slot `release` just transferred. */
  grant: () => void;
  /** Whether this wait has already ended, however it ended. */
  settled: boolean;
};

/**
 * A counting semaphore with a FIFO queue.
 *
 * FIFO because the alternative is starvation with no symptom: a request-driven
 * sync's requests arrive in bursts while a background loop's are a steady
 * trickle, so a LIFO or unordered queue would let a busy page indefinitely
 * defer a tick that had been waiting since before it started.
 */
export function createLimiter(limit: number): Limiter {
  const max = Math.max(1, Math.trunc(limit));
  const waiting: Waiter[] = [];
  let active = 0;
  let peak = 0;

  const take = () => {
    active += 1;
    if (active > peak) peak = active;
  };

  /**
   * Hand the slot to the next waiter still waiting, or give it back.
   *
   * **The slot is transferred rather than freed and re-taken**, which is what
   * keeps {@link Limiter.tryAcquire} from stealing it. Decrementing here and
   * letting the resumed caller increment leaves a synchronous window — the
   * waiter is resolved but its continuation is still a microtask away — in which
   * `active` reads below `max` and a non-queueing caller walks straight through,
   * putting `max + 1` in flight the moment the waiter wakes. Kept counted, the
   * slot belongs to the waiter from the instant it is shifted.
   *
   * **A settled waiter is skipped rather than handed the slot**, which is the
   * belt to the cancellation path's braces: a cancelled waiter splices itself
   * out of the queue, so this loop should never see one, and if it ever does the
   * slot goes to the next real caller instead of being dropped on the floor —
   * the one failure mode of cancellation that would tighten the bound
   * permanently.
   */
  const release = () => {
    let next = waiting.shift();
    while (next && next.settled) next = waiting.shift();
    // Resumed rather than run here, so the slot handoff cannot recurse through
    // a long queue on one stack.
    if (next) next.grant();
    else active -= 1;
  };

  /**
   * Run `fn` on a slot this caller is already counted for, and give it back
   * however `fn` settles.
   *
   * `fn` is invoked **synchronously** by the `await` below, which is a property
   * callers rely on: a limiter with room must not defer the work it admits by a
   * microtask, or a caller that starts a job and then interacts with it in the
   * same turn finds it has not begun.
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

  /**
   * Queue for a counted slot, or reject with the reason the wait ended.
   *
   * Reached only when there is no room, so it never has a synchronous path to
   * preserve — which is what lets the cancellation live entirely in here and
   * leaves {@link runAdmitted} exactly as it was.
   */
  const queue = (options?: LimiterWaitOptions): Promise<void> => {
    const signal = options?.signal;
    const maxWaitMs = options?.maxWaitMs;
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const waiter: Waiter = { settled: false, grant: () => {} };

      // Idempotent, and every path goes through it — the three ways this wait
      // can end (granted, aborted, timed out) can all be racing, and a second
      // settle is either a double-resolve or, worse, a slot released twice.
      const settle = (): boolean => {
        if (waiter.settled) return false;
        waiter.settled = true;
        if (timer !== null) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        return true;
      };

      waiter.grant = () => {
        // The slot is already counted by `release`; nothing to take here.
        if (settle()) resolve();
      };

      const cancel = (error: Error) => {
        if (!settle()) return;
        // Removed from the queue as it is cancelled, so `release` can never
        // hand a permit to a caller that has stopped waiting for one.
        const index = waiting.indexOf(waiter);
        if (index >= 0) waiting.splice(index, 1);
        reject(error);
      };

      function onAbort() {
        cancel(new AdmissionAbortedError());
      }

      if (typeof maxWaitMs === "number" && Number.isFinite(maxWaitMs)) {
        const budget = Math.max(0, maxWaitMs);
        timer = setTimeout(() => cancel(new AdmissionTimeoutError(budget)), budget);
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      waiting.push(waiter);
    });
  };

  return {
    run<T>(fn: () => Promise<T>, options?: LimiterWaitOptions): Promise<T> {
      // Refused before a slot is taken, not after: a request whose client has
      // already gone should not start the work at all, and admitting it would
      // spend a permit on an answer with nobody to receive it.
      if (options?.signal?.aborted) {
        return Promise.reject(new AdmissionAbortedError());
      }
      // Queued callers are handed a slot that is already counted (see
      // `release`), so only the caller that finds room takes one for itself —
      // and it does so *synchronously*, which is why this is not an `async`
      // function. A rejection from the queue means no slot was ever held, so
      // there is nothing to release.
      if (active < max) {
        take();
        return runAdmitted(fn);
      }
      return queue(options).then(() => runAdmitted(fn));
    },
    tryAcquire() {
      // Waiters count against `max` from the moment they are handed a slot, so
      // this also declines while the queue is draining — a caller that sheds
      // must never jump a caller that is waiting.
      if (active >= max) return null;
      take();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release();
      };
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
