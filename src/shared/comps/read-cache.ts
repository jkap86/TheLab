import { COMPS_ENRICHMENTS } from "./fields.ts";

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
 * Seasons the comps corpus is sized for.
 *
 * **Every season is read on every request** — the subject's comps span all of
 * them — so this is a *working set*, not a hit rate: a cache the corpus
 * outgrows evicts and rebuilds a season per request, which is churn wearing a
 * cache's name. The stats archive reaches back to `STATS_ARCHIVE_FLOOR_SEASON`
 * (2000) and gains one season a year, so the true working set is ~27 today and
 * 64 is decades of headroom past it.
 *
 * It is stated once because two caches are sized off it, and the second was
 * where getting it wrong was invisible: see {@link COMPS_ENRICHMENT_CACHE}.
 */
export const COMPS_MAX_SEASONS = 64;

/**
 * How long an assembled season pool is worth reusing, and how many are kept.
 *
 * Fifteen minutes because everything under it moves slower: the stats sync is
 * weekly in season, KTC daily, and the crawled drafts drip in on the crawler's
 * own tick. The client's result stale time (five minutes) sits deliberately
 * below it — a stale client read costs a request this answers warm.
 *
 * Fifteen minutes is now the *default* rather than the whole policy: what a
 * season's entry is actually held for comes from {@link getCompsSeasonTtlMs},
 * which reads the season's age. This TTL still governs the small entries stored
 * without one (the stored-seasons list, the display-draft lookups).
 *
 * **The bound must stay above the count of stored seasons** — every season is
 * read on every request, so a cap the working set outgrows evicts and rebuilds a
 * season per request, which is cache churn wearing a cache's name.
 * {@link COMPS_MAX_SEASONS} is that bound, and is what the enrichment cache
 * beside it is sized off too.
 */
export const COMPS_POOL_CACHE = {
  name: "comps-pool",
  ttlMs: 15 * 60 * 1000,
  max: COMPS_MAX_SEASONS,
} as const;

/**
 * How long a season's entries — its pool and each of its datasets — are worth
 * holding, by how fast that season still moves.
 *
 * **One TTL for the whole corpus was the wrong shape, and the cost was a cliff
 * rather than a staleness.** Comps walks *every* stored season on every
 * request, so the working set is the archive: ~27 seasons today, two reads each
 * before any dataset, and the stats backfill reaches to
 * `STATS_ARCHIVE_FLOOR_SEASON` (2000). On a fifteen-minute clock the whole of
 * it was rebuilt four times an hour — 54 database reads through a bounded
 * admission, on whichever reader happened to arrive first — to re-learn numbers
 * that in 2008's case have not changed in seventeen years. Worse, the entries
 * are *populated together*, so they *expire* together: the cliff is one reader
 * paying for the entire corpus, not a season here and a season there.
 *
 * So the clock matches the data:
 *
 *   - **live** — the current season (or, from a clock that is ahead of ours, a
 *     later one): the stats sync writes it weekly and corrects it for
 *     {@link STATS_CORRECTION_WEEKS} after, so this stays where the whole cache
 *     was. It is also the floor the client's five-minute stale time needs (the
 *     house rule: a server entry outlives the browser's by half again at
 *     least).
 *   - **recent** — the {@link COMPS_RECENT_SEASONS} season(s) behind it: the
 *     season is over, but it is still inside the window where a correction or
 *     the tail of a backfill can land, and it is the season most readers are
 *     looking at. Six hours: long enough to stop being a per-request cost, short
 *     enough that a correction is same-day.
 *   - **historical** — everything older: a finished season on
 *     `STATS_SETTLED_TTL_MS`'s own reasoning, whose numbers only move when
 *     somebody backfills or corrects them. A day.
 *
 * **A day rather than forever, deliberately.** The app does support historical
 * corrections — an archive week that came back empty is re-probed, and a
 * refused payload is retried — so an entry that never expired would serve a
 * fixed answer until the process restarted. The in-process invalidation
 * (`onStatsSeasonWritten` → `forgetCompsSeason`) is what makes a correction
 * visible *immediately* where the sync and the reader share a process; the day
 * is the backstop for where they do not, since a second dyno's cache cannot be
 * reached from here and nothing in this app justifies adding a bus to reach it.
 */
export const COMPS_SEASON_TTL_MS = {
  live: COMPS_POOL_CACHE.ttlMs,
  recent: 6 * 60 * 60 * 1000,
  historical: 24 * 60 * 60 * 1000,
} as const;

/** Finished seasons still treated as moving. One: last season. */
export const COMPS_RECENT_SEASONS = 1;

/**
 * How much of its tier's TTL an entry may be held *past* it, to spread expiry.
 *
 * The corpus is filled in one walk, so without this every entry in a tier
 * expires within milliseconds of every other and the next reader pays for all
 * of them — the same cliff the tiers exist to remove, merely rarer. A quarter
 * of the tier, from a hash of the entry's own key, spreads a day-scale tier
 * across six hours and a six-hour one across ninety minutes.
 *
 * **Deterministic, and it only ever extends.** A random jitter would make every
 * test of this a coin toss, and a jitter that could shorten a TTL would put an
 * entry below the floor the client's stale time needs.
 */
