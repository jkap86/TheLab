/**
 * {@link BoundedCache} with the one thing it deliberately does not do: **two
 * callers who miss the same key at the same time compute once.**
 *
 * That note on `BoundedCache` is still right about what it was written for — a
 * page of trades resolving a few hundred player names, where a doubled miss is
 * one cheap lookup and keying a promise is more machinery than the value is
 * worth. It stops being right the moment the value behind a key is *seconds of
 * work*: the ADP board is an aggregate over ~1.5M draft picks, and a manager's
 * ranks are a lineup solve per team per remaining week across every league they
 * play in. There, a cold key with ten readers on it is ten copies of the same
 * expensive thing, each holding its own pool connection while it runs — which is
 * the shape of every outage `shared/db/budget` exists to bound, arrived at from
 * the other end.
 *
 * So this holds two maps rather than one:
 *
 *   - the **resolved** half is a `BoundedCache`, unchanged — bounded, LRU-ish,
 *     TTL'd, and the reason a hit is free;
 *   - the **in-flight** half is `key → Promise`, which is what makes the first
 *     miss the *only* miss until it settles.
 *
 * Four rules hold it up, and each replaces a way of getting this wrong:
 *
 *   - **A rejection is never cached, and it never lingers.** The in-flight entry
 *     is removed on failure as well as on success, so the next caller retries
 *     rather than inheriting a failure it did not cause. A cached rejection is
 *     the version of this that turns one database blip into a TTL-long outage.
 *   - **The in-flight entry is deleted by identity.** A `clear()` (a test, a
 *     sync that knows it has invalidated everything) can start a second compute
 *     under a key the first is still running under; deleting unconditionally
 *     would have the older one evict the newer one's entry and un-coalesce
 *     everybody waiting on it.
 *   - **`compute` is invoked inside the promise chain**, so a function that
 *     throws synchronously rejects the shared promise like any other failure
 *     rather than escaping past the bookkeeping and leaving a key that never
 *     clears.
 *   - **The in-flight map is not separately bounded, and does not need to be.**
 *     An entry lives exactly as long as the work behind it, so its size is the
 *     number of distinct expensive reads actually in flight — which is bounded
 *     by the pool and the admission limits upstream of it, not by anything a
 *     cache could add.
 *
 * It is per *process*: several instances each hold their own, which is correct
 * rather than merely acceptable — Postgres stays the source of truth, and the
 * TTLs here are all shorter than the syncs writing underneath them, so the worst
 * a second process costs is a second computation of an answer that is about to
 * expire anyway. Nothing here needs Redis, and adding it would trade an
 * in-process map for a network hop on the hot path.
 *
 * `V` must not be `undefined`: the resolved half reports a miss that way. Every
 * caller here stores an object.
 */

import { BoundedCache } from "./bounded-cache.ts";

/** What a `read` did, for the debug counter below. */
export type CacheOutcome =
  /** Answered from the resolved half. */
  | "hit"
  /** Nothing stored and nothing running: this caller computes. */
  | "miss"
  /** A compute for this key was already running: this caller waits on it. */
  | "coalesced";

export type TtlPromiseCacheOptions = {
  /** Resolved entries kept before the least recently read is evicted. */
  max: number;
  /** How long a resolved entry answers for. */
  ttlMs: number;
  /** Log prefix for the debug line — e.g. `"adp"`. */
  name: string;
  /**
   * Called on every read with what it did. Defaults to a line on stdout when
   * `CACHE_DEBUG=on`, and to nothing otherwise: these are the hottest reads in
   * the app, so a line per request is a production log nobody can read past.
   */
  onOutcome?: (outcome: CacheOutcome, key: string) => void;
};

export class TtlPromiseCache<V extends object> {
  private readonly resolved: BoundedCache<V>;
  private readonly pending = new Map<string, Promise<V>>();
  private readonly name: string;
  private readonly onOutcome: (outcome: CacheOutcome, key: string) => void;

  constructor({ max, ttlMs, name, onOutcome }: TtlPromiseCacheOptions) {
    this.resolved = new BoundedCache<V>(max, ttlMs);
    this.name = name;
    this.onOutcome = onOutcome ?? defaultOutcomeLog(name);
  }

