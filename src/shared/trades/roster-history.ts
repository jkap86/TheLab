import { bulkInsert, jsonb as j, pool, withTransaction } from "@/shared/db";
import {
  DYNASTY_LEAGUE_TYPE,
  LEAGUE_TYPE_SQL,
  dynastyPickGrid,
  ownedDraftPicks,
} from "@/shared/manager";
import type { LeagueDraft, TradedPick } from "@/shared/manager";

import { rewindTradeRosters } from "./rewind";
import type { RewindTransaction, RosterState } from "./rewind";
import { TRADE_SORT_SQL } from "./sql";

/**
 * Storing what each side of a trade held before it, and reading it back.
 *
 * The rules are all in `./rewind`, which is pure; this is the I/O around it —
 * which trades still need a snapshot, what the walk starts from, and the write.
 * Composition and nothing else, the shape `projections/outlook` follows.
 *
 * **Why this is stored rather than derived per request.** The walk is a fact
 * about a league's *whole* transaction log: answering one trade means reading
 * every move made since it. A board page names twenty trades from twenty
 * leagues, so deriving on read is twenty full logs per page — where the answer
 * never changes once it is right. So it is computed where the log is already
 * being written, on the league sync's own tick, and a page reads rows.
 *
 * **Which snapshots a pass recomputes** is the same rule `writeLeagueGraph`
 * follows for the collections it replaces: the weeks this sync re-fetched, plus
 * anything missing. The first half is what keeps a snapshot honest while its
 * week is still settling — a waiver that lands late is a move the earlier walk
 * did not have to reverse — and the second is what fills a league in on its
 * first pass and after any gap. Everything older is left alone, which is what
 * makes a steady-state pass cost one indexed query and no write at all.
 */

/** Inclusive week range this sync re-fetched — {@link WeekRange}, structurally. */
export type SyncedWeeks = { from: number; to: number };

/** One roster's state before one trade, as stored. */
export type TradeRosterRow = {
  transaction_id: string;
  roster_id: number;
  /**
   * The league the snapshot belongs to.
   *
   * Read back with the row rather than resolved by the caller, because the caller
   * asks by `transaction_id` alone — it has a trade id and no league in hand, and
   * naming a held pick's origin needs the league's roster→owner map. One column
   * off a row already being read beats a second query for the league of a trade.
   */
  league_id: string;
  state: RosterState;
};

/**
 * Recompute and store the pre-trade rosters this league is missing or has
 * re-fetched, and report how many rows were written.
 *
 * Returns 0 without touching anything else when nothing is due, which is the
 * ordinary outcome: a league whose trades all have snapshots and whose current
 * weeks hold no new ones costs exactly the one query that establishes that.
 */
