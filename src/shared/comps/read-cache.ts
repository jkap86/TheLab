/**
 * Key and policy for the comps pool cache — the `manager/read-cache` split:
 * the cache itself lives beside the read (`pool.ts`), and this module is pure
 * so the key can be tested with nothing behind it.
 */

/**
 * Bump when the pool row's shape or the catalogue's stat keys change, so a
 * process holding yesterday's shape doesn't serve it under today's reader.
 */
export const COMPS_POOL_VERSION = 2;

/**
 * How long an assembled season pool is worth reusing, and how many are kept.
 *
 * Fifteen minutes because everything under it moves slower: the stats sync is
 * weekly in season, KTC daily, and the crawled drafts drip in on the crawler's
 * own tick. The client's result stale time (five minutes) sits deliberately
 * below it — a stale client read costs a request this answers warm.
 *
 * **The bound is 32 and must stay above the count of stored seasons.** The
 * pool deepens by one season a year with no code change, and every season is
 * read on every request (the subject's comps span all of them) — a cap the
 * working set outgrows would evict and rebuild a season per request, which is
 * cache churn wearing a cache's name. 32 is three decades of headroom.
 */
export const COMPS_POOL_CACHE = {
  name: "comps-pool",
  ttlMs: 15 * 60 * 1000,
  max: 32,
} as const;

/**
 * One season's pool. The version is in the key rather than beside the cache so
 * a bump is a miss, not a flush mechanism someone has to remember to call.
 */
export function compsPoolCacheKey(season: string): string {
  return JSON.stringify([season, COMPS_POOL_VERSION]);
}
