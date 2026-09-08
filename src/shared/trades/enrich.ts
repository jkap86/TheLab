import type { KtcFormat, ManagerLeague, PlayerSummary } from "@/shared/contract";
import { getKtcBoards } from "@/shared/ktc";
import type { KtcBoards } from "@/shared/ktc";
import {
  createReadMemo,
  createStaleWhileRevalidateMemo,
  getSeasonDraftAdp,
} from "@/shared/manager";
import type {
  DraftAdpBoards,
  ReadMemo,
  StaleWhileRevalidateMemo,
} from "@/shared/manager";
import { getPlayersByIds } from "@/shared/players";

import { BoundedCache, cachedLookup } from "./cache";
import { getSeasonTradeLeagues, getTradeLeagueMarkets } from "./queries";
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

/**
 * How long the season's draft-capital board is reused before a rebuild runs
 * behind it.
 *
 * The population behind it is completed drafts, which arrive a handful at a
 * time over a preseason and never after: what this window is sized against is a
 * draft *finishing* mid-session, not a value drifting. It is the same fifteen
 * minutes the league facts above take, and the aggregate it saves is a scan of
 * every stored pick of the season — the one read on this route that is not
 * bounded by the page.
 */
const SEASON_ADP_TTL_MS = 15 * 60 * 1000;

/**
 * The least time between two rebuilds of one season's board.
 *
 * A league persist marks the board stale (see {@link forgetSeasonAdp}) and the
 * crawler persists up to thirty leagues a minute, so without this a rebuild
 * would follow every one of them and the aggregate would run every couple of
 * seconds for readers who cannot see the difference. A minute bounds how old a
 * stale answer can be; a persist landing mid-rebuild is carried by the memo's
 * own mark counting rather than by a second read.
 */
const SEASON_ADP_REVALIDATE_MS = 60 * 1000;

/**
 * How long the season's traded-league list is reused. Which leagues have a
 * trade at all changes only when a sync writes a league's first one, and every
 * league write evicts this outright — see {@link forgetSeasonTradeLeagues} for
 * why that one is an eviction where the board above takes a stale mark.
 */
const SEASON_LEAGUES_TTL_MS = 5 * 60 * 1000;

/**
 * Cached on `globalThis` rather than in module scope, for `board-read`'s and
 * `ros-read`'s reason: a per-bundle copy would re-run the aggregate once per
 * route rather than once per process. Keyed by season, since a board is asked
 * for one season at a time but a stale bookmark can name another. The memo
 * shapes are `shared/manager/read-cache`'s, which is where their rules are
 * tested with the reader and the clock injected.
 */
const SEASON_ADP_KEY = Symbol.for("thelab.trades.seasonAdpBoard");
const SEASON_LEAGUES_KEY = Symbol.for("thelab.trades.seasonLeagues");
const globalScope = globalThis as typeof globalThis & {
  [SEASON_ADP_KEY]?: StaleWhileRevalidateMemo<DraftAdpBoards>;
  [SEASON_LEAGUES_KEY]?: ReadMemo<ManagerLeague[]>;
};

const seasonAdpMemo = (): StaleWhileRevalidateMemo<DraftAdpBoards> =>
  (globalScope[SEASON_ADP_KEY] ??= createStaleWhileRevalidateMemo({
    ttlMs: SEASON_ADP_TTL_MS,
    revalidateMs: SEASON_ADP_REVALIDATE_MS,
    onRebuildError: (season, error) =>
      console.warn(
        `[trades] draft capital rebuild failed for ${season}; serving the previous board:`,
        error,
      ),
  }));

const seasonLeaguesMemo = (): ReadMemo<ManagerLeague[]> =>
  (globalScope[SEASON_LEAGUES_KEY] ??= createReadMemo({
    // A handful of seasons is every season there is; the bound is against a
    // stale bookmark naming one that is not.
    max: 8,
    ttlMs: SEASON_LEAGUES_TTL_MS,
  }));

