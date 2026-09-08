import { forgetManagerReads } from "@/shared/manager";

import { forgetTradeCircles } from "./circle";
import {
  forgetSeasonAdp,
  forgetSeasonTradeLeagues,
  forgetTradeLeagueMarkets,
} from "./enrich";
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
 * **Two of what it forgets are the manager page's, not the board's.**
 * `forgetManagerReads` drops `shared/manager/read-cache`'s memos — the rows the
 * lineups route solves and the capital corpus it prices on — for the league's
 * members. They are named here rather than from an invalidation of their own
 * because this is the one function every league writer already calls, and a
 * second one is exactly the "cache that nothing dropped" this file opens with.
 * "Forget" is one word for two treatments: the season's capital board takes a
 * *stale mark* and keeps answering while it rebuilds, where everything else is
 * evicted — see `forgetSeasonAdp` for why.
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
   * Whether this write replaced any draft's picks, which is the only thing a
   * league sync does that can move the season's draft-capital board.
   *
   * **A separate field rather than a null `season`**, because `season` narrows
   * three other evictions: passing null to spare the capital board would widen
   * the circle and manager-read forgets to *every* season for those readers.
   * The routine refresh writes no picks at all now — a completed draft is
   * skipped at fetch time — so this is false for almost every crawl tick, and
   * that is what keeps the board it guards from being rebuilt per `/api/trades`
   * page. Defaults true: a caller that has not thought about it gets the old,
   * safe behaviour.
   */
  wroteDraftPicks?: boolean;
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
  const {
    leagueIds = [],
    season = null,
    userIds = [],
    wroteDraftPicks = true,
    reason,
  } = invalidation;
  if (leagueIds.length === 0 && userIds.length === 0 && season === null) return;

  let dropped = forgetTradeLeagueReads(leagueIds, userIds);
  dropped += forgetTradeLeagueMarkets(leagueIds);
  // Any league write can be that league's first trade — the one event that
  // changes which leagues the season's board names at all.
  if (leagueIds.length > 0) dropped += forgetSeasonTradeLeagues(season);
  // A league sync that wrote picks moved the population the season's capital
  // board is aggregated over. One that wrote none cannot have, and marking the
  // board stale for it is what made a 15-minute cache live seconds under the
  // crawler — see `wroteDraftPicks`.
  if (season !== null && wroteDraftPicks) dropped += forgetSeasonAdp(season);
  // Membership moved, so "my leagues" and "my leaguemates" moved with it.
  dropped += forgetTradeCircles(userIds, season);
  // And the members' own pages moved: the rows the lineups route solves are
  // this league's rosters, and its drafts sit in each member's capital corpus.
  dropped += forgetManagerReads(userIds, season);

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
