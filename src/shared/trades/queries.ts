import Cursor from "pg-cursor";

import { pool } from "@/shared/db";

import { assembleTrade } from "./assemble";
import type { TradeRow } from "./assemble";
import type { Trade } from "./types";

/**
 * How many trades one round trip to Postgres carries. **This is a chunk size,
 * not a cap** — {@link streamAllTrades} walks the whole season, and the only
 * thing this number decides is how often it yields.
 *
 * That distinction is the whole shape of this module and it used to be the other
 * way round: a hard `LIMIT 2000` on one query, because the page filters on the
 * client over everything it is handed and 48k trades arriving as one JSON blob
 * is ~20MB the browser can do nothing with until the last byte lands. Streaming
 * pays that cost progressively instead of refusing to pay it, so the season is
 * whole again and the board stopped being the newest slice of itself.
 *
 * A thousand is chosen against the client, not the database — Postgres does not
 * care either way. What it used to be traded against was the page re-filtering
 * everything it held on every chunk, which made a smaller chunk buy earlier
 * first paint at the cost of re-walking a growing list more often. That cost is
 * gone (`features/trades/incremental.ts` judges only what is new, and the hook
 * publishes on a cadence rather than per chunk), so what a smaller chunk would
 * buy now is only a slightly earlier first paint against more round trips and
 * more NDJSON framing. The two considerations that remain are the ones this
 * number was always really about: a chunk is the granularity an aborted request
 * stops at, and it is how much of the season this process holds at once.
 */
export const TRADES_CHUNK_SIZE = 1000;

/** One chunk of the season, newest first. */
export type TradesChunk = { trades: Trade[] };

/**
 * A league's *first* draft, for leagues that have no previous season — the
 * startup, whose status and last pick are the boundary {@link streamAllTrades}
 * drops trades before.
 *
 * Three decisions are packed into this, and each one is a way of getting it
 * wrong:
 *
 * - **The first draft, not the latest.** An inaugural dynasty league can run a
 *   rookie draft after its startup in the same league year, and taking the later
 *   draft's last pick would hide months of real trades between the two. Ordering
 *   by `start_time` with nulls last picks the startup and leaves an undated stray
 *   draft as the fallback rather than the answer.
 * - **No previous league is what makes a draft a startup.** A continuing dynasty
 *   league's draft is a rookie draft — additive to rosters that already exist —
 *   so it bounds nothing and the league is simply absent here. Sleeper spells the
 *   empty case as null, `''` and `'0'` depending on vintage, so all three read as
 *   "no previous season".
 * - **The row is selected whatever it holds, and the reading happens in
 *   `streamAllTrades`.** `last_picked` alone can't say whether the startup is over,
 *   so the status has to travel with it; filtering the unusable rows out here —
 *   as this did — is what left an unfinished startup looking like a league with
 *   no boundary at all.
 */
const STARTUP_DRAFT_SQL = `
  SELECT DISTINCT ON (d.league_id) d.league_id, d.last_picked, d.status
    FROM drafts d
    JOIN leagues l ON l.league_id = d.league_id
   WHERE l.season = $1
     AND coalesce(l.previous_league_id, '') IN ('', '0')
   ORDER BY d.league_id, d.start_time ASC NULLS LAST, d.draft_id`;

/**
 * The population both reads below are over: which trades of a season are on the
 * board at all.
 *
 * Written once and shared by {@link streamAllTrades} and
 * {@link countAllTrades}, which is the thing that used to be guaranteed by the
 * count riding on the streaming query as a window aggregate. That guarantee was
 * worth keeping and its mechanism was not — a blocking `count(*) OVER ()` makes
 * every row wait for the last one — so the predicate moved into a constant and
 * the two queries build on it. There is exactly one place for the two to
 * disagree, and it is not a place either query can reach.
 *
 * `$1` is the season. See the doc on {@link streamAllTrades} for what each half
 * of the boundary is doing and why both columns stay inert when they say
 * nothing.
 */