export const COMPS_SEASON_TTL_STAGGER_SHARE = 1 / 4;

/**
 * How long to hold one comps entry for `season`, against the season the app is
 * currently operating in.
 *
 * `staggerKey` is what the spread is computed from, so a season's four dataset
 * entries do not expire in the same instant as its pool — it defaults to the
 * season, which is what a caller with one entry per season wants.
 *
 * **`currentSeason` is what this process happens to know, not what it can find
 * out** (`peekActiveSeason`, never `getActiveSeason`), which is why `undefined`
 * is a documented input rather than a caller's problem. Resolving the season
 * here would put a Sleeper call — up to four attempts with backoff behind the
 * shared axios instance — in front of a corpus already sitting in Postgres,
 * purely to *label how long to keep a copy of it*. An outage upstream would
 * become an outage in a tool that needs nothing from upstream, which is the one
 * failure this classification must not be able to cause.
 *
 * An unknown or unparseable season therefore falls to the **live** tier: the
 * shortest clock, so the worst it can cost is an earlier rebuild of an entry
 * that could have been held longer. Every other reading risks the opposite — an
 * archive clock on a season that is still moving — and a day of a wrong answer
 * is not a trade to make for a label. The same reading covers a season that
 * isn't a year: the seasons come from `listStoredSeasons`, so anything else is a
 * corpus this policy doesn't understand.
 */
export function getCompsSeasonTtlMs(
  season: string,
  currentSeason: string | undefined | null,
  staggerKey: string = season,
): number {
  return withStagger(baseSeasonTtlMs(season, currentSeason), staggerKey);
}

function baseSeasonTtlMs(
  season: string,
  currentSeason: string | undefined | null,
): number {
  // Spelled out rather than left to `Number(null) === 0`: an unknown season is
  // a state this is *designed* for, and a coercion that happened to land on the
  // right tier is not the same thing as a policy.
  if (currentSeason == null) return COMPS_SEASON_TTL_MS.live;
  const year = Number(season);
  const current = Number(currentSeason);
  if (!Number.isInteger(year) || !Number.isInteger(current)) {
    return COMPS_SEASON_TTL_MS.live;
  }
  // A season *ahead* of the current one reads as live rather than historical:
  // it is the one a clock disagreement can produce, and holding next season's
  // (empty, filling) pool for a day is the expensive way to be wrong.
  if (year >= current) return COMPS_SEASON_TTL_MS.live;
  return current - year <= COMPS_RECENT_SEASONS
    ? COMPS_SEASON_TTL_MS.recent
    : COMPS_SEASON_TTL_MS.historical;
}

/** The tier's TTL plus a deterministic share of it, from the key's own hash. */
function withStagger(ttlMs: number, key: string): number {
  const spread = Math.floor(ttlMs * COMPS_SEASON_TTL_STAGGER_SHARE);
  if (spread <= 0) return ttlMs;
  // FNV-1a: a few lines, no dependency, and well enough spread that adjacent
  // season strings land in different parts of the window.
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ttlMs + (hash % spread);
}

/**
 * One dataset for one season — a KTC snapshot, a KTC history aggregate, an ADP
 * average or the draft crosswalk.
 *
 * The same TTL policy as the pool it feeds, since these *are* what a pool was
 * made of and they are read as-of the same anchor, so a historical season's
 * market numbers are as fixed as its stat lines.
 *
 * **The bound is the working set, stated rather than counted.** It used to be
 * 128, which fit today's corpus (~27 seasons × 4 datasets = 108) and stopped
 * fitting at 33 seasons — six years out, silently, as continual eviction and
 * recomputation of a corpus every request walks end to end. So it is derived:
 * every supported season, times every dataset family a season can hold. Add a
 * fifth family to {@link COMPS_ENRICHMENTS} or raise {@link COMPS_MAX_SEASONS}
 * and the bound follows, which is the relationship that was implicit and is now
 * the code.
 *
 * **No family is excluded from the count.** All four are per-season maps a
 * board can weigh at once, and the request that walks the whole corpus with all
 * four weighted is exactly the one that must not thrash.
 *
 * The memory that buys: an entry is a map from the season's player ids
 * (~1,000–1,800 with stat lines) to a small object of two or three numbers —
 * ~200KB at the wide end, and less for KTC, which prices ~500 players. The full
 * theoretical set is therefore tens of megabytes and is only reachable by a
 * corpus of 64 seasons where every board weighs every dataset; today's
 * reachable ceiling is ~27 × 4 ≈ 20MB, and the *typical* one is zero, since
 * every market field defaults to weight 0 and an entry only exists for a
 * dataset some board actually weighted.
 */
export const COMPS_ENRICHMENT_CACHE = {
  name: "comps-enrichment",
  ttlMs: COMPS_POOL_CACHE.ttlMs,
  max: COMPS_MAX_SEASONS * COMPS_ENRICHMENTS.length,
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
