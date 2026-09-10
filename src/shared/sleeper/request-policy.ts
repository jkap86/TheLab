/**
 * What a Sleeper request is *for*, and therefore how long it may take.
 *
 * **Every bound the limiter and the HTTP client already had was reachable and
 * unreached.** `LimiterWaitOptions` has carried `signal` and `maxWaitMs` since
 * the limiter landed, and `http.get` has carried `signal`, `timeoutMs` and
 * `retries` since it replaced axios — and `sleeperGet`, the one function every
 * Sleeper call in this process passes through, took none of them. So the
 * queue was unbounded and the ladder was 30s × 4 for everybody, which is one
 * policy wearing two jobs:
 *
 * - a **crawl tick** or a **players refresh** should queue as long as it takes
 *   and re-dial a flaky upstream several times, because nothing is waiting on
 *   it and the alternative is a corpus that stops being refreshed;
 * - a **page** should not. A reader's request is behind a platform deadline the
 *   process cannot see — Heroku's router gives up at 30 seconds — so an
 *   interactive request that queues 40 seconds behind a crawl batch and then
 *   spends two minutes retrying is not slow, it is work for an answer nobody
 *   will receive, holding a pooled connection and a permit while it happens.
 *
 * Two named policies rather than numbers at call sites, which is the whole
 * point of the file: a timeout spelled where it is used is a number nobody can
 * audit, and the two questions this app actually asks are *is anybody waiting
 * for this* and *may it be given up on*.
 *
 * **Nothing here is a cancellation policy for durable work.** A signal reaches
 * a Sleeper read only where the caller puts one, and
 * {@link withBackgroundSleeper} drops the ambient one outright — see its own
 * note, and `syncManagerLeagues`, which is the case it was written for.
 *
 * Pure but for `node:async_hooks`, and imported relatively with a `.ts`
 * extension so Node's own runner can drive it — the rule `sync-admission.ts`
 * follows to `../sleeper/limiter.ts`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Which of the two questions above a request answers. */
export type SleeperRequestClass = "interactive" | "background";

/**
 * The whole budget one Sleeper request runs under.
 *
 * Every field is a *ceiling*, and on an idle process none of them is reached:
 * the limiter is a counter increment, the attempt resolves in tens of
 * milliseconds and neither the retry count nor the deadline is consulted.
 */
export type SleeperRequestPolicy = {
  /** For a log line, and for {@link isInteractive}. */
  readonly requestClass: SleeperRequestClass;
  /**
   * The longest this request will *queue* for a Sleeper slot, in ms.
   *
   * Undefined means "as long as it takes", which is the right answer for a
   * background loop and the wrong one for anything holding a response open.
   * See {@link LimiterWaitOptions}, which is what this becomes.
   */
  readonly maxWaitMs?: number;
  /** Per-attempt ceiling, in ms — `http.get`'s `timeoutMs`. */
  readonly timeoutMs: number;
  /** Attempts after the first. Zero disables retrying. */
  readonly retries: number;
  /**
   * The longest the whole HTTP ladder may take, in ms — attempts *and* the
   * backoffs between them.
   *
   * **This is the field `timeoutMs` and `retries` cannot express between
   * them.** Four attempts at 30 seconds is two minutes of a request's life
   * before anything gives up, and neither number says so; a reader auditing
   * either one in isolation sees a reasonable figure. Undefined means the
   * ladder is bounded only by its own arithmetic, which is what a background
   * loop wants.
   */
  readonly deadlineMs?: number;
  /**
   * The caller's own cancellation, ending both the queueing and the ladder.
   *
   * **Only ever what a caller passed in.** An ambient policy carries one only
   * where a scope was opened with one, and that scope is a promise about
   * everything under it — see {@link withInteractiveSleeper}.
   */
  readonly signal?: AbortSignal;
};

