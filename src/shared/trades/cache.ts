/**
 * How the trades route resolves a page's ids without re-querying for names it
 * has already seen.
 *
 * The cache itself is {@link BoundedCache}, which moved to `shared/util` once
 * the ADP board became a second concern holding one — see that module for why
 * it is bounded and why it has a TTL. It is re-exported here because this
 * module's own consumers and tests already import it from this path.
 *
 * What is left that is genuinely this concern's is {@link cachedLookup} and the
 * habit it encodes: **negative results are cached too, and deliberately.** An id
 * nothing is stored for is the *most* likely to be asked about repeatedly (a
 * kicker KTC has never priced appears in trades all season), and not caching the
 * miss is how a cache with a 95% hit rate still issues a query per page.
 */

// Relative and extension-bearing, not the `@/shared/util` barrel: this module
// is tested, and an alias import breaks Node's runner — the same rule the pure
// modules follow. It also keeps the barrel's background-loop out of the graph.
import { BoundedCache } from "../util/bounded-cache.ts";

export { BoundedCache };

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
