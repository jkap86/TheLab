/**
 * A bounded, TTL'd map — the shape an in-process cache in this app is built
 * from.
 *
 * **Why a cache at all.** Each caller has its own version of one answer: a page
 * of trades names a few hundred players and the next page names mostly the same
 * ones, and "which leagues are this manager's" is a query per request that
 * changes on the sync's clock rather than on the reader's. Held here, that work
 * is done once per process per TTL however many requests name it.
 *
 * **Why bounded.** The obvious shape — a plain `Map` — is an unbounded cache of
 * everything the process has ever been asked about, which on a long-running
 * server is a leak with a slow fuse. This keeps insertion order and evicts the
 * oldest entry past `max`, which is a good enough approximation of LRU for the
 * working sets here: they either fit, or the extra is a second reader's board,
 * in which case evicting the first is what you want.
 *
 * **Why a TTL as well.** These stand in front of tables the background syncs
 * replace — the players map daily, the league graph on its own TTL. Without an
 * expiry a process up for a week serves a week-old answer. Every TTL set on one
 * of these is shorter than the sync writing behind it, so a stale read costs a
 * query rather than a wrong answer.
 *
 * It is in `shared/util` rather than beside its first caller because more than
 * one concern uses it: `shared/trades/enrich` resolves a page's ids through it
 * and `shared/trades/circle` holds a resolved circle in one entry.
 * `shared/trades/cache` re-exports it under the name its own consumers, their
 * tests among them, read it by.
 *
 * **Why a weight as well as a count.** An entry count is a bound on memory only
 * where the entries are the same size, and several of these hold answers that
 * are not: a resolved trade circle is a hundred ids for one reader and several
 * thousand for another, and a manager's league rows are a dozen leagues or a
 * hundred and thirteen. Two hundred of the small ones is nothing and two
 * hundred of the large ones is a heap this process cannot afford, so a cache
 * whose values vary that way takes `maxWeight` beside `max` and a `weigh`
 * function that says, cheaply and deterministically, how big one is.
 *
 * The weight is a *unit of its caller's own choosing* — rows, ids, nested
 * entries — never bytes, and deliberately never `JSON.stringify().length`:
 * measuring a value by serialising it costs more than the read it is standing
 * in front of. A cache whose values are uniform passes neither option and pays
 * nothing, which is every caller that was here before this.
 *
 * Note what it deliberately does *not* do: nothing here dedupes concurrent
 * misses, so two requests arriving together on a cold key both compute. That is
 * the right trade for a value this cheap to recompute and this awkward to key a
 * promise by; a caller that needs the other behaviour wants an advisory lock,
 * not a change here.
 */

type Entry<V> = { value: V; expires: number; weight: number };

/** The two optional halves of a bound that is not just a count. */
export type BoundedCacheOptions<V> = {
  /**
   * The most total weight held, in whatever unit {@link weigh} answers in.
   * Omitted, only {@link BoundedCache}'s entry count bounds the map.
   */
  maxWeight?: number;
  /**
   * How heavy one value is. Must be cheap — it runs on every write — and
   * deterministic, or the running total drifts from the entries it describes.
   * A caller that passes `maxWeight` without this weighs every entry 1, which
   * is the entry count again.
   */
  weigh?: (value: V) => number;
};

