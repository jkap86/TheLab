import type { CompsEnrichment } from "./fields.ts";

/**
 * Keys and policies for the comps read caches — the `manager/read-cache` split:
 * the caches themselves live beside the reads (`pool.ts`), and this module is
 * pure so every key can be tested with nothing behind it.
 *
 * **There are two pool caches rather than one, and the split is the point.** A
 * season's pool used to be one entry holding stat lines, profiles, KTC, KTC
 * history, ADP and the draft crosswalk, so a reader who nudged a KTC weight
 * shared an entry with one who never looked at the market, and a cold entry was
 * six queries whatever board asked for it. Now the pool is the season's own
 * stats and profiles — one entry every board reads — and each market dataset is
 * an entry of its own per season, loaded only where a board weighs a field that
 * names it.
 *
 * **What is deliberately *not* cached is the two merged.** A composed corpus is
 * a fresh row and a fresh `values` object for every player-season on file, per
 * combination of datasets in use, which is the same trade `withWindowValues`
 * already refuses: the merge is a `map` over rows that are already in memory,
 * so caching it would multiply the process's resident corpus to save CPU it can
 * spare — and it would give the corpus-identity memo above it
 * (`withCareerValues`) a different corpus per board to hold in one slot.
 */

/**
 * Bump when the pool row's shape or the catalogue's stat keys change, so a
 * process holding yesterday's shape doesn't serve it under today's reader.
 *
 * 3: the derived usage shares and KTC history fields joined `values`. The
 * career fields did not — they are derived at read time (`withCareerValues`),
 * so cached rows never carry them.
 * 4: the vocabulary-gated air-yards fields joined `values`.
 * 5: NFL draft capital joined `values`, and the pick itself joined the row as
 * metadata beside `position`/`team`.
 * 6: the market datasets left the pool for entries of their own, so a cached
 * row now answers null for every field a board did not ask to load.
 */
export const COMPS_POOL_VERSION = 6;

/**
 * How long an assembled season pool is worth reusing, and how many are kept.
 *
 * Fifteen minutes because everything under it moves slower: the stats sync is
 * weekly in season, KTC daily, and the crawled drafts drip in on the crawler's
 * own tick. The client's result stale time (five minutes) sits deliberately
 * below it — a stale client read costs a request this answers warm.
 *
 * **The bound must stay above the count of stored seasons.** Every season is
 * read on every request (the subject's comps span all of them) — a cap the
 * working set outgrows would evict and rebuild a season per request, which is
 * cache churn wearing a cache's name. The stats archive reaches to
 * `STATS_ARCHIVE_FLOOR_SEASON` (2000), so the corpus can hold ~27 seasons the
 * day the backfill finishes; 64 keeps decades of headroom past that.
 */
export const COMPS_POOL_CACHE = {
  name: "comps-pool",
  ttlMs: 15 * 60 * 1000,
  max: 64,
} as const;

/**
 * One dataset for one season — a KTC snapshot, a KTC history aggregate, an ADP
 * average or the draft crosswalk.
 *
 * The same TTL as the pool it feeds, since these *are* what a pool was made of;
 * the bound is four datasets' worth of seasons rather than one, and generous
 * because each entry is a map of numbers per player rather than a corpus of
 * rows. An entry is only ever created for a dataset some board actually
 * weighted, so the four multiply the *used* seasons, not the stored ones.
 */
export const COMPS_ENRICHMENT_CACHE = {
  name: "comps-enrichment",
  ttlMs: COMPS_POOL_CACHE.ttlMs,
  max: 128,
} as const;

/**
 * The picker's index — every player with stored stats and the seasons they have
 * them in.
 *
 * Longer than the pools, and it is the *client* that sets the floor: the picker
 * list is fresh in the browser for fifteen minutes, and the house rule is that
 * the server holds an answer longer than the browser calls it fresh (by half
 * again at least), or every revalidation is a guaranteed miss. Three times it,
 * which is affordable here because what is underneath moves weekly at its
 * fastest — a name appears when a player's first stat line lands. One entry:
 * the index takes no parameters.
 */
export const COMPS_PLAYER_INDEX_CACHE = {
  name: "comps-player-index",
  ttlMs: 45 * 60 * 1000,
  max: 1,
} as const;

/**
 * One season's pool. The version is in the key rather than beside the cache so
 * a bump is a miss, not a flush mechanism someone has to remember to call.
 *
 * **It names no dataset, which is what makes the pool shared**: a reader
 * weighting KTC and a reader on the defaults read one entry for a season's
 * stats between them, so a market weight can never be why a season's stat lines
 * are read again.
 */
export function compsPoolCacheKey(season: string): string {
  return JSON.stringify([season, COMPS_POOL_VERSION]);
}

/** One dataset for one season. */
export function compsEnrichmentCacheKey(
  enrichment: CompsEnrichment,
  season: string,
): string {
  return JSON.stringify([enrichment, season, COMPS_POOL_VERSION]);
}
