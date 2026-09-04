import { getLeagueLineupRow } from "@/shared/manager";
import type { ManagerLeagueRow } from "@/shared/manager";
import { pool } from "@/shared/db";
import { asNumber, isRecord, items, numbers } from "@/shared/trades/jsonb";
import { TRADE_SORT_SQL } from "@/shared/trades/sql";

import type { RewindTransaction } from "./rewind";

/**
 * The stored halves of a league's replay: the league as a solve reads it, and
 * every move that got its rosters where they are.
 *
 * **It reads stored rows and fetches nothing from Sleeper.** `transactions`,
 * `rosters`, `traded_picks` and `drafts` are what the league crawler and the
 * manager sync already wrote, so a league neither has reached comes back with
 * no timeline rather than being synced on demand — the rule every route but the
 * two documented exceptions keeps.
 *
 * **The league row is `getLeagueLineupRow`'s and not this module's own**, which
 * is what lets a past stop be priced by the same solve the card in front of the
 * rail is drawn by: the rewind starts from that row's rosters and pick grid, and
 * `./pricing` puts today's boards over it.
 */

/** One move, narrowed to what the payload promises. */
export type TimelineEvent = {
  transaction_id: string;
  type: string | null;
  /** Epoch milliseconds. Never null — the read's own clause excludes undated rows. */
  at: number;
  roster_ids: number[];
  adds: Record<string, number>;
  drops: Record<string, number>;
  draft_picks: TimelinePick[];
};

/** A pick as one move handed it over — Sleeper's own spelling of both ends. */
export type TimelinePick = {
  season: string;
  round: number;
  roster_id: number;
  owner_id: number | null;
  previous_owner_id: number | null;
};

/** Everything a timeline replays. */
export type LeagueTimeline = {
  /** The league as a solve reads it — rosters, members, picks, drafts. */
  league: ManagerLeagueRow;
  /** Its completed moves, newest first — see {@link readTimelineEvents}. */
  events: TimelineEvent[];
};

/**
 * One league's rosters at any moment from its **oldest stored move** to today.
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
 * "a draft is not a transaction" is the one that bites hardest at exactly that
 * end of the rail.
 *
 * Null on three terms, none an error and none stopping the league being shown
 * as it stands:
 *
 * - **No such live league stored.** One the crawler has never reached, or one
 *   Sleeper stopped serving.
 * - **No rosters stored.** There is nothing to rewind *from*, and synthesising
 *   empty rosters is the claim this module refuses everywhere else.
 * - **No dated completed moves.** A league nobody has moved a player in has no
 *   rail to draw, and drawing an empty one would be a control that explains
 *   itself instead of doing anything.
 */
export async function getLeagueTimeline(
  leagueId: string,
): Promise<LeagueTimeline | null> {
  const [league, events] = await Promise.all([
    getLeagueLineupRow(leagueId),
    readTimelineEvents(leagueId),
  ]);
  if (!league || league.rosters.length === 0 || events.length === 0) return null;

  return { league, events };
}

/**
 * Every completed move in the league, newest first, with the timestamp the rail
 * labels each stop by.
 *
 * Four things about the shape of this read:
 *
 * - **All types, not just trades.** A waiver claim moves a player as surely as
 *   a trade does, so leaving them out would leave every stop holding people the
 *   roster picked up afterwards.
 * - **`status = 'complete'` only.** A failed waiver moved nothing, and reversing
 *   it would take a player off a roster that never gained one.
 * - **Undated rows are excluded.** They cannot be placed in the total order the
 *   reversal depends on, and folding a missing timestamp to zero is where to
 *   *sort* such a row rather than a moment to rewind to.
 * - **The trades board's own ordering.** The walk is only correct on a total
 *   order, and `TRADE_SORT_SQL` is the one the board is already read in; two
 *   spellings of it is how a stop ends up taken at a different point in the log
 *   from the trade a reader is looking at one page over.
 */
async function readTimelineEvents(leagueId: string): Promise<TimelineEvent[]> {
  const { rows } = await pool.query<RewindTransaction & { at: number }>(
    `SELECT t.transaction_id, t.type, t.roster_ids, t.adds, t.drops,
            t.draft_picks,
            coalesce(t.status_updated, t.created)::float8 AS at
       FROM transactions t
      WHERE t.league_id = $1
        AND t.status = 'complete'
        AND coalesce(t.status_updated, t.created) IS NOT NULL
      ORDER BY ${TRADE_SORT_SQL} DESC, t.transaction_id DESC`,
    [leagueId],
  );
  return rows.map(narrowEvent);
}

/**
 * One row's blobs, narrowed to what the payload promises.
 *
 * **Read defensively here and sent clean.** `RewindTransaction` takes the JSONB
 * as `unknown` because Sleeper promises nothing about it; a payload is a
 * contract, so the blobs are narrowed once — on the server, through the same
 * `trades/jsonb` readers the walk itself uses — and the browser gets three
 * fields it can trust. **The field names stay Sleeper's**, which is what keeps
 * this assignable to `RewindTransaction` and lets the client feed an event
 * straight to `rewindRosters`; renaming them would buy a tidier payload and cost
 * the single definition of what undoing a move means.
 *
 * Every junk value costs *that fact and nothing else* — the rule the walk's own
 * tests pin. A `roster_ids` that is not an array is an empty list, a player
 * whose roster id is unreadable is dropped from the map, and a pick missing a
 * season, a round or an origin is dropped from the list.
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
