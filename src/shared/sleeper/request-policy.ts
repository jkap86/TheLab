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
   * The instant the whole *request* runs out of Sleeper budget, epoch ms.
   *
   * **Every field above is a per-call ceiling; this is the one that is per
   * request**, and it is the difference between bounding one read and bounding
   * a handler. `deadlineMs` is read fresh by every `http.get`, so a route
   * making four sequential Sleeper reads was given four 12-second ladders — 48
   * seconds of a request whose platform deadline is 30. Minted once by
   * {@link withInteractiveSleeper} and clamped against by every read under it
   * ({@link remainingRequestBudgetMs}), it is what makes the four *share* one
   * budget rather than each getting their own.
   *
   * Undefined means there is no absolute ceiling, which is the right answer for
   * a background loop and the only one it ever gets: {@link
   * withBackgroundSleeper} replaces the whole policy, so durable work started
   * from inside a request never inherits the request's clock.
   */
  readonly expiresAt?: number;
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
 * A read refused because the request it belongs to has no Sleeper budget left.
 *
 * **The third admission refusal, and the one `limiter.ts` said would not be
 * needed.** That file's note argued `RequestBudgetExhaustedError` — TheLabX's
 * third name — was already said by {@link AdmissionTimeoutError} here, "because
 * the budget landed as `maxWaitMs` on the *wait* rather than as a clock a caller
 * carries around". {@link SleeperRequestPolicy.expiresAt} is that clock, so the
 * two are now different facts and a log line that could not tell them apart
 * would be reporting a request that gave up its own remaining time as a queue
 * that never came free. It is named in `ADMISSION_REFUSALS` all the same: it
 * means the same thing to a caller, which is that no request was made.
 */
export class SleeperBudgetExhaustedError extends Error {
  /** How far past the request's deadline this read was, in ms. */
  readonly overdueMs: number;

  constructor(overdueMs: number, what = "this Sleeper read") {
    super(
      `The request's Sleeper budget ran out ${overdueMs}ms before ${what}`,
    );
    // Matched by name rather than with `instanceof`, so `isAdmissionRefusal`
    // stays free of runtime imports — `limiter.ts`' own arrangement.
    this.name = "SleeperBudgetExhaustedError";
    this.overdueMs = overdueMs;
  }
}

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
 * The whole Sleeper budget one interactive *request* has, in ms.
 *
 * **The same number as the per-ladder deadline, deliberately, and the sameness
 * is the point.** Read alone, `deadlineMs` is "the longest one ladder may run";
 * read here it becomes "the longest every ladder in this request may run
 * *between them*". So the worst case a handler can add to the platform's own 30
 * seconds is the queue budget of its first read plus this — 16 seconds — where
 * before it was that figure *per read*, and a route making four sequential
 * Sleeper calls could spend 48.
 *
 * A separate, larger figure is what to reach for if a route is ever found that
 * genuinely needs several cold reads on a bad minute; nothing does today, and a
 * second knob nobody turns is a number nobody audits.
 */
export const INTERACTIVE_REQUEST_BUDGET_MS =
  INTERACTIVE_SLEEPER_POLICY.deadlineMs ?? 12_000;

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
  options: { signal?: AbortSignal; now?: () => number } = {},
): T {
  const now = options.now ?? Date.now;
  const ambient = currentSleeperPolicy();
  // **A nested interactive scope inherits the deadline rather than minting a
  // second one**, which is the whole invariant said in one branch: a handler is
  // the outermost interactive scope, and anything under it that re-declares the
  // class is describing the same request. Minting afresh would hand a route
  // that wrapped twice — or a helper that wrapped defensively — a fresh twelve
  // seconds per wrap, which is the multiplication `expiresAt` exists to stop.
  const expiresAt =
    ambient !== undefined &&
    isInteractive(ambient) &&
    ambient.expiresAt !== undefined
      ? ambient.expiresAt
      : now() + INTERACTIVE_REQUEST_BUDGET_MS;

  const policy: SleeperRequestPolicy = options.signal
    ? { ...INTERACTIVE_SLEEPER_POLICY, expiresAt, signal: options.signal }
    : { ...INTERACTIVE_SLEEPER_POLICY, expiresAt };
  return withSleeperRequests(policy, fn);
}