/**
 * The season's two ADP populations, from cache — **stale included**.
 *
 * This used to be evicted by every league persist, and the crawler persists up
 * to thirty leagues a minute, so every page of trades re-ran a season-wide
 * aggregate to answer with a board that had not measurably moved. A persist now
 * *marks* the board stale instead: the stale board keeps answering while one
 * rebuild runs behind it, at most once a minute, and a rebuild that rejects
 * keeps the board rather than caching the failure — a population that moves a
 * handful of drafts per preseason is better a minute old than absent, which is
 * what the capital basis degrades to otherwise. Only a *cold* read that fails
 * is evicted, on the `memoize-manager-lookup` rule every memo here follows:
 * there is nothing older to serve, and a blip remembered for fifteen minutes is
 * an outage extended by the mechanism meant to absorb one.
 */
export function lookupSeasonAdp(season: string): Promise<DraftAdpBoards> {
  return seasonAdpMemo().read(season, () => getSeasonDraftAdp(season));
}

/**
 * Every league with a trade on the season's board, from cache where it is
 * fresh.
 *
 * `/api/trades/leagues` re-read and re-serialised every traded league's three
 * JSONB blobs for every reader, to answer a list that changes only when a
 * league's first trade is written — and that write evicts this. A failed read
 * is evicted rather than cached, on the rule above.
 */
export function lookupSeasonTradeLeagues(
  season: string,
): Promise<ManagerLeague[]> {
  return seasonLeaguesMemo().read(season, () => getSeasonTradeLeagues(season));
}

/**
 * Forget the pricing facts for these leagues, because a sync has just rewritten
 * their rows.
 *
 * Keyed by league id exactly, so this is a `delete` per league rather than a
 * predicate — the entries are one per league and the caller knows which.
 * Answers how many entries went, which is the only thing
 * {@link invalidateTradeCaches} has to report with.
 */
export function forgetTradeLeagueMarkets(leagueIds: readonly string[]): number {
  let dropped = 0;
  for (const id of leagueIds) {
    if (leagueMarketCache.get(id) !== undefined) dropped += 1;
    leagueMarketCache.delete(id);
  }
  return dropped;
}

/**
 * Mark a season's draft-capital board stale — or, with no season to name, drop
 * every board.
 *
 * A league sync writes `drafts` and `draft_picks`, which is the population this
 * aggregate is taken over — so a draft finishing changes the board, and the
 * fifteen-minute window it would otherwise sit behind is exactly the wait this
 * exists to skip after an explicit sync. **A mark rather than a deletion**: the
 * board keeps answering while one rebuild runs behind it, for the reason
 * {@link lookupSeasonAdp} gives. Answers 1 for a board that was there to mark,
 * which is the count the invalidation's log line reports.
 *
 * **The players cache is deliberately not touched here or anywhere else.** It
 * stands in front of Sleeper's global NFL map, which no league sync writes; a
 * league graph landing has nothing to say about a player's name, and dropping
 * twenty thousand entries to answer a question nobody asked would turn every
 * sync into a cold board for the next reader.
 */
export function forgetSeasonAdp(season: string | null): number {
  const memo = globalScope[SEASON_ADP_KEY];
  if (!memo) return 0;
  if (season === null) return memo.clear();
  return memo.markStale(season) ? 1 : 0;
}

/**
 * Forget the season's traded-league list, because a league's rows were just
 * written and the write may have been that league's first trade.
 *
 * An eviction rather than a stale mark — the opposite call from the board
 * above, for a reader-facing reason: the list is what every card names its
 * league from, so a reader who opens the board straight after syncing a league
 * would otherwise see that league as a bare id for up to a minute. The cost is
 * that the first reader after any persist reads the list cold, which is one
 * bounded read of a few hundred rows rather than a season-wide aggregate.
 */
export function forgetSeasonTradeLeagues(season: string | null): number {
  const memo = globalScope[SEASON_LEAGUES_KEY];
  if (!memo) return 0;
  return memo.forget((key) => season === null || key === season);
}

/** For tests, and for a sync that has just replaced what this holds. */
export function clearTradeEnrichmentCaches(): void {
  playersCache.clear();
  leagueMarketCache.clear();
  globalScope[SEASON_ADP_KEY]?.clear();
  globalScope[SEASON_LEAGUES_KEY]?.clear();
}
