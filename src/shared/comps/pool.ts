import { getDraftAdpForPlayers, ADP_FILTER_DEFAULTS } from "@/shared/manager";
import { getKtcSfHistoryAsOf, getKtcValuesAsOf } from "@/shared/ktc";
import { getNflDraftPicks } from "@/shared/nfl-draft";
import { getPlayerProfiles } from "@/shared/players";
import { listSeasonStatLines, listStoredSeasons } from "@/shared/stats";
import { deepFreeze, TtlPromiseCache } from "@/shared/util";

import { assemblePoolRows } from "./assemble";
import { COMPS_POOL_CACHE, compsPoolCacheKey } from "./read-cache";
import { compsSeasonAnchor } from "./resolve";
import { collectSeasonPools } from "./season-pools";

import type { AdpFilters } from "@/shared/manager";
import type { CompsPoolRow } from "./knn";

/**
 * The comps pool behind its cache — thin I/O over `assemble.ts`, which holds
 * every rule worth testing. This concern owns no table: stats, players, KTC
 * and ADP are each read through the module that owns them.
 *
 * A shared answer is frozen, because every caller inside the TTL holds the
 * same rows and an in-place sort by one would edit what every later reader
 * gets — the bug that appears on the second request and never on the first.
 */

const poolCache = new TtlPromiseCache<readonly CompsPoolRow[]>(COMPS_POOL_CACHE);

/**
 * The stored-seasons list rides its own small entry on the same policy: it is
 * one `DISTINCT` query, but it is asked on every comps request and changes
 * roughly once a year.
 */
const seasonsCache = new TtlPromiseCache<string[]>({
  name: `${COMPS_POOL_CACHE.name}-seasons`,
  ttlMs: COMPS_POOL_CACHE.ttlMs,
  max: 1,
});

/**
 * Today on the NFL's clock — Eastern, the `TODAY_ET` side of the two-todays
 * rule, because it decides what market data a season read gets (a fact about
 * the data, not about any reader).
 */
function todayEasternIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function loadSeasonPool(season: string): Promise<readonly CompsPoolRow[]> {
  const statLines = await listSeasonStatLines({ season });
  const ids = [...new Set(statLines.map((line) => line.player_id))];

  // One anchor for both market reads, so "entering that season" means the same
  // date to KTC and ADP. The anchor is not in the cache key: for a past season
  // it never moves, and for the current one it drifts by at most the TTL.
  const anchor = compsSeasonAnchor(season, todayEasternIso());
  const adpFilters: AdpFilters = {
    seasons: [season],
    start_after: null,
    start_before: anchor,
    league_ids: null,
    exclude_league_ids: null,
    scoring: null,
    best_ball: null,
    superflex: null,
    rounds_min: null,
    rounds_max: null,
    teams_min: null,
    teams_max: null,
    ...ADP_FILTER_DEFAULTS,
  };

  // The draft read takes no anchor, unlike the two market reads beside it:
  // where a player was drafted is the same fact in every season of his career,
  // so it is exact for a historical row rather than as-of.
  const [profiles, ktc, ktcHistory, adp, draft] = await Promise.all([
    getPlayerProfiles(ids),
    getKtcValuesAsOf(anchor),
    getKtcSfHistoryAsOf(anchor),
    getDraftAdpForPlayers(adpFilters, ids),
    getNflDraftPicks(ids),
  ]);

  return deepFreeze(
    assemblePoolRows({
      statLines,
      profiles,
      ktc: ktc.values,
      ktcHistory,
      adp: adp.values,
      draft,
      season,
    }),
  );
}

/** Every season with stats stored, newest first — what makes the pool deepen. */
export function getCompsSeasons(): Promise<string[]> {
  return seasonsCache.read("seasons", listStoredSeasons);
}

/** One season's assembled pool, from the cache or one shared computation. */
export function getCompsPool(season: string): Promise<readonly CompsPoolRow[]> {
  return poolCache.read(compsPoolCacheKey(season), () => loadSeasonPool(season));
}

/**
 * Every stored season's pool, newest season first — the whole comp corpus.
 * Assembled per season so a season already cached costs nothing when another
 * misses, and at most `COMPS_SEASON_BUILD_CONCURRENCY` builds at once so a cold
 * process doesn't start the whole archive's fan-out in one breath. The walk
 * itself is `collectSeasonPools`, pure and tested.
 */
export async function getCompsPools(): Promise<
  { season: string; rows: readonly CompsPoolRow[] }[]
> {
  return collectSeasonPools(await getCompsSeasons(), getCompsPool);
}
