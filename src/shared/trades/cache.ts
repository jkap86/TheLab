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
 * Ids currently being fetched, per cache.
 *
 * **This is the "nothing here dedupes concurrent misses" note in
 * `bounded-cache` answered where it belongs.** That note is right about the
 * cache: keying a promise by a *value* is awkward, and the class should not
 * grow a second lifecycle. But this function is keyed by id already — it
 * partitions a list of them — so the map fits here for free.
 *
 * What it buys is the cold-start case the trades route is shaped around. Two
 * readers arriving together on a board nobody has asked for since the last TTL
 * each miss the same few hundred players, the same leagues, the same rosters,
 * and each runs the query — so the *second* concurrent request costs a full set
 * of pool connections that answer questions already in flight. Held here, the
 * second joins the first's promise and takes no connection at all.
 *
 * A `WeakMap` on the cache, so a cache that goes out of scope takes its pending
 * map with it and no call site has to be changed to opt in.
 */
const pending = new WeakMap<object, Map<string, Promise<unknown>>>();

function pendingFor<V>(
  cache: BoundedCache<V | null>,
): Map<string, Promise<V | null>> {
  let map = pending.get(cache);
  if (!map) pending.set(cache, (map = new Map()));
  return map as Map<string, Promise<V | null>>;
}

/**
 * Resolve `ids` through `cache`, fetching only what it doesn't hold — and only
 * what is not already being fetched.
 *
 * The shared body of all four lookups, which are otherwise the same eight lines
 * four times: partition, fetch the misses, record *every* miss (hit or empty),
 * merge. `fetch` returns a partial map — an id it has nothing for is simply
 * absent, and that absence is what gets cached as `null`.
 *
 * **Three sets, not two**, since the single-flight above: what the cache holds,
 * what somebody else is already asking about, and what this call has to fetch.
 * The middle set is awaited rather than re-requested, so concurrent cold
 * readers issue one query between them instead of one each.
 *
 * A failed fetch rejects every caller waiting on it and leaves **nothing**
 * cached — the `memoize-manager-lookup` rule this codebase applies to every
 * memo: a database blip remembered for the TTL is an outage extended by the
 * mechanism meant to absorb one. The pending entries are cleared in a `finally`
 * so the next request starts clean.
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

  if (misses.length === 0) return resolved;

  const inFlight = pendingFor(cache);
  // **The joined promises are captured now, not looked up later.** The owner's
  // `finally` deletes its entries the moment its fetch settles, and this
  // function awaits them one at a time — so a joiner that re-read the map after
  // its first `await` would find the rest of its ids already gone and silently
  // resolve them to nothing. Holding the promise is what makes joining safe.
  const joined: [string, Promise<V | null>][] = [];
  const fresh: string[] = [];
  for (const id of misses) {
    const existing = inFlight.get(id);
    if (existing) joined.push([id, existing]);
    else fresh.push(id);
  }

  // This call's own share, registered *before* the await so a request arriving
  // in the same tick joins it rather than starting a second query.
  let own: Promise<Map<string, V>> | null = null;
  if (fresh.length > 0) {
    own = (async () => {
      const fetched = await fetch(fresh);
      return fetched instanceof Map
        ? fetched
        : new Map(Object.entries(fetched));
    })();

    for (const id of fresh) {
      const entry = own.then((map) => map.get(id) ?? null);
      // A rejection here is delivered to whoever awaits the entry below; this
      // keeps it from also being an unhandled rejection on the ids nobody
      // joined.
      entry.catch(() => {});
      inFlight.set(id, entry);
    }
  }

  try {
    if (own) {
      const map = await own;
      for (const id of fresh) {
        const value = map.get(id) ?? null;
        // Written only on success, which is what makes a failed fetch leave no
        // trace: the `finally` below removes the pending entries either way.
        cache.set(id, value);
        if (value !== null) resolved.set(id, value);
      }
    }

    for (const [id, entry] of joined) {
      // Somebody else's fetch. Awaited rather than re-asked, which is the whole
      // point — and awaited *individually*, so one id whose owner failed does
      // not cost this caller the ids that succeeded.
      const value = await entry.catch(() => null);
      if (value !== null) resolved.set(id, value);
    }
  } finally {
    for (const id of fresh) inFlight.delete(id);
  }

  return resolved;
}