export class BoundedCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  // Declared and assigned rather than written as constructor parameter
  // properties, which is the one edit this file carries against TheLabX's copy:
  // `npm test` runs Node's own runner in strip-only mode, which erases types
  // without emitting anything, and a parameter property is a declaration that
  // has to be *emitted*. It fails to parse rather than failing a test.
  private readonly max: number;
  private readonly ttlMs: number;
  private readonly maxWeight: number;
  private readonly weigh: (value: V) => number;
  /** The sum of every stored entry's weight, maintained on every write. */
  private weight = 0;

  constructor(max: number, ttlMs: number, options: BoundedCacheOptions<V> = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.maxWeight = options.maxWeight ?? Infinity;
    this.weigh = options.weigh ?? (() => 1);
  }

  /** Drop one entry and take its weight off the running total. */
  private drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.weight -= entry.weight;
    this.entries.delete(key);
  }

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.drop(key);
      return undefined;
    }
    // Re-inserted so the iteration order the eviction below walks is recency
    // rather than first insertion — the difference between evicting the entry
    // nobody has wanted since it landed and evicting the one every page reads.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  /**
   * Store `value` under `key`, for `options.ttlMs` if the caller has an opinion
   * about this entry and the cache's own TTL otherwise.
   *
   * The lifetime is fixed at insertion rather than extended by reads, which is
   * deliberate: these caches stand in front of tables background syncs replace,
   * so an entry read every second must still go back to Postgres on the clock
   * its data moves on — a sliding expiry would let a popular key answer from a
   * snapshot indefinitely.
   */
  set(
    key: string,
    value: V,
    options?: { ttlMs?: number; weight?: number },
  ): void {
    const ttlMs = options?.ttlMs ?? this.ttlMs;
    this.drop(key);
    // A non-positive lifetime is an entry already expired at the moment it is
    // written: `get` would delete it unread, so storing it only holds a value in
    // memory and a slot against `max` that nothing can ever be answered from.
    if (ttlMs <= 0) return;
    const weight = options?.weight ?? this.weigh(value);
    // **An entry too heavy for the whole budget is not stored at all**, which
    // is the one arm that cannot be handled by eviction: trimming would empty
    // the cache and still be over, so either the loop never converges or one
    // pathological value is exempt from the bound it exceeds — which is the
    // unbounded map this class exists to not be. Refusing it costs its caller a
    // recompute, which is what a cache miss already is.
    if (weight > this.maxWeight) return;
    this.entries.set(key, { value, expires: Date.now() + ttlMs, weight });
    this.weight += weight;
    // A `while` rather than an `if` on both bounds: `max` can be lowered
    // between writes, and one write can put the total several entries over.
    // The entry just written is never the one evicted — it is last in insertion
    // order — so this always converges.
    while (
      this.entries.size > this.max ||
      (this.weight > this.maxWeight && this.entries.size > 1)
    ) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.drop(oldest.value);
    }
  }

  /**
   * Split `ids` into what is cached and what has to be fetched.
   *
   * The caller's half of the contract is that it must `set` every id it asked
   * about, **including the ones that came back with nothing** — a player id
   * Sleeper has no row for is an answer, and not caching it means every page
   * naming that id asks again.
   */
  partition(ids: readonly string[]): { hits: Map<string, V>; misses: string[] } {
    const hits = new Map<string, V>();
    const misses: string[] = [];
    for (const id of ids) {
      const hit = this.get(id);
      if (hit === undefined) misses.push(id);
      else hits.set(id, hit);
    }
    return { hits, misses };
  }

  /** Drop one key, for a caller that knows it has just been rewritten. */
  delete(key: string): void {
    this.drop(key);
  }

  /**
   * Drop every key `matches` accepts, and answer how many went.
   *
   * **For the caller that knows what it invalidated but not what it is keyed
   * by.** A league sync rewrites one league's rows, and the caches standing in
   * front of them are keyed variously by league id, by `league|season`, and by
   * `user:season:circle` — so "forget this league" is a predicate over keys
   * rather than a list of them, and the alternative is {@link clear}, which
   * throws away every *other* league's answers to protect one.
   *
   * A predicate rather than a prefix because the keys are not all
   * prefix-shaped: a circle's is keyed by the reader first and the season
   * third. Callers live in `shared/trades/invalidate`, which is where the
   * spelling of each key and the predicate that matches it sit side by side —
   * one place, so a key format and its invalidation cannot drift apart
   * silently.
   *
   * Iterating a copy of the keys rather than the live map: deleting during a
   * `Map` iteration is defined, but a snapshot costs one array of strings and
   * removes the question.
   */
  prune(matches: (key: string) => boolean): number {
    let dropped = 0;
    for (const key of [...this.entries.keys()]) {
      if (!matches(key)) continue;
      this.drop(key);
      dropped += 1;
    }
    return dropped;
  }

  /** For tests and for a sync that knows it has invalidated everything. */
  clear(): void {
    this.entries.clear();
    this.weight = 0;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Total held weight, in the caller's own unit. For tests and diagnostics. */
  get totalWeight(): number {
    return this.weight;
  }
}