const TRADES_POPULATION_SQL = `
   FROM transactions t
   JOIN leagues l ON l.league_id = t.league_id
   -- Joined on the league alone: what the startup row *says* is the whole
   -- decision below, and a row filtered out here would be indistinguishable
   -- from a league that has no startup at all — which is how an unfinished
   -- draft used to keep every trade it was supposed to drop.
   LEFT JOIN startup_draft sd ON sd.league_id = t.league_id
  WHERE l.season = $1 AND t.type = 'trade' AND t.status = 'complete'
    -- A continuing dynasty has no startup row, so it keeps everything.
    AND (sd.league_id IS NULL
         -- An unfinished startup drops the lot; a status Sleeper didn't send
         -- is unknown, and unknown stays inert rather than hiding a league.
         OR ((sd.status IS NULL OR sd.status = 'complete')
             -- Inert on an absent bound: no last pick stored is no cutoff.
             -- Comparing above zero reads a zero as the absent value Sleeper
             -- means by it, not as 1970.
             AND (sd.last_picked IS NULL OR sd.last_picked <= 0
                  -- Spelled out rather than left to NULL propagation, because
                  -- the undated case is a decision and not a side effect: a
                  -- trade Sleeper filed with no timestamp has no honest side
                  -- of this boundary, so a league that has one drops it — the
                  -- same rule the date filters and /api/adp follow for an
                  -- undated draft.
                  OR (coalesce(t.status_updated, t.created) IS NOT NULL
                      AND coalesce(t.status_updated, t.created) > sd.last_picked))))`;

/**
 * How many trades {@link streamAllTrades} will yield for this season.
 *
 * **A query of its own, run concurrently with the stream rather than ahead of
 * it.** It was `count(*) OVER ()` on the streaming query, where it read as free,
 * and the reasoning behind that was sound as far as it went: the sort has
 * materialised the result either way, so the window counts something Postgres is
 * already holding. Measured against ~50k trades in a 1.6M-row table, removing it
 * takes the walk from 301ms to 286ms — the ~4% that reasoning predicts.
 *
 * The reason to remove it anyway is not the 4%. A number that rides on the rows
 * is a number the *first* row cannot arrive without, so as long as the count
 * lived there the protocol had no way to send trades before it — which is the
 * whole of {@link TradesChunkMessage}'s first-paint problem, one layer down.
 * Counted separately, it is a 56ms query running beside the walk and finishing
 * on its own schedule.
 *
 * Counted over {@link TRADES_POPULATION_SQL}, the same constant the stream is
 * built on, so the two cannot come to different views of what the season holds.
 * The route runs it beside the walk and sends the answer when it has one; a
 * denominator that arrives a beat late costs a progress line its percentage and
 * costs the list nothing.
 */
