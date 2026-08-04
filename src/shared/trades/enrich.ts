import { getKtcPickBoard, getKtcValuesBySleeperId } from "@/shared/ktc";
import type { KtcValue } from "@/shared/ktc";
import { getPlayersByIds } from "@/shared/players";
import type { PlayerSummary } from "@/shared/players";

import { BoundedCache, cachedLookup } from "./cache";

/**
 * The id → name lookups a page of trades is resolved through, cached.
 *
 * **The lookups themselves are unchanged; what changed is that they now run
 * against a page rather than a stream, and are answered from memory.** Under the
 * streaming route each request held three `Set`s of "what I have already sent"
 * and each id crossed the wire once *per request* — which was the right shape
 * when a request was the whole season and the wrong one the moment a request
 * became a page: fifty pages meant fifty resolutions of the same few thousand
 * players.
 *
 * A season's vocabulary is small and fixed — a few thousand players, a few
 * thousand managers — so after the first page or two nearly every lookup is a
 * hit, and the database sees no traffic at all for the enrichment of a page. The
 * TTLs are shorter than the syncs writing behind them, so the cost of being
 * stale is one query and never a wrong name.
 *
 * The client keeps its own half of the old protocol: it merges each page's maps
 * into what it already holds, so a player named on page 1 is not re-sent on page
 * 12. That is why these lookups are handed only the ids a page names that the
 * *client* hasn't seen — the delta is computed on the wire, and this cache is
 * what keeps the delta cheap to compute on a second reader.
 */

/**
 * How long a player's name, position and team are reused. The players cache is
 * replaced once a day, so this is two orders of magnitude inside it — a team
 * change showing up ten minutes late is not a thing anyone can perceive on a
 * board of past trades.
 */
const PLAYERS_TTL_MS = 10 * 60 * 1000;

/**
 * How long a KTC price is reused. The scrape behind it refreshes daily and the
 * board is what the card's value column reads, so this matches the client's own
 * fifteen-minute stale time on the same numbers.
 */
const KTC_TTL_MS = 15 * 60 * 1000;

/**
 * Sized past the number of distinct players a season's trades name (a few
 * thousand) so a whole board fits, and bounded so a process that has served a
 * decade of seasons doesn't hold all of them.
 */
const playersCache = new BoundedCache<PlayerSummary | null>(20000, PLAYERS_TTL_MS);
const ktcCache = new BoundedCache<KtcValue | null>(20000, KTC_TTL_MS);

/**
 * The pick half of the same board, keyed by {@link ktcPickKey} rather than by a
 * player id.
 *
 * Its own cache because it is a different population read a different way: KTC
 * prices a few dozen pick rows against ~500 players, and they are asked for by
 * `(season, round, tier)` — a pick carries no `sleeper_id` for the player cache
 * to hold it under. Sized to that population several times over rather than to
 * the players'.
 */
const ktcPicksCache = new BoundedCache<KtcValue | null>(2000, KTC_TTL_MS);

/** Player summaries for `ids`, from cache where possible. */
export function lookupPlayers(
  ids: readonly string[],
): Promise<Map<string, PlayerSummary>> {
  return cachedLookup(playersCache, ids, getPlayersByIds);
}

/**
 * KTC prices for `ids`, from cache where possible.
 *
 * Both boards travel, because which one a trade reads is its *league's*
 * question and this board spans every crawled league: a two-QB room reads the
 * superflex board and a 1QB room the other, and the same player is worth
 * materially different totals on the two.
 *
 * A player KTC doesn't price stays absent rather than zeroed — its board is
 * ~500 dynasty skill players deep, so a kicker or a rookie IDP is off it
 * entirely, which is a different claim from being worth nothing. The cache holds
 * that absence as a `null`, so an unpriced player is asked about once rather
 * than on every page he appears in.
 */
export function lookupKtc(
  ids: readonly string[],
): Promise<Map<string, KtcValue>> {
  return cachedLookup(ktcCache, ids, async (misses) => {
    const { values } = await getKtcValuesBySleeperId(misses);
    return values;
  });
}

/**
 * KTC's price for the pick rows `keys` names, from cache where possible.
 *
 * **The fetch ignores which keys missed and reads the whole board**, which is
 * the one place these lookups differ from the three above. A pick board is a few
 * dozen rows and one unindexed scan of a 500-row table; narrowing it to the
 * handful a page names would cost the same query and answer less of the next
 * page. `cachedLookup` still records only what was asked for — including the
 * keys the board has nothing for, so a season KTC no longer prices is asked
 * about once rather than on every page a pick from it appears in.
 */
export function lookupKtcPicks(
  keys: readonly string[],
): Promise<Map<string, KtcValue>> {
  return cachedLookup(ktcPicksCache, keys, () => getKtcPickBoard());
}

/** For tests, and for a sync that has just replaced what these hold. */
export function clearTradeEnrichmentCaches(): void {
  playersCache.clear();
  ktcCache.clear();
  ktcPicksCache.clear();
}
