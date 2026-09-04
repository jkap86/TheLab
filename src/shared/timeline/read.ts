import { pool } from "@/shared/db";
import {
  DYNASTY_LEAGUE_TYPE,
  LEAGUE_TYPE_SQL,
  dynastyPickGrid,
  leagueTeamName,
  ownedDraftPicks,
} from "@/shared/manager";
import type { LeagueDraft, TradedPick } from "@/shared/manager";
import { asNumber, isRecord, items, numbers } from "@/shared/trades/jsonb";
import { TRADE_SORT_SQL } from "@/shared/trades/sql";

import type { RewindTransaction, RosterState } from "./rewind";

/**
 * The stored halves of a league's replay: what its rosters hold now, and every
 * move that got them there.
 *
 * **It reads stored rows and fetches nothing.** `transactions`, `rosters`,
 * `traded_picks` and `drafts` are what the league crawler and the manager sync
 * already wrote, so a league neither has reached comes back with no timeline
 * rather than being synced on demand — the rule every route but the two
 * documented exceptions keeps.
 *
 * What it does that its neighbours do not is *derive*: the pick portfolio is
 * `traded_picks` overlaid on a grid whose seasons depend on the league's
 * format, which is the same resolution `getManagerLeagueRosters` makes and for
 * the same reason. That cost is affordable here for the reason the rail is
 * behind a press: one league, on a reader's own request, once per open card.
 */

/** One roster as it stands now, named — the state the walk rewinds *from*. */
export type LeagueRosterState = {
  roster_id: number;
  /** Team name, then the owner's display name, then "Roster N". */
  name: string;
  state: RosterState;
};

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
  league_id: string;
  /** Every roster as it stands now, in roster-id order. */
  rosters: LeagueRosterState[];
  /** The league's completed moves, newest first — see {@link readTimelineEvents}. */
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
 * Null on two terms, neither of them an error and neither stopping the league
 * being shown as it stands:
 *
 * - **No rosters stored.** A league the crawler has recorded but not yet filled
 *   in; there is nothing to rewind *from*, and synthesising empty rosters is the
 *   claim this module refuses everywhere else.
 * - **No dated completed moves.** A league nobody has moved a player in has no
 *   rail to draw, and drawing an empty one would be a control that explains
 *   itself instead of doing anything.
 */
export async function getLeagueTimeline(
  leagueId: string,
): Promise<LeagueTimeline | null> {
  const [rosters, events] = await Promise.all([
    readLeagueRosterStates(leagueId),
    readTimelineEvents(leagueId),
  ]);
  if (rosters.length === 0 || events.length === 0) return null;

  return { league_id: leagueId, rosters, events };
}

/**
 * Every roster in the league as it stands now — the state the walk rewinds
 * *from*, with the name the card calls it by already on it.
 *
 * Five reads rather than one because a roster's players are a column and its
 * picks are a derivation, and because naming a team is `league_users`' answer
 * rather than `rosters`'. An empty answer is a league with no rosters stored,
 * which {@link getLeagueTimeline} reads as "nothing to say" rather than as a
 * league of empty teams.
 */
async function readLeagueRosterStates(
  leagueId: string,
): Promise<LeagueRosterState[]> {
  const [league, rosters, users, tradedPicks, drafts] = await Promise.all([
    readLeague(leagueId),
    readRosters(leagueId),
    readUsers(leagueId),
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
    // `leagueTeamName` rather than a second reading of the same two columns:
    // the teams pane on the card in front of this rail calls the team the same
    // thing, and two spellings is how "now" and "then" come to disagree about
    // whose roster a reader is looking at.
    name: leagueTeamName(users, r.roster_id, r.owner_id),
    state: {
      // The column is nullable and untyped — null is Sleeper's own spelling of
      // an empty roster, and a non-array must read as "no players" rather than
      // throw halfway through the walk.
      players: Array.isArray(r.players)
        ? r.players.filter((id): id is string => typeof id === "string")
        : [],
      picks: (picksByRoster.get(r.roster_id) ?? []).map((p) => ({
        season: p.season,
        round: p.round,
        // `ownedDraftPicks` names the origin `original_roster_id`; on the wire
        // and in the transactions being reversed it is Sleeper's `roster_id`.
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

async function readRosters(leagueId: string): Promise<
  Array<{ roster_id: number; owner_id: string | null; players: unknown }>
> {
  const { rows } = await pool.query<{
    roster_id: number;
    owner_id: string | null;
    players: unknown;
  }>(
    `SELECT roster_id, owner_id, players FROM rosters WHERE league_id = $1
      ORDER BY roster_id`,
    [leagueId],
  );
  return rows;
}

/**
 * Who is in the league, for naming a roster.
 *
 * `ORDER BY updated_at` so the newest spelling wins where one person was synced
 * under different names — the same reading `getManagerLeaguemates` takes of the
 * same table.
 */
async function readUsers(leagueId: string): Promise<
  Array<{
    user_id: string;
    display_name: string | null;
    team_name: string | null;
  }>
> {
  const { rows } = await pool.query<{
    user_id: string;
    display_name: string | null;
    team_name: string | null;
  }>(
    `SELECT user_id, display_name, team_name
       FROM league_users WHERE league_id = $1
      ORDER BY updated_at`,
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
    // The two casts the manager queries make for the same reasons: `start_time`
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
