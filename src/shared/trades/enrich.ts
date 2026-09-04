import type { KtcFormat, PlayerSummary } from "@/shared/contract";
import { getKtcBoards } from "@/shared/ktc";
import type { KtcBoards } from "@/shared/ktc";
import { getPlayersByIds } from "@/shared/players";

import { BoundedCache, cachedLookup } from "./cache";
import { getTradeLeagueMarkets } from "./queries";
import type { TradeLeagueMarket } from "./queries";

/**
 * The id → name lookup a page of trades is resolved through, cached.
 *
 * A season's vocabulary is small and fixed — a few thousand players — so after
 * the first page or two nearly every lookup is a hit and the database sees no
 * traffic at all for a page's names. The TTL is far shorter than the sync
 * writing behind it, so the cost of being stale is one query and never a wrong
 * name.
 *
 * **The KTC lookups landed here**, exactly where this file said they would: the
 * name matcher (`shared/ktc/match`) filled `ktc_values.sleeper_id` and
 * `shared/ktc/picks` reached the rookie-pick rows, so a traded player and a
 * traded pick are both priceable. They are cached on different terms from the
 * names above and from each other — see each below.
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

/**
 * How long a league's superflex reading and size are reused.
 *
 * Both are settings a commissioner changes between seasons, not between pages,
 * so this is about a league being *created* mid-session rather than about a
 * value drifting — the same argument the draft-order cache makes one file over.
 */
const LEAGUE_MARKET_TTL_MS = 15 * 60 * 1000;

/**
 * Sized past the leagues one season's board can name — a few hundred — with the
 * same headroom the players cache carries.
 */
const leagueMarketCache = new BoundedCache<TradeLeagueMarket | null>(
  5000,
  LEAGUE_MARKET_TTL_MS,
);

/**
 * The pricing facts for the leagues a page names, from cache where possible.
 *
 * A league with no stored row is held as an absence, so an id that resolves to
 * nothing is asked about once rather than on every page it appears in — the
 * players cache's own rule.
 */
export function lookupLeagueMarkets(
  leagueIds: readonly string[],
): Promise<Map<string, TradeLeagueMarket>> {
  return cachedLookup(leagueMarketCache, leagueIds, getTradeLeagueMarkets);
}

/**
 * Both KeepTradeCut markets, for a page that prices its assets on each.
 *
 * **Not cached here**, unlike everything else in this file: `shared/ktc`'s own
 * `board-read` already holds the folded boards for the sync's TTL, and a second
 * cache in front of it would be a second staleness policy for one set of
 * numbers. This is a pass-through that names the shape the route wants and
 * degrades the way the route needs — a market that cannot be read is absent,
 * and every asset priced against it comes back null rather than failing a page
 * of trades over a valuation.
 */
export async function lookupKtcMarkets(): Promise<
  Partial<Record<KtcFormat, KtcBoards>>
> {
  const formats: KtcFormat[] = ["dynasty", "redraft"];
  const read = await Promise.all(
    formats.map(async (format) => {
      try {
        return [format, await getKtcBoards(format)] as const;
      } catch (error) {
        console.warn(`[trades] KTC ${format} board unavailable:`, error);
        return [format, null] as const;
      }
    }),
  );

  const out: Partial<Record<KtcFormat, KtcBoards>> = {};
  for (const [format, boards] of read) if (boards) out[format] = boards;
  return out;
}

/** For tests, and for a sync that has just replaced what this holds. */
export function clearTradeEnrichmentCaches(): void {
  playersCache.clear();
  leagueMarketCache.clear();
}