export async function syncTradeRosters(
  leagueId: string,
  weeks: SyncedWeeks,
): Promise<number> {
  const due = await tradesNeedingSnapshots(leagueId, weeks);
  if (due.size === 0) return 0;

  // Only as far back as the oldest trade that needs answering. On a first sync
  // that is the league's whole log — bounded by a season, since a Sleeper league
  // id *is* one season and a dynasty chain links them with `previous_league_id`
  // — and on every pass after it, it is the refresh window. That is the
  // difference between re-reading a season of moves per league per tick and
  // reading a week of them.
  const oldest = Math.min(...due.values());

  const [league, rosters, tradedPicks, drafts, transactions] = await Promise.all([
    readLeague(leagueId),
    readRosters(leagueId),
    readTradedPicks(leagueId),
    readDrafts(leagueId),
    readTransactionTail(leagueId, oldest),
  ]);
  if (!league || rosters.length === 0) return 0;

  // The same resolution `getLeagueDetail` makes, and for the same reason: a
  // dynasty league's pick market is a fixed horizon of future drafts, while
  // every other format has no standing horizon and takes the derived grid.
  const picksByRoster = ownedDraftPicks(
    tradedPicks,
    rosters.map((r) => r.roster_id),
    league.season,
    league.league_type === DYNASTY_LEAGUE_TYPE
      ? dynastyPickGrid(league.season, drafts, league.previous_league_id)
      : null,
  );

  const current = new Map<number, RosterState>(
    rosters.map((r) => [
      r.roster_id,
      {
        players: r.players ?? [],
        picks: (picksByRoster.get(r.roster_id) ?? []).map((p) => ({
          season: p.season,
          round: p.round,
          // `ownedDraftPicks` names the origin `original_roster_id`; on the wire
          // and in storage it is Sleeper's `roster_id`, which is what the
          // transactions being reversed spell it as.
          roster_id: p.original_roster_id,
        })),
      },
    ]),
  );

  // The walk crosses every trade in the window, including ones already stored —
  // it has to, since their reversal is what earlier snapshots are built on — so
  // what is *written* is filtered back down to what was due.
  const snapshots = rewindTradeRosters(current, transactions).filter((s) =>
    due.has(s.transaction_id),
  );
  if (snapshots.length === 0) return 0;

  const ids = [...new Set(snapshots.map((s) => s.transaction_id))];
  await withTransaction(async (client) => {
    // Replaced rather than upserted, so a trade whose participants changed
    // between passes cannot leave a row for a roster that is no longer in it.
    // Scoped to exactly the ids being rewritten, which is what keeps this from
    // being the destructive-delete trap `writeLeagueGraph` documents.
    await client.query(
      `DELETE FROM trade_rosters WHERE transaction_id = ANY($1::varchar[])`,
      [ids],
    );
    await bulkInsert(client, {
      table: "trade_rosters",
      columns: [
        "transaction_id",
        "roster_id",
        "league_id",
        "players",
        "draft_picks",
      ],
      rows: snapshots,
      values: (s) => [
        s.transaction_id,
        s.roster_id,
        leagueId,
        j(s.state.players),
        j(s.state.picks),
      ],
    });
  });

  return snapshots.length;
}

/**
 * The league's completed trades that want a snapshot written this pass, mapped
 * to when each completed.
 *
 * **An undated trade is left out rather than snapshotted at the bottom of the
 * board.** `TRADE_SORT_SQL` folds a missing timestamp to zero, which is the
 * right place to *sort* it and the wrong thing to rewind from — "before the
 * oldest moment in the league" would reverse the entire log and hand back a
 * roster from before the league existed. No row is the honest answer, and it is
 * the same reading the board already takes of such a trade (a league with a
 * startup boundary drops it outright).
 */
async function tradesNeedingSnapshots(
  leagueId: string,
  weeks: SyncedWeeks,
): Promise<Map<string, number>> {
  const { rows } = await pool.query<{ transaction_id: string; at: number }>(
    `SELECT t.transaction_id, coalesce(t.status_updated, t.created)::float8 AS at
       FROM transactions t
      WHERE t.league_id = $1
        AND t.type = 'trade'
        AND t.status = 'complete'
        AND coalesce(t.status_updated, t.created) IS NOT NULL
        AND (t.week BETWEEN $2 AND $3
             OR NOT EXISTS (SELECT 1 FROM trade_rosters tr
                             WHERE tr.transaction_id = t.transaction_id))`,
    [leagueId, weeks.from, weeks.to],
  );
  return new Map(rows.map((r) => [r.transaction_id, r.at]));
}

type LeagueMetaRow = {
  season: string;
  previous_league_id: string | null;
  league_type: number;
};

async function readLeague(leagueId: string): Promise<LeagueMetaRow | null> {
  const { rows } = await pool.query<LeagueMetaRow>(
    `SELECT l.season, l.previous_league_id, ${LEAGUE_TYPE_SQL} AS league_type
       FROM leagues l WHERE l.league_id = $1`,
    [leagueId],
  );
  return rows[0] ?? null;
}

async function readRosters(
  leagueId: string,
): Promise<Array<{ roster_id: number; players: string[] | null }>> {
  const { rows } = await pool.query<{
    roster_id: number;
    players: string[] | null;
  }>(`SELECT roster_id, players FROM rosters WHERE league_id = $1`, [leagueId]);
  return rows;
}