/**
 * A request a reader is waiting on: a page, a card being opened, a lookup.
 *
 * **Sized against the platform rather than against Sleeper.** Heroku's router
 * abandons a request at 30 seconds, so the arithmetic that matters is the worst
 * case a single Sleeper read can add to a handler: 4s of queueing plus a 12s
 * ladder is 16, which leaves a route its Postgres reads, its solve and its
 * serialisation inside the deadline. Sleeper answers these documents in tens of
 * milliseconds when it is healthy; every number here is a ceiling for when it
 * is not.
 *
 * **One retry, not three.** A second attempt covers the single dropped
 * connection that is most of what retrying is for; a third and a fourth are
 * three more seconds each spent discovering that an upstream having a bad
 * minute is still having one, which the reader pays for and the next request
 * pays for again.
 */
export const INTERACTIVE_SLEEPER_POLICY: SleeperRequestPolicy = {
  requestClass: "interactive",
  maxWaitMs: 4_000,
  timeoutMs: 8_000,
  retries: 1,
  deadlineMs: 12_000,
};

/**
 * A request nobody is waiting on: a crawl tick, a scheduled refresh, a sync
 * whose answer is rows in Postgres rather than a response.
 *
 * **These numbers are exactly what every Sleeper request in this process used
 * to run under** — `DEFAULT_TIMEOUT_MS` and `DEFAULT_RETRIES`, and no queue
 * bound at all — which is deliberate: this half of the split changes nothing,
 * so the only behaviour that moved is the half that was wrong. A background
 * caller *should* wait its turn behind a reader and *should* re-dial a flaky
 * upstream, because the cost of giving up is a league that goes stale for a
 * whole TTL and the cost of waiting is nothing anybody can see.
 */
export const BACKGROUND_SLEEPER_POLICY: SleeperRequestPolicy = {
  requestClass: "background",
  timeoutMs: 30_000,
  retries: 3,
};

/** Whether a policy is the reader-facing one. */
export const isInteractive = (policy: SleeperRequestPolicy): boolean =>
  policy.requestClass === "interactive";

/**
 * The ambient policy, on `globalThis` for {@link sleeperLimiter}'s reason: a
 * route bundle carrying its own copy of this module would get its own storage,
 * and a scope opened through one would be invisible to a `sleeperGet` reached
 * through the other. The symptom would be a route that declared itself
 * interactive and ran on the background budget anyway.
 */
const STORAGE_KEY = Symbol.for("thelab.sleeper.requestPolicy");
const scope = globalThis as typeof globalThis & {
  [STORAGE_KEY]?: AsyncLocalStorage<SleeperRequestPolicy>;
};
const storage = (): AsyncLocalStorage<SleeperRequestPolicy> =>
  (scope[STORAGE_KEY] ??= new AsyncLocalStorage<SleeperRequestPolicy>());

/** The policy in force here, or undefined outside every scope. */
export function currentSleeperPolicy(): SleeperRequestPolicy | undefined {
  return storage().getStore();
}

/** Run `fn` with `policy` as the default for every Sleeper read under it. */
export function withSleeperRequests<T>(
  policy: SleeperRequestPolicy,
  fn: () => T,
): T {
  return storage().run(policy, fn);
}

/**
 * Declare that everything under here is answering a reader.
 *
 * This is what a route handler wraps its body in, and the reason it is a scope
 * rather than an argument is that the reads are five modules down: a page's
 * Sleeper traffic reaches `sleeperGet` through `getActiveSeason`,
 * `resolveManagerUser`, a projections span and a scoreboard, none of which has
 * any business knowing who asked.
 *
 * **`signal` is a promise about every read in the scope**, so pass one only
 * where every one of them is this request's own. Most are not: the projections
 * span, the week's stats, the NFL state and the KeepTradeCut boards are all
 * held in process for other readers, so a browser navigating away would reject
 * a promise other requests are already awaiting. Durable work started from
 * inside a scope drops it — see {@link withBackgroundSleeper} — but a shared
 * *read* has no such marker, which is why this is opt-in and rare.
 */
