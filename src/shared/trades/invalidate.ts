import { forgetTradeCircles } from "./circle";
import { forgetSeasonAdp, forgetTradeLeagueMarkets } from "./enrich";
import { forgetTradeLeagueReads } from "./queries";

/**
 * One place that knows what a write invalidates.
 *
 * **The caches existed and nothing dropped them.** `clearTradeEnrichmentCaches`
 * and `clearTradeCircleCache` were exported, documented as being "for a sync
 * that knows it has changed what these read", and called by nothing — so a
 * league sync could commit new rosters, new members, new drafts and new trades
 * and then serve the previous ten to fifteen minutes' answers over the top of
 * them. The reader who most obviously hit it is the one who had just asked for
 * the sync.
 *
 * Three properties are the whole design:
 *
 * - **It runs after the commit, never before.** A transaction that rolls back
 *   has changed nothing, and dropping caches for it would be a cold board
 *   bought for no new data — worse, it would do so during exactly the upstream
 *   outage that produces rollbacks. `persistLeagueGraph` calls this after
 *   `withTransaction` resolves, which is the only point at which the rows are
 *   real.
 * - **It is targeted.** A sync of one league drops that league's entries and
 *   its members' circles; a hundred other leagues' answers, and the ~20k-entry
 *   players map, are untouched. The alternative — `clear()` on everything — is
 *   correct and turns every sync into a cold start for every reader, which on a
 *   crawler ticking once a minute is a cache that never warms.
 * - **It is one function, so a write does not have to know the shape of four
 *   caches.** The rule the task of adding a fifth should follow: give the cache
 *   a `forget…` of its own, keyed the way it is keyed, and name it here.
 *
 * **What is deliberately not invalidated**, each for the same reason: it did
 * not change.
 *
 * - **The players map** (`shared/trades/enrich`'s `playersCache`). Sleeper's
 *   global NFL players are refreshed by their own daily sync; a league graph
 *   landing says nothing about a player's name, position or team.
 * - **The KeepTradeCut boards.** `shared/ktc/board-read` holds them on the
 *   scrape's own TTL, and a league sync does not scrape.
 * - **The rest-of-season projections span.** Fetched from Sleeper, not written
 *   here.
 *
 * Adding any of those would be invalidating an immutable global dataset to
 * answer a question about one league, which is the cost this file exists to
 * avoid paying.
 */

/** What changed, and enough about it to forget only what depends on it. */
export type TradeCacheInvalidation = {
  /**
   * The leagues whose graphs were written. Empty is legal and means "nothing
   * league-scoped changed", which is what a caller with only a season has.
   */
  leagueIds?: readonly string[];
  /**
   * The season those leagues are in, where the caller knows it. Null narrows
   * nothing — a circle in *every* season is forgotten for the affected readers,
   * and the season's draft-capital board is left alone because there is no
   * season to name.
   */
  season?: string | null;
  /**
   * The people whose `league_users` rows the write touched — a league's own
   * membership as the sync stored it. Their names and their resolved circles
   * are what a membership change moves.
   */
  userIds?: readonly string[];
  /**
   * Why, for the log line. A sentence fragment: "league graph synced",
   * "league tombstoned".
   */
  reason: string;
};

/**
 * Drop every in-process trade-derived answer that the described write could
 * have changed.
 *
 * Synchronous and total: every cache here is an in-memory map, so there is
 * nothing to await and nothing that can fail. That matters at the call site —
 * `persistLeagueGraph` invokes it on the success path of a transaction it has
 * already committed, where a rejected promise would have nowhere to go.
 */
export function invalidateTradeCaches(
  invalidation: TradeCacheInvalidation,
): void {
  const { leagueIds = [], season = null, userIds = [], reason } = invalidation;
  if (leagueIds.length === 0 && userIds.length === 0 && season === null) return;

  let dropped = forgetTradeLeagueReads(leagueIds, userIds);
  dropped += forgetTradeLeagueMarkets(leagueIds);
  // A league sync writes `drafts` and `draft_picks`, which is the population the
  // season's capital board is aggregated over.
  if (season !== null) dropped += forgetSeasonAdp(season);
  // Membership moved, so "my leagues" and "my leaguemates" moved with it.
  dropped += forgetTradeCircles(userIds, season);

  // Quiet by default: the crawler runs this once a minute per batch, and a line
  // per league would drown an operator's log to report a map deletion. Only a
  // pass that actually forgot something is worth a word, and then at debug
  // volume.
  if (dropped > 0) {
    console.debug(
      `[trades] forgot ${dropped} cached ${dropped === 1 ? "answer" : "answers"} (${reason})`,
    );
  }
}