  /**
   * The cached value for `key`, computing it at most once across every caller
   * that asks while it is being computed.
   *
   * `options.ttlMs` overrides the cache's own TTL **for the entry this call
   * stores**, for a cache whose keys age at different speeds — see
   * `BoundedCache.set`. It is read only on the computing caller's path, which
   * is the honest reading: a caller that coalesces onto a computation already
   * running is asking for that value, and the entry's lifetime is a fact about
   * the value rather than about who happened to ask for it first.
   */
  read(
    key: string,
    compute: () => Promise<V>,
    options?: { ttlMs?: number },
  ): Promise<V> {
    const hit = this.resolved.get(key);
    if (hit !== undefined) {
      this.onOutcome("hit", key);
      return Promise.resolve(hit);
    }

    const inFlight = this.pending.get(key);
    if (inFlight) {
      this.onOutcome("coalesced", key);
      return inFlight;
    }

    this.onOutcome("miss", key);
    // `compute` is called inside the executor so a synchronous throw becomes a
    // rejection of *this* promise — the one the bookkeeping below is attached to.
    const promise = (async () => compute())().then(
      (value) => {
        if (this.settle(key, promise)) this.resolved.set(key, value, options);
        return value;
      },
      (error: unknown) => {
        // Deliberately not stored: the next caller retries against a database
        // that may well have recovered.
        this.settle(key, promise);
        throw error;
      },
    );
    this.pending.set(key, promise);
    return promise;
  }

  /** What is stored for `key` right now, without computing anything. */
  peek(key: string): V | undefined {
    return this.resolved.get(key);
  }

  /**
   * Drop one key, for a caller that has just rewritten what is behind it.
   *
   * **Both halves, which is what makes it an invalidation rather than a nudge.**
   * Dropping the resolved entry alone would leave a computation that started
   * before the write still holding the key: it reads the old rows, settles, and
   * stores them for a full TTL — precisely the staleness this call exists to
   * end, arriving a moment *after* it. Retiring the in-flight entry too makes
   * `settle` report that something newer owns the key, so that computation still
   * answers the callers already waiting on it (they asked before the write) and
   * simply does not store what it read.
   *
   * The next reader misses and recomputes, which is the point.
   */
  forget(key: string): void {
    this.resolved.delete(key);
    this.pending.delete(key);
  }

  /** For tests, and for a sync that knows it has invalidated everything. */
  clear(): void {
    this.resolved.clear();
    this.pending.clear();
  }

  /** Resolved entries held. */
  get size(): number {
    return this.resolved.size;
  }

  /** Computations running right now. */
  get inFlight(): number {
    return this.pending.size;
  }

  /** This cache's name, for a caller that logs about it. */
  get label(): string {
    return this.name;
  }

  /**
   * Retire an in-flight entry, reporting whether it was still the live one.
   *
   * False means a `clear()` landed while this computation was running and
   * something newer now owns the key — so the caller must neither delete that
   * newer entry nor store its own answer over it. Guarding the *store* as well
   * as the delete is what makes `clear()` mean "everything in flight is
   * invalidated too" rather than "invalidated until the slowest one lands".
   */
  private settle(key: string, promise: Promise<V>): boolean {
    if (this.pending.get(key) !== promise) return false;
    this.pending.delete(key);
    return true;
  }
}

/**
 * The default reporter: silent unless `CACHE_DEBUG=on`.
 *
 * Read once per cache rather than per call, so the common case is an empty
 * function the engine can inline away rather than an environment lookup on the
 * hot path.
 */
function defaultOutcomeLog(
  name: string,
): (outcome: CacheOutcome, key: string) => void {
  if (process.env.CACHE_DEBUG !== "on") return () => {};
  return (outcome, key) => {
    // Truncated: an ADP key carries every bound parameter, and a league scope
    // among them can be thousands of ids.
    const short = key.length > 160 ? `${key.slice(0, 160)}…` : key;
    console.log(`[cache:${name}] ${outcome} ${short}`);
  };
}