export function withInteractiveSleeper<T>(
  fn: () => T,
  options: { signal?: AbortSignal } = {},
): T {
  const policy: SleeperRequestPolicy = options.signal
    ? { ...INTERACTIVE_SLEEPER_POLICY, signal: options.signal }
    : INTERACTIVE_SLEEPER_POLICY;
  return withSleeperRequests(policy, fn);
}

/**
 * Declare that everything under here outlives whoever asked for it.
 *
 * **It is the escape from an interactive scope, and that is its whole job.**
 * The manager sync, the per-league refresh and the history backfill are all
 * started from inside a request and none of them is answering it: what they
 * produce is rows in Postgres that the next reader — and the crawler, and every
 * other tab — reads. A cold sync abandoned because one browser navigated away
 * throws away the Sleeper budget already spent and leaves the next visitor to
 * start over, and a partial one stamps `attempt_at` and `synced_at` for a graph
 * that is neither cleanly written nor cleanly failed. So those functions open
 * this scope themselves rather than trusting a caller to remember: the ambient
 * budget is replaced *and the ambient signal is dropped*, which is the one line
 * that makes a browser disconnect unable to reach them.
 */
export function withBackgroundSleeper<T>(fn: () => T): T {
  return withSleeperRequests(BACKGROUND_SLEEPER_POLICY, fn);
}

/** What a caller may say about one request, over and above the scope it is in. */
export type SleeperRequestOptions = {
  /**
   * The class this read belongs to, where the ambient scope is wrong or absent.
   *
   * A name rather than a policy object at nearly every call site: the two
   * policies are the vocabulary, and a call site assembling its own is the
   * scattered-timeout problem this file exists to prevent. A whole policy is
   * accepted for the one caller that genuinely has one to hand — a test.
   */
  policy?: SleeperRequestClass | SleeperRequestPolicy;
  /** This read's own cancellation. See {@link withInteractiveSleeper}. */
  signal?: AbortSignal;
  /** Overrides, for a caller whose read is genuinely unlike its class. */
  maxWaitMs?: number;
  timeoutMs?: number;
  retries?: number;
  deadlineMs?: number;
};

const named = (name: SleeperRequestClass): SleeperRequestPolicy =>
  name === "interactive"
    ? INTERACTIVE_SLEEPER_POLICY
    : BACKGROUND_SLEEPER_POLICY;

/**
 * The budget one call runs under: its own options over the scope it is in over
 * the background default.
 *
 * **The default is the background policy and not the interactive one**, which
 * is the opposite of what a reader might expect and is the same call
 * `processRole` makes: the honest answer to "nothing said" is the behaviour the
 * app already had. A route that forgets to declare itself is as slow as it was
 * yesterday; a *background* path that lost its declaration under the other
 * default would start giving up on work nothing else will retry, which is a new
 * failure rather than an old one.
 *
 * Field by field rather than by spreading the options wholesale, so an
 * explicitly-passed `undefined` cannot erase a policy's own value.
 */
export function resolveSleeperPolicy(
  options: SleeperRequestOptions | undefined,
  ambient: SleeperRequestPolicy | undefined = currentSleeperPolicy(),
): SleeperRequestPolicy {
  const base =
    options?.policy === undefined
      ? (ambient ?? BACKGROUND_SLEEPER_POLICY)
      : typeof options.policy === "string"
        ? named(options.policy)
        : options.policy;

  if (!options) return base;
  const { signal, maxWaitMs, timeoutMs, retries, deadlineMs } = options;
  if (
    signal === undefined &&
    maxWaitMs === undefined &&
    timeoutMs === undefined &&
    retries === undefined &&
    deadlineMs === undefined
  ) {
    return base;
  }
  return {
    requestClass: base.requestClass,
    maxWaitMs: maxWaitMs ?? base.maxWaitMs,
    timeoutMs: timeoutMs ?? base.timeoutMs,
    retries: retries ?? base.retries,
    deadlineMs: deadlineMs ?? base.deadlineMs,
    signal: signal ?? base.signal,
  };
}
