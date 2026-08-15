/**
 * A bounded, TTL'd map — the shape every in-process cache in this app is built
 * from.
 *
 * **Why a cache at all.** Each caller has its own version of one answer: a page
 * of trades names a few hundred players and the next page names mostly the same
 * ones, and an ADP board is a second's worth of aggregate over 1.9M picks that
 * is byte-identical for every reader who asks for the same population. Held
 * here, that work is done once per process per TTL however many requests name
 * it.
 *
 * **Why bounded.** The obvious shape — a plain `Map` — is an unbounded cache of
 * everything the process has ever been asked about, which on a long-running
 * server is a leak with a slow fuse. This keeps insertion order and evicts the
 * oldest entry past `max`, which is a good enough approximation of LRU for the
 * working sets here: they either fit, or the extra is a second season (or a
 * second reader's board), in which case evicting the first is what you want.
 *
 * **Why a TTL as well.** These stand in front of tables the background syncs
 * replace — the players cache daily, the KTC board daily, the crawled drafts on
 * the crawl's own TTL. Without an expiry a process up for a week serves a
 * week-old answer. Every TTL set on one of these is shorter than the sync
 * writing behind it, so a stale read costs a query rather than a wrong answer.
 *
 * It is in `shared/util` rather than beside its first caller because there are
 * two concerns using it now: `shared/trades/enrich` resolves a page's ids
 * through it, and `shared/manager/adp` holds a whole board in one entry.
 * `shared/trades/cache` re-exports it under the name its own consumers, their
 * tests among them, already read it by.
 *
 * Note what it deliberately does *not* do: nothing here dedupes concurrent
 * misses, so two requests arriving together on a cold key both compute. That is
 * the right trade for a value this cheap to recompute and this awkward to key a
 * promise by; a caller that needs the other behaviour wants an advisory lock,
 * not a change here.
 */


type Entry<V> = { value: V; expires: number };

export class BoundedCache<V> {
  private readonly entries = new Map<string, Entry<V>>();

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
  ) {}

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-inserted so the iteration order the eviction below walks is recency
    // rather than first insertion — the difference between evicting the entry
    // nobody has wanted since it landed and evicting the one every page reads.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
    // A `while` rather than an `if`: `max` can be lowered between writes, and a
    // single-step trim would then never converge.
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /**
   * Split `ids` into what is cached and what has to be fetched.
   *
   * The caller's half of the contract is that it must `set` every id it asked
   * about, **including the ones that came back with nothing** — see the note on
   * negative caching above.
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
    this.entries.delete(key);
  }

  /** For tests and for a sync that knows it has invalidated everything. */
  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