async function readTradedPicks(leagueId: string): Promise<TradedPick[]> {
  const { rows } = await pool.query<TradedPick>(
    `SELECT season, round, roster_id, owner_id
       FROM traded_picks WHERE league_id = $1`,
    [leagueId],
  );
  return rows;
}

async function readDrafts(leagueId: string): Promise<LeagueDraft[]> {
  const { rows } = await pool.query<LeagueDraft>(
    // The two casts `getLeagueDetail` makes for the same reasons: `start_time`
    // is a BIGINT `pg` hands back as a string, and `rounds` is regex-guarded
    // before its cast so one league's junk value cannot fail the read.
    `SELECT draft_id, season, status, start_time::float8 AS start_time,
            CASE WHEN settings->>'rounds' ~ '^[0-9]+$'
                 THEN (settings->>'rounds')::int END AS rounds
       FROM drafts WHERE league_id = $1`,
    [leagueId],
  );
  return rows;
}

/**
 * Every completed move in the league from `oldest` forward, newest first.
 *
 * Three things about the shape of this read:
 *
 * - **All types, not just trades.** A waiver claim moves a player as surely as
 *   a trade does, so leaving them out would leave every snapshot holding people
 *   the roster picked up afterwards.
 * - **`status = 'complete'` only.** A failed waiver moved nothing, and reversing
 *   it would take a player off a roster that never gained one.
 * - **The board's own ordering.** The walk is only correct on a total order, and
 *   `TRADE_SORT_SQL` is the one the trades board is already read in — sharing it
 *   is what stops a snapshot from being taken at a different point in the log
 *   from the trade the board shows. Undated moves are excluded by the bound
 *   (`NULL >= n` is null), which is right: they cannot be placed in the order,
 *   and folding them to zero would only ever sort them below every snapshot.
 */
async function readTransactionTail(
  leagueId: string,
  oldest: number,
): Promise<RewindTransaction[]> {
  const { rows } = await pool.query<RewindTransaction>(
    `SELECT t.transaction_id, t.type, t.roster_ids, t.adds, t.drops, t.draft_picks
       FROM transactions t
      WHERE t.league_id = $1
        AND t.status = 'complete'
        AND coalesce(t.status_updated, t.created) >= $2
      ORDER BY ${TRADE_SORT_SQL} DESC, t.transaction_id DESC`,
    [leagueId, oldest],
  );
  return rows;
}

/**
 * The stored pre-trade rosters for the given trades, grouped by trade.
 *
 * **Deliberately uncached**, unlike the enrichment lookups beside it in
 * `./queries`: those resolve a fixed vocabulary a season repeats on every page
 * (a few thousand players and managers), where every page of the board names a
 * different set of trades and would share nothing with the last. A cache here
 * would be memory spent on a hit rate of zero.
 *
 * A trade with no stored snapshot is simply absent — the walk skips an undated
 * trade, and a league the crawler has not reached since this table existed has
 * none yet. Absent reads as "not known", never as "held nothing".
 */
export async function getTradeRosters(
  transactionIds: readonly string[],
): Promise<Map<string, TradeRosterRow[]>> {
  if (transactionIds.length === 0) return new Map();

  const { rows } = await pool.query<{
    transaction_id: string;
    roster_id: number;
    league_id: string;
    players: string[] | null;
    draft_picks: RosterState["picks"] | null;
  }>(
    `SELECT transaction_id, roster_id, league_id, players, draft_picks
       FROM trade_rosters
      WHERE transaction_id = ANY($1::varchar[])
      ORDER BY transaction_id, roster_id`,
    [[...new Set(transactionIds)]],
  );

  const byTrade = new Map<string, TradeRosterRow[]>();
  for (const r of rows) {
    let list = byTrade.get(r.transaction_id);
    if (!list) byTrade.set(r.transaction_id, (list = []));
    list.push({
      transaction_id: r.transaction_id,
      roster_id: r.roster_id,
      league_id: r.league_id,
      state: { players: r.players ?? [], picks: r.draft_picks ?? [] },
    });
  }
  return byTrade;
}
