import { pool, withAdvisoryLock, LOCK_KEYS, msInterval } from "@/shared/db";

import { countTrades } from "./queries";
import type { TradeQuery } from "./params";

/**
 * The trades board's size, precomputed rather than counted per request.
 *
 * **The problem it replaces.** The board states its own denominator — "1,234 of
 * 48,001 trades" — and that number used to come from a `count(*)` over the whole
 * population, run on every load. At ~50k trades in a 1.6M-row `transactions`
 * table that is a ~56ms bitmap scan of most of the table's trade pages, for a
 * number that changes only when the crawler writes a new trade. Once the route
 * became paginated it would have been *worse*: a count per page rather than per
 * season.
 *
 * So the unnarrowed count is stored, and the route reads a row. The narrowed
 * counts can't be — there is a count per filter set and the space is unbounded —
 * but they are run once per filter set (on the first page) rather than once per
 * page, which is the same saving in the case that isn't the default.
 *
 * **The freshness gate stamps the attempt, not the data.** `updated_at` is
 * written on a successful count whether or not the season had any trades, which
 * is the rule `projection_week_syncs` exists for: a season nothing has been
 * crawled for counts zero, and a gate that read the count itself would find it
 * "unsynced" and recount on every single tick, forever.
 */

/**
 * How long a stored count is served before a refresh is due.
 *
 * Matched to the league crawler's fastest tier (15 minutes in-season): trades
 * arrive with the league syncs, so that is the fastest this number can actually
 * move. The consequence of being stale is that a progress line's denominator is
 * a few trades short of the truth for a few minutes, which is invisible next to
 * a board of tens of thousands.
 */
export const TRADE_STATS_TTL_MS = 15 * 60 * 1000;

/**
 * The season's stored trade count, or null when nothing has been stored for it
 * yet.
 *
 * Null rather than a count of zero, and the difference is what the caller needs:
 * an unrefreshed season should fall back to counting live once (and trigger a
 * refresh) rather than telling a reader the board is empty while filling with
 * cards.
 */
export async function getStoredTradeCount(
  season: string,
): Promise<number | null> {
  const { rows } = await pool.query<{ completed_trade_count: string }>(
    `SELECT completed_trade_count FROM trade_market_stats WHERE season = $1`,
    [season],
  );
  const row = rows[0];
  return row ? Number(row.completed_trade_count) : null;
}

/** Seasons whose stored count is missing or older than the TTL. */
export async function staleTradeStatSeasons(
  ttlMs = TRADE_STATS_TTL_MS,
): Promise<string[]> {
  const { rows } = await pool.query<{ season: string }>(
    `SELECT DISTINCT l.season
       FROM leagues l
       LEFT JOIN trade_market_stats s ON s.season = l.season
      WHERE s.season IS NULL OR s.updated_at < now() - $1::interval
      ORDER BY l.season DESC`,
    [msInterval(ttlMs)],
  );
  return rows.map((r) => r.season);
}

/**
 * Recount one season and store it.
 *
 * Counted through {@link countTrades} over an unnarrowed query, so the stored
 * number is by construction the same population the board's rows come from —
 * the guarantee the old `count(*) OVER ()` gave by riding on the rows, kept by
 * sharing the predicate instead.
 */
export async function refreshTradeStats(season: string): Promise<number> {
  const query = unnarrowed(season);
  const total = await countTrades(query);

  await pool.query(
    `INSERT INTO trade_market_stats (season, completed_trade_count, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (season) DO UPDATE
        SET completed_trade_count = EXCLUDED.completed_trade_count,
            updated_at = now()`,
    [season, total],
  );
  return total;
}

/**
 * Refresh every season whose count is stale, under an advisory lock.
 *
 * Called from the league crawler's tick, which is the right place for two
 * reasons: it is the process that *writes* the trades this counts, and it
 * already runs on a cadence matched to how fast they arrive. A loop of its own
 * would be a second timer for one query.
 *
 * The lock never waits — a tick that loses the race skips, the rule every
 * background loop here follows, because queueing behind another instance piles
 * ticks up instead of shedding them. Returns null when it skipped.
 */
export async function refreshStaleTradeStats(): Promise<{
  seasons: number;
  total: number;
} | null> {
  return withAdvisoryLock(LOCK_KEYS.tradeStats, async () => {
    const seasons = await staleTradeStatSeasons();
    let total = 0;
    for (const season of seasons) {
      try {
        total += await refreshTradeStats(season);
      } catch (error) {
        // One season failing is not a reason to leave the others stale, and a
        // failed count stamps nothing, so the next tick simply tries again.
        console.error(`[trades] stats refresh failed for ${season}:`, error);
      }
    }
    return { seasons: seasons.length, total };
  });
}

/** The query shape a stored count is counted over: the season and nothing else. */
function unnarrowed(season: string): TradeQuery {
  return {
    season,
    leagues: null,
    excludeLeagues: null,
    from: null,
    to: null,
    players: [],
    picks: [],
    managers: [],
    match: "all",
    limit: 0,
    cursor: null,
  };
}
