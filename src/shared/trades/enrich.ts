import type { PlayerSummary } from "@/shared/contract";
import { getPlayersByIds } from "@/shared/players";

import { BoundedCache, cachedLookup } from "./cache";

/**
 * The id → name lookup a page of trades is resolved through, cached.
 *
 * A season's vocabulary is small and fixed — a few thousand players — so after
 * the first page or two nearly every lookup is a hit and the database sees no
 * traffic at all for a page's names. The TTL is far shorter than the sync
 * writing behind it, so the cost of being stale is one query and never a wrong
 * name.
 *
 * **TheLabX's KTC lookups are deliberately absent**, with the valuation they
 * feed: pricing a traded player needs `ktc_values.sleeper_id`, which is null
 * until the name matcher ports, and pricing a pick needs the rookie-pick board
 * beside it. Both arrive together, and this is where they land when they do.
 */

/**
 * How long a player's name, position and team are reused. The stored players
 * map is replaced once a day, so this is two orders of magnitude inside it — a
 * team change showing up ten minutes late is not a thing anyone can perceive on
 * a board of past trades.
 */
const PLAYERS_TTL_MS = 10 * 60 * 1000;

/**
 * Sized past the number of distinct players a season's trades name (a few
 * thousand) so a whole board fits, and bounded so a process that has served a
 * decade of seasons doesn't hold all of them.
 */
const playersCache = new BoundedCache<PlayerSummary | null>(
  20000,
  PLAYERS_TTL_MS,
);

/**
 * Player summaries for `ids`, from cache where possible.
 *
 * A player the stored map has no row for is held as an absence rather than
 * dropped from the cache, so an id that resolves to nothing is asked about once
 * rather than on every page it appears in.
 */
export function lookupPlayers(
  ids: readonly string[],
): Promise<Map<string, PlayerSummary>> {
  return cachedLookup(playersCache, ids, getPlayersByIds);
}

/** For tests, and for a sync that has just replaced what this holds. */
export function clearTradeEnrichmentCaches(): void {
  playersCache.clear();
}