/**
 * How much of the request's absolute budget is left, or `Infinity` where the
 * policy has none.
 *
 * The one primitive every clamp below is built out of, so "how long may this
 * read take" has exactly one spelling. Never negative — an exhausted budget is
 * zero, and *how far past* is {@link SleeperBudgetExhaustedError.overdueMs}.
 */
export function remainingRequestBudgetMs(
  policy: SleeperRequestPolicy,
  now: number = Date.now(),
): number {
  if (policy.expiresAt === undefined || !Number.isFinite(policy.expiresAt)) {
    return Infinity;
  }
  return Math.max(0, policy.expiresAt - now);
}

/** Whether this request has already spent everything it had. */
export function requestBudgetExhausted(
  policy: SleeperRequestPolicy,
  now: number = Date.now(),
): boolean {
  return remainingRequestBudgetMs(policy, now) <= 0;
}

/** How far past its deadline a request is, in ms — 0 where it is not. */
export function requestBudgetOverdueMs(
  policy: SleeperRequestPolicy,
  now: number = Date.now(),
): number {
  if (policy.expiresAt === undefined || !Number.isFinite(policy.expiresAt)) {
    return 0;
  }
  return Math.max(0, now - policy.expiresAt);
}

/**
 * The longest this read may *queue*, given both its class's budget and what is
 * left of the request's.
 *
 * `undefined` — wait as long as it takes — survives only where *both* are
 * unbounded, which is a background read and nothing else.
 */
export function queueBudgetMs(
  policy: SleeperRequestPolicy,
  now: number = Date.now(),
): number | undefined {
  const remaining = remainingRequestBudgetMs(policy, now);
  if (policy.maxWaitMs === undefined) {
    return Number.isFinite(remaining) ? remaining : undefined;
  }
  return Math.min(policy.maxWaitMs, remaining);
}

/**
 * The longest this read's whole HTTP ladder may run, given the same two.
 *
 * **Read after admission, never before.** The queue budget and the ladder
 * budget are spent one after the other out of one pot, so a ladder measured at
 * the moment the caller *joined the queue* would be handed time the queue has
 * since eaten — which is how `maxWaitMs + deadlineMs` comes to exceed the
 * request's own remaining budget. See `./request`, which calls this inside the
 * limiter's callback.
 */
export function ladderBudgetMs(
  policy: SleeperRequestPolicy,
  now: number = Date.now(),
): number | undefined {
  const remaining = remainingRequestBudgetMs(policy, now);
  if (policy.deadlineMs === undefined) {
    return Number.isFinite(remaining) ? remaining : undefined;
  }
  return Math.min(policy.deadlineMs, remaining);
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
 *
 * **The request's absolute deadline goes with them**, and that half is what
 * keeps a *shared* producer honest. Every in-process Sleeper cache populates
 * itself in here — see `sleeper/shared-wait` — so the work is done under a
 * policy belonging to nobody in particular, and neither class can shorten or
 * lengthen it for the other by happening to be the caller that arrived first.
 * The whole policy is replaced rather than edited, so there is no field an
 * interactive scope can leak through.
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
  /**
   * The request's absolute deadline, epoch ms — see
   * {@link SleeperRequestPolicy.expiresAt}.
   *
   * Almost never passed: a scope mints it and every read under that scope
   * inherits it, which is the whole reason it is a scope. It is here for a
   * caller that genuinely holds one — a test, and a durable path that wants to
   * say out loud that it has none.
   */
  expiresAt?: number;
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
  const { signal, maxWaitMs, timeoutMs, retries, deadlineMs, expiresAt } =
    options;
  if (
    signal === undefined &&
    maxWaitMs === undefined &&
    timeoutMs === undefined &&
    retries === undefined &&
    deadlineMs === undefined &&
    expiresAt === undefined
  ) {
    return base;
  }
  return {
    requestClass: base.requestClass,
    maxWaitMs: maxWaitMs ?? base.maxWaitMs,
    timeoutMs: timeoutMs ?? base.timeoutMs,
    retries: retries ?? base.retries,
    deadlineMs: deadlineMs ?? base.deadlineMs,
    // Carried rather than dropped, which is the field this merge is most
    // dangerous to forget: a read that passed any one override would otherwise
    // come out of here with no request deadline at all, and spend the class's
    // whole per-call budget however little of the request's was left.
    expiresAt: expiresAt ?? base.expiresAt,
    signal: signal ?? base.signal,
  };
}