export async function countAllTrades(season: string): Promise<number> {
  const { rows } = await pool.query<{ total: string }>(
    `WITH startup_draft AS (${STARTUP_DRAFT_SQL})
      SELECT count(*) AS total ${TRADES_POPULATION_SQL}`,
    [season],
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Every completed trade in every crawled league for a season, newest first, in
 * chunks of {@link TRADES_CHUNK_SIZE}.
 *
 * **A generator rather than an array, because the whole season no longer fits
 * anywhere comfortably.** A busy season is ~48k trades — ~20MB of JSON, and
 * several times that as live objects — so materialising it costs that much in
 * this process, again in the response buffer, and again in the browser, none of
 * which can begin until the last row is read. Yielding lets all three overlap:
 * the route serialises a chunk while Postgres reads the next, and the page draws
 * the newest trades while the rest of the season is still arriving.
 *
 * It is one query read through a **cursor**, not a paginated series of them, and
 * that is the difference that matters. The ordering is newest-first over a set
 * this size, so the sort is unavoidable — but it is paid *once*, where a
 * chunk-per-query walk would re-sort the season on every round trip and need a
 * tiebreaker the old `ORDER BY` never had (it ordered on the timestamp alone,
 * which is stable enough for one read and would silently drop and duplicate rows
 * across a keyset walk). The cursor holds the sorted result in Postgres and hands
 * it over a chunk at a time, so this process holds one chunk.
 *
 * **Keyset pagination was measured against it and lost, which is worth writing
 * down because it reads like the obvious modernisation.** Against a 1.6M-row
 * `transactions` table holding ~50k trades for the season, walking the same
 * season as 50 `LIMIT`-bounded queries resumed on
 * `(coalesce(status_updated, created), transaction_id)`:
 *
 * | | first chunk | whole season |
 * | --- | --- | --- |
 * | cursor | 117ms | **232ms** |
 * | keyset | **8ms** | 529ms |
 *
 * Keyset wins the first page and loses the walk, and the reason is in the plans
 * rather than in the arithmetic: with a `LIMIT` the planner takes a fast-start
 * ordered index walk, but only while the resume predicate stays selective.
 * Deeper into the season it flips to a bitmap scan and a top-N heapsort, which
 * re-reads and re-sorts everything still ahead of the cursor — so each page
 * costs more than the last and the total grows with depth. The cursor's sort is
 * paid once and every chunk after the first is nearly free.
 *
 * The other case for keyset is that it holds no server-side state, and that one
 * is answered rather than traded away: the route now aborts this generator the
 * moment the client disconnects, so the cursor and its connection are released
 * within one chunk instead of at the end of the season. What keyset would have
 * bought was a shorter hold; cancelling buys the same thing without paying 2.3x
 * the database work for it.
 *
 * The connection is checked out for the life of the walk, which is why the
 * caller must drain, close or abort the generator — a `return` or a `throw` in
 * the consumer runs the `finally` and releases it, but abandoning the iterator
 * without either would leak it. `signal` is the third way in and the one that
 * matters at scale: an aborted request stops the walk at the next chunk
 * boundary, so nothing keeps reading trades for a page nobody is looking at.
 * The bound is one chunk rather than instant — a `read` already in flight is a
 * round trip Postgres is going to finish either way — and one chunk is a few
 * milliseconds against the tens of seconds the whole walk used to run for.
 *
 * Read-only over what the league crawl and the manager syncs stored: this is the
 * whole market this database has seen, not one account's corner of it — which is
 * the point of the page, since the leagues a reader plays in are a fraction of
 * the trades worth reading and the "managers involved" filter is what narrows it
 * back to their own. The sync mirrors transactions week by week, so a league's
 * trade history is only as complete as the weeks it has fetched.
 *
 * Pending and vetoed trades are left out. `status = 'complete'` is Sleeper's
 * marker for one that actually went through, and a proposal that never happened
 * would read on the page as a move that did.
 *
 * **Trades made before a league's startup draft finished are left out too**, on
 * the boundary {@link STARTUP_DRAFT_SQL} resolves. A startup fills empty rosters
 * from the whole player pool, so everything traded up to its last pick is draft
 * position changing hands — a room full of pick swaps, dozens in a day in one
 * league — and none of it is the market this board is about. It stays in SQL now
 * that nothing is capped, for a plainer reason than the budget it used to
 * protect: this is what the season's `total` is counted over, so a population
 * defined here is the one the board states, where hiding the same rows on the
 * client would leave the count quoting trades nobody can see.
 *
 * **A boundary is only a boundary once the startup is over, which is why the
 * draft's status is read and not just its last pick.** On a running draft
 * `last_picked` is the running edge, and a trade made in the draft room lands
 * *after* the pick before it — so comparing against it kept essentially every
 * in-draft trade, which is the whole population this is meant to drop. A startup
 * that hasn't reached its first pick is the same hole spelled differently: no
 * `last_picked` at all, so nothing was excluded. An unfinished startup therefore
 * drops the league's trades outright — until it ends there is no post-startup
 * market to be reading — and the comparison applies only once the draft says
 * `complete`.
 *
 * Both columns stay inert when they say nothing. A league whose first draft has
 * no stored `last_picked` (or none stored at all) keeps every trade, so this is
 * inert until the crawler has re-visited a league since the column was added
 * rather than wrong in the meantime, and an unknown status is read as finished
 * rather than as evidence a draft is running.
 */
export async function* streamAllTrades(
  season: string,
  {
    chunkSize = TRADES_CHUNK_SIZE,
    signal,
  }: { chunkSize?: number; signal?: AbortSignal } = {},
): AsyncGenerator<TradesChunk> {
  if (signal?.aborted) return;

  const client = await pool.connect();
  const cursor = client.query(
    new Cursor<TradeRow>(
      // The epoch columns are BIGINT, which `pg` hands back as strings; cast
      // here rather than converting downstream so they leave the query layer as
      // numbers. float8 is exact well past any millisecond timestamp.
      `WITH startup_draft AS (${STARTUP_DRAFT_SQL})
        SELECT
          t.transaction_id, t.league_id, t.week,
          t.created::float8         AS created,
          t.status_updated::float8  AS status_updated,
          t.roster_ids, t.adds, t.draft_picks, t.waiver_budget
        ${TRADES_POPULATION_SQL}
        ORDER BY coalesce(t.status_updated, t.created) DESC NULLS LAST`,
      [season],
    ),
  );

  // Resolved per chunk but remembered across them: the same league supplies
  // trades all season long, so a league's roster owners are read once however
  // many chunks name it.
  const owners = new Map<string, ReadonlyMap<number, string>>();

  try {
    for (;;) {
      if (signal?.aborted) return;

      const rows = await cursor.read(chunkSize);
      // A short read is not the end — only an empty one is — so this loops on
      // length rather than comparing against `chunkSize`.
      if (rows.length === 0) break;
      // Checked again on the far side of the read: a chunk is a round trip, and
      // this is where an abort raised during one is noticed. Returning here
      // skips the roster lookup and the assembly for rows nobody will see, and
      // runs the `finally` that hands the connection back.
      if (signal?.aborted) return;

      const unseen = [
        ...new Set(rows.map((r) => r.league_id).filter((id) => !owners.has(id))),
      ];
      if (unseen.length > 0) {
        const fetched = await rosterOwners(unseen);
        // Every id is recorded, including the ones that came back with nothing,
        // so a league whose rosters aren't cached is asked about once rather
        // than on every chunk it appears in.
        for (const id of unseen) owners.set(id, fetched.get(id) ?? EMPTY_OWNERS);
      }

      yield {
        trades: rows.map((row) =>
          assembleTrade(row, owners.get(row.league_id) ?? EMPTY_OWNERS),
        ),
      };
    }
  } finally {
    // Reached on every exit — draining, a `throw`, the consumer's `return()`,
    // and the abort checks above — which is what makes the connection's release
    // unconditional rather than a property of the happy path.
    //
    // `close` before `release`, and both guarded: an abandoned cursor left on a
    // connection returned to the pool is a portal the next borrower inherits.
    try {
      await cursor.close();
    } catch {
      // The connection is being released either way.
    }
    client.release();
  }
}

const EMPTY_OWNERS: ReadonlyMap<number, string> = new Map();

/**
 * Roster id → owner, per league. A trade names rosters, and a reader thinks in
 * managers; a roster with no cached owner is simply absent, which the assembler
 * reads as an unnamed side rather than a reason to drop the trade.
 *
 * One query for every league rather than one per trade: a season of trades is
 * hundreds of rows over a hundred-odd leagues, and the same roster appears in
 * many of them.
 */
async function rosterOwners(
  leagueIds: string[],
): Promise<Map<string, Map<number, string>>> {
  const { rows } = await pool.query<{
    league_id: string;
    roster_id: number;
    owner_id: string | null;
  }>(
    `SELECT league_id, roster_id, owner_id
       FROM rosters
      WHERE league_id = ANY($1::varchar[]) AND owner_id IS NOT NULL`,
    [leagueIds],
  );

  const byLeague = new Map<string, Map<number, string>>();
  for (const r of rows) {
    if (!r.owner_id) continue;
    let league = byLeague.get(r.league_id);
    if (!league) byLeague.set(r.league_id, (league = new Map()));
    league.set(r.roster_id, r.owner_id);
  }
  return byLeague;
}

/**
 * The league members every one of these trades names, keyed by user id, so the
 * client can label a side with a person rather than a roster number.
 *
 * Resolved through `league_users` rather than the `users` table because a
 * leaguemate is rarely a manager anyone has looked up: the sync writes every
 * member of every league it touches, and that is the only row most of them have.
 * Where the same person was synced under different names across leagues, the
 * newest wins — the same rule {@link getManagerLeaguemates} follows.
 */
export async function getTradeManagers(
  userIds: readonly string[],
): Promise<Map<string, { display_name: string | null; avatar: string | null }>> {
  if (userIds.length === 0) return new Map();

  const { rows } = await pool.query<{
    user_id: string;
    display_name: string | null;
    avatar: string | null;
  }>(
    `SELECT DISTINCT ON (user_id) user_id, display_name, avatar
       FROM league_users
      WHERE user_id = ANY($1::varchar[])
      ORDER BY user_id, updated_at DESC`,
    [[...userIds]],
  );

  return new Map(
    rows.map((r) => [
      r.user_id,
      { display_name: r.display_name, avatar: r.avatar },
    ]),
  );
}
