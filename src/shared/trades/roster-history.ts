import { bulkInsert, jsonb as j, pool, withTransaction } from "@/shared/db";
import {
  DYNASTY_LEAGUE_TYPE,
  LEAGUE_TYPE_SQL,
  dynastyPickGrid,
  ownedDraftPicks,
} from "@/shared/manager";
import type { LeagueDraft, TradedPick } from "@/shared/manager";

import { asNumber, isRecord, items, numbers } from "./jsonb";
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
 *
 * **{@link getTradeTimeline} and {@link getLeagueTimeline} are the exception to
 * the paragraph above, and it is the exception that paragraph already allows.**
 * The argument against deriving was about a *board page*: twenty trades from
 * twenty leagues, so twenty whole transaction logs per request. A timeline is one
 * league, on a press, behind a disclosure — the same class of read as
 * `/api/league/[leagueId]` — and what it wants is a thing no table stores:
 * **every** roster at an **arbitrary** moment, where `trade_rosters` holds the
 * participants at one. So it reads the log and hands it to the browser rather
 * than the answer, which is what makes scrubbing free after the first request.
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

  const [states, transactions] = await Promise.all([
    readLeagueRosterStates(leagueId),
    readTransactionTail(leagueId, oldest),
  ]);
  if (states.length === 0) return 0;

  const current = new Map<number, RosterState>(
    states.map((s) => [s.roster_id, s.state]),
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

/** One roster as it stands now, with whoever holds it. */
export type LeagueRosterState = {
  roster_id: number;
  /** Null on an orphaned roster — the same reading `getRosterOwners` takes. */
  owner_id: string | null;
  state: RosterState;
};

/**
 * Every roster in the league as it stands now — the state both walks rewind
 * *from*.
 *
 * Four reads rather than one because a roster's players are a column and its
 * picks are a derivation: the pick portfolio is `traded_picks` overlaid on a
 * grid whose seasons depend on the league's format, which is the same resolution
 * `getLeagueDetail` makes and for the same reason — a dynasty league's pick
 * market is a fixed horizon of future drafts, while every other format has no
 * standing horizon and takes the derived grid.
 *
 * An empty answer is a league with no rosters stored, which both callers read as
 * "nothing to say" rather than as a league of empty teams.
 */
export async function readLeagueRosterStates(
  leagueId: string,
): Promise<LeagueRosterState[]> {
  const [league, rosters, tradedPicks, drafts] = await Promise.all([
    readLeague(leagueId),
    readRosters(leagueId),
    readTradedPicks(leagueId),
    readDrafts(leagueId),
  ]);
  if (!league || rosters.length === 0) return [];

  const picksByRoster = ownedDraftPicks(
    tradedPicks,
    rosters.map((r) => r.roster_id),
    league.season,
    league.league_type === DYNASTY_LEAGUE_TYPE
      ? dynastyPickGrid(league.season, drafts, league.previous_league_id)
      : null,
  );

  return rosters.map((r) => ({
    roster_id: r.roster_id,
    owner_id: r.owner_id,
    state: {
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
  }));
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
): Promise<
  Array<{ roster_id: number; owner_id: string | null; players: string[] | null }>
> {
  const { rows } = await pool.query<{
    roster_id: number;
    owner_id: string | null;
    players: string[] | null;
  }>(
    `SELECT roster_id, owner_id, players FROM rosters WHERE league_id = $1
      ORDER BY roster_id`,
    [leagueId],
  );
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

/** A pick as one move handed it over — Sleeper's own spelling of both ends. */
export type TimelinePick = {
  season: string;
  round: number;
  roster_id: number;
  owner_id: number | null;
  previous_owner_id: number | null;
};

/**
 * One move in a league, as the timeline replays and labels it.
 *
 * **Read defensively here and sent clean**, which is the one place this differs
 * from what the walk consumes internally. `RewindTransaction` takes the JSONB as
 * `unknown` because Sleeper promises nothing about it and the columns are read
 * straight off `pg`; a payload is a contract, so the blobs are narrowed once — on
 * the server, through the same `./jsonb` readers the walk itself uses — and the
 * browser gets three fields it can trust.
 *
 * **The field names are still Sleeper's**, which is what keeps this assignable to
 * {@link RewindTransaction} (every concrete type is, to `unknown`) and lets the
 * client feed an event straight to `rewindRosters`. Renaming them to something
 * tidier would buy a nicer payload and cost the single definition of what undoing
 * a move means.
 */
export type TimelineEvent = {
  transaction_id: string;
  type: string | null;
  /** Epoch milliseconds. Never null — the read's own bound excludes undated rows. */
  at: number;
  roster_ids: number[];
  /** Player id → the roster that received him. */
  adds: Record<string, number>;
  /** Player id → the roster that gave him up. */
  drops: Record<string, number>;
  draft_picks: TimelinePick[];
};

/** Everything a timeline replays. */
export type RosterTimeline = {
  league_id: string;
  /**
   * The trade the rail stops at, or null where it runs the league's whole log.
   *
   * The two callers differ in this field and in nothing else — see
   * {@link getLeagueTimeline}.
   */
  anchor: { transaction_id: string; at: number } | null;
  /** Every roster as it stands now — what {@link rewindRosters} rewinds from. */
  rosters: LeagueRosterState[];
  /**
   * The league's completed moves, **newest first** — ending with the anchoring
   * trade where there is one, and with the oldest move on file where there is
   * not.
   *
   * Newest-first because that is the direction the walk runs and the order the
   * board is read in (`TRADE_SORT_SQL`); the client turns it into a left-to-right
   * rail. Ending *with* the anchoring trade because the list is truncated there —
   * see the note in {@link getTradeTimeline} on why the read cannot simply take
   * everything at or after the trade's timestamp.
   */
  events: TimelineEvent[];
};

/**
 * Everything needed to replay one league's rosters from a trade to today.
 *
 * **The log crosses the wire, not the answer.** A stop on the rail is the current
 * rosters with the moves since it reversed, and there are as many stops as there
 * are moves — so sending a roster state per stop would be the league's rosters
 * times its transactions, where sending the log is the transactions alone and the
 * browser does arithmetic it can do thousands of times a second. That is what
 * makes scrubbing free after the first request, and it is the same trade
 * `/api/trades` makes in reverse: there the page is what the reader is looking
 * at, here the *derivation* is small enough to hand over.
 *
 * Null where the trade is not one this can answer for, which the sheet draws as
 * no rail at all rather than as an error:
 *
 * - **No such completed trade.** A trade id off a board this database has since
 *   lost, or one that never completed.
 * - **No timestamp.** The rule `tradesNeedingSnapshots` already keeps, for the
 *   same reason: `TRADE_SORT_SQL` folds a missing timestamp to zero, which is
 *   where to *sort* such a row and not a moment to rewind to — "before the oldest
 *   thing in the league" reverses the entire log and answers with rosters from
 *   before the league existed.
 * - **No rosters stored.** A league the crawler has recorded but not yet filled
 *   in; there is nothing to rewind from, and synthesising empty rosters is the
 *   claim this module refuses everywhere else.
 */
export async function getTradeTimeline(
  transactionId: string,
): Promise<RosterTimeline | null> {
  const trade = await readTrade(transactionId);
  if (!trade || trade.at === null) return null;

  const [rosters, tail] = await Promise.all([
    readLeagueRosterStates(trade.league_id),
    readTimelineEvents(trade.league_id, trade.at),
  ]);
  if (rosters.length === 0) return null;

  // **Truncated at the trade rather than trusted to end there**, which the `>=`
  // bound alone does not guarantee. The order is `(at DESC, transaction_id DESC)`,
  // so a move sharing the trade's exact timestamp with a *smaller* id sorts after
  // it and is still inside the bound — reversing the whole tail would then walk
  // past the trade and answer with a league from before moves the timeline never
  // shows. Slicing at the trade's own index is exact under the same total order
  // the board and the snapshot walk are read in.
  const index = tail.findIndex((e) => e.transaction_id === transactionId);
  // Absent is impossible under the bound above and cheap to be sure of: an empty
  // timeline reads as no rail, where a wrong one reads as a fact.
  if (index === -1) return null;

  return {
    league_id: trade.league_id,
    anchor: { transaction_id: transactionId, at: trade.at },
    rosters,
    events: tail.slice(0, index + 1),
  };
}

/**
 * The same replay with its far end taken off: one league's rosters at any moment
 * from **its oldest stored move** to today.
 *
 * This is {@link getTradeTimeline} with the anchor removed, which is the whole of
 * the difference — same rosters, same log, same total order, same reversal. What
 * changes is only where the events stop, so the leagues list gets a rail running
 * all the way back rather than one bounded by a trade the reader happened to
 * press.
 *
 * **"All the way back" is this league id's log and no further, which is a real
 * limit rather than a shortcut.** A Sleeper league id *is* one season, and a
 * dynasty chain links seasons through `previous_league_id` — so the obvious
 * extension is to keep walking into last year. It is not sound: rosters carry
 * over between seasons through no transaction at all, so there is nothing to
 * reverse across the boundary and a walk that crossed it would report last
 * season's league as though this season's roster had always been on it. The
 * honest far end is the first move this league recorded, which is roughly the
 * post-draft roster — subject to the two limits `./rewind` documents, of which
 * "a draft is not a transaction" is the one that bites hardest at exactly this
 * end of the rail.
 *
 * **Cost is the same order as the anchored read on a first sync**, which is what
 * makes it affordable: `syncTradeRosters` already walks a league's whole log the
 * first time it sees one, over the same rows through the same
 * `transactions_league_idx`. What it costs the *wire* is a season of moves rather
 * than a window of them — bounded by the season, sent once, and reused for as
 * long as the browser's own TTL allows, since scrubbing it costs no further
 * requests.
 *
 * Null on the same three terms as the anchored read, plus one of its own: a
 * league nobody has moved a player in has no rail to draw, and reporting an empty
 * one would be a control that explains itself instead of doing anything.
 */
export async function getLeagueTimeline(
  leagueId: string,
): Promise<RosterTimeline | null> {
  const [rosters, events] = await Promise.all([
    readLeagueRosterStates(leagueId),
    readTimelineEvents(leagueId, null),
  ]);
  // Rosters are what the walk rewinds *from*, so none is nothing to say — the
  // same reading `getTradeTimeline` takes, and the same one `readLeagueRosterStates`
  // hands back an empty list to express.
  if (rosters.length === 0 || events.length === 0) return null;

  // No truncation, because there is no anchor to truncate at: every completed
  // dated move in the league is a stop, and the far end is simply the last of
  // them. The `findIndex` the anchored read needs exists only to keep the tail
  // from running *past* its trade.
  return { league_id: leagueId, anchor: null, rosters, events };
}

/** The trade's league and the moment the timeline is anchored on. */
async function readTrade(
  transactionId: string,
): Promise<{ league_id: string; at: number | null } | null> {
  const { rows } = await pool.query<{ league_id: string; at: number | null }>(
    `SELECT league_id, coalesce(status_updated, created)::float8 AS at
       FROM transactions
      WHERE transaction_id = $1 AND type = 'trade' AND status = 'complete'`,
    [transactionId],
  );
  return rows[0] ?? null;
}

/**
 * {@link readTransactionTail} with the timestamp the rail labels each stop by.
 *
 * A second function rather than a column added to that one because the two have
 * different jobs: the sync reverses a tail and never says when anything happened,
 * and paying for a column on every league sync to serve a control nobody may open
 * is the wrong way round. Every other clause is identical, deliberately — the
 * walk is only correct on one total order, and two spellings of it is how a
 * snapshot ends up taken at a different point in the log from the trade the board
 * shows.
 *
 * **`oldest` of null is the whole log**, which is what {@link getLeagueTimeline}
 * asks for. It is spelled as an absent *bound* rather than as a sentinel epoch,
 * because the two are not the same read: `>= 0` would still be a comparison the
 * planner has to apply to every row, and — more to the point — it would silently
 * acquire a meaning if a timestamp were ever negative. An undated move is
 * excluded either way, and by the same clause it is excluded by everywhere else
 * here: it cannot be placed in the total order the reversal depends on.
 */
async function readTimelineEvents(
  leagueId: string,
  oldest: number | null,
): Promise<TimelineEvent[]> {
  const params: unknown[] = [leagueId];
  // Both spellings drop an undated row — `NULL >= n` is null, and the explicit
  // `IS NOT NULL` is what says so where there is no bound to do it implicitly.
  const window =
    oldest === null
      ? `coalesce(t.status_updated, t.created) IS NOT NULL`
      : `coalesce(t.status_updated, t.created) >= $${params.push(oldest)}`;

  const { rows } = await pool.query<RewindTransaction & { at: number }>(
    `SELECT t.transaction_id, t.type, t.roster_ids, t.adds, t.drops,
            t.draft_picks,
            coalesce(t.status_updated, t.created)::float8 AS at
       FROM transactions t
      WHERE t.league_id = $1
        AND t.status = 'complete'
        AND ${window}
      ORDER BY ${TRADE_SORT_SQL} DESC, t.transaction_id DESC`,
    params,
  );
  return rows.map(narrowEvent);
}

/**
 * One row's blobs, narrowed to what the payload promises.
 *
 * Every junk value costs *that fact and nothing else* — the rule the walk's own
 * tests pin. A `roster_ids` that is not an array is an empty list, a player whose
 * roster id is unreadable is dropped from the map, and a pick missing a season, a
 * round or an origin is dropped from the list: reversing half of one would move an
 * asset under a key nothing else will ever match. Both ends of a pick's move stay
 * independently nullable for the same reason the walk reads them independently —
 * not knowing who sent it says nothing about the roster that received it.
 */
function narrowEvent(row: RewindTransaction & { at: number }): TimelineEvent {
  return {
    transaction_id: row.transaction_id,
    type: row.type,
    at: row.at,
    roster_ids: numbers(row.roster_ids),
    adds: playerRosterMap(row.adds),
    drops: playerRosterMap(row.drops),
    draft_picks: items(row.draft_picks).flatMap((raw) => {
      if (!isRecord(raw)) return [];
      const round = asNumber(raw.round);
      const origin = asNumber(raw.roster_id);
      const season = String(raw.season ?? "");
      if (round === null || origin === null || season === "") return [];
      return [
        {
          season,
          round,
          roster_id: origin,
          owner_id: asNumber(raw.owner_id),
          previous_owner_id: asNumber(raw.previous_owner_id),
        },
      ];
    }),
  };
}

/** Sleeper's player id → roster id maps (`adds`, `drops`), read defensively. */
function playerRosterMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const map: Record<string, number> = {};
  for (const [playerId, rosterId] of Object.entries(value)) {
    const id = asNumber(rosterId);
    if (id !== null) map[playerId] = id;
  }
  return map;
}
