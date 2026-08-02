/**
 * A bounded, TTL'd map — the enrichment caches the trades route resolves its ids
 * through.
 *
 * **Why a cache at all.** A page of trades names a few hundred players, a
 * hundred-odd leagues and a few hundred managers, and the next page names mostly
 * the same ones: a season's vocabulary is named in its first pages and then
 * repeats. Under the old streaming route that was handled by three `Set`s held
 * for the life of one request, which worked because one request read the whole
 * season. Paginated, each page is its own request, so the same few thousand
 * lookups would be re-issued per page and per reader. Held here instead, a
 * player is priced once per process per TTL however many pages and readers name
 * him.
 *
 * **Why bounded.** The obvious shape — a plain `Map` keyed by id — is an
 * unbounded cache of every player, league and manager the process has ever been
 * asked about, which on a long-running server is a leak with a slow fuse.
 * {@link BoundedCache} keeps insertion order and evicts the oldest entry past
 * `max`, which is a good enough approximation of LRU for a working set this
 * shaped: the ids a season names are a fixed few thousand, so the cache either
 * holds all of them or is being asked about a second season, in which case
 * evicting the first season's is what you want anyway.
 *
 * **Why a TTL as well.** These read tables the background syncs replace — the
 * players cache daily, the KTC board daily, league settings on the crawl's
 * seasonal TTL. Without an expiry a process that has been up for a week is
 * serving a week-old name for a traded player. The TTLs below are shorter than
 * the syncs that write behind them, so a stale read costs one query rather than
 * a wrong answer.
 *
 * Negative results are cached too, and deliberately: an id nothing is stored for
 * is the *most* likely to be asked about repeatedly (a kicker KTC has never
 * priced appears in trades all season), and not caching the miss is how a cache
 * with a 95% hit rate still issues a query per page.
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

  /** For tests and for a sync that knows it has invalidated everything. */
  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Resolve `ids` through `cache`, fetching only what it doesn't hold.
 *
 * The shared body of all four lookups, which are otherwise the same eight lines
 * four times: partition, fetch the misses, record *every* miss (hit or empty),
 * merge. `fetch` returns a partial map — an id it has nothing for is simply
 * absent, and that absence is what gets cached as `null`.
 */
export async function cachedLookup<V>(
  cache: BoundedCache<V | null>,
  ids: readonly string[],
  fetch: (misses: string[]) => Promise<Map<string, V> | Record<string, V>>,
): Promise<Map<string, V>> {
  const { hits, misses } = cache.partition(ids);

  const resolved = new Map<string, V>();
  for (const [id, value] of hits) {
    if (value !== null) resolved.set(id, value);
  }

  if (misses.length > 0) {
    const fetched = await fetch(misses);
    const asMap =
      fetched instanceof Map ? fetched : new Map(Object.entries(fetched));
    for (const id of misses) {
      const value = asMap.get(id) ?? null;
      cache.set(id, value);
      if (value !== null) resolved.set(id, value);
    }
  }

  return resolved;
}
