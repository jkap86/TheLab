import { getLeagueChain, getLeagueLineupRows } from "@/shared/manager";
import type { ManagerLeagueRow } from "@/shared/manager";
import { pool } from "@/shared/db";
import { asNumber, isRecord, items, numbers } from "@/shared/trades/jsonb";
import { TRADE_SORT_SQL } from "@/shared/trades/sql";

import type { RewindTransaction } from "./rewind";

/**
 * The stored halves of a league's replay: each season it has run, as a solve
 * reads it, and every move that got that season's rosters where they ended up.
 *
 * **It reads stored rows and fetches nothing from Sleeper.** `transactions`,
 * `rosters`, `traded_picks` and `drafts` are what the league crawler and the
 * manager sync already wrote, so a league neither has reached comes back with
 * no timeline rather than being synced on demand — the rule every route but the
 * documented exceptions keeps. Growing the corpus by one earlier season is a
 * `POST`, and is the timeline route's own sibling.
 *
 * **The league rows are `getLeagueLineupRows`' and not this module's own**,
 * which is what lets a past stop be priced by the same solve the card in front
 * of the rail is drawn by: each rewind starts from that row's rosters and pick
 * grid, and `./pricing` puts today's boards over it.
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

/**
 * One season of a league: the league as it ran that year, and its own moves.
 *
 * **A season is a self-contained replay**, which is the whole of why the
 * timeline is a list of these rather than one long log — see
 * {@link getLeagueTimeline}.
 */
export type TimelineSeason = {
  league: ManagerLeagueRow;
  /** Which year this league ran — `leagues.season`, off the chain read. */
  season: string;
  /** That season's completed moves, newest first — see {@link readTimelineEvents}. */
  events: TimelineEvent[];
};

/** Everything a timeline replays, plus where the stored copy of it runs out. */
export type LeagueTimeline = {
  /**
   * The league's seasons, **newest first** — the one asked for, then each
   * earlier one this database holds.
   */
  seasons: TimelineSeason[];
  /**
   * The season before the oldest stored one, when Sleeper names one and this
   * database does not hold it. Null where the chain is complete.
   */
  earlierLeagueId: string | null;
};

/**
 * One league's rosters at any moment its stored seasons can reach.
 *
 * **A season is rewound from its own stored rosters, and that is what makes
 * crossing a year sound.** This module used to stop at one league id on the
 * argument that a dynasty chain cannot be walked: rosters carry over between
 * seasons through no transaction at all, so there is nothing to reverse across
 * the boundary and a walk that crossed it would report last season's league as
 * though this season's roster had always been on it. **That argument is intact,
 * and it is an argument against continuing one walk** — not against running a
 * second. Sleeper keeps each season as a league of its own, with its own
 * `rosters` frozen at that year's end and its own transaction log, so last
 * season's replay starts from last season's rosters and never mentions this
 * one's. Two reconstructions, each honest about its own year.
 *
 * **The join between them is therefore a jump rather than a move**, and the rail
 * says so: the newest stop of an earlier season is that season as it *ended*,
 * which is not the oldest stop of the season after it. What happened in between
 * — a rookie draft, an offseason of drops, a league that changed size — is
 * exactly what this database has no transactions for, and presenting the two as
 * adjacent notches without marking the boundary would be the same claim in a
 * new place. See `features/shared/timeline` for how a stop names its season.
 *
 * **Where the corpus stops is a different fact from where the league began**,
 * and both are reported: nothing here follows `previous_league_id` to *fetch* a
 * league, so `earlierLeagueId` names the season a reader can ask for and
 * `seasons` is what is already in hand.
 *
 * Null on three terms, none an error and none stopping the league being shown as
 * it stands:
 *
 * - **No such live league stored.** One the crawler has never reached, or one
 *   Sleeper stopped serving.
 * - **No rosters stored on the league asked for.** There is nothing to rewind
 *   *from*, and synthesising empty rosters is the claim this module refuses
 *   everywhere else.
 * - **Nothing to scrub and nothing to offer** — a league nobody has moved a
 *   player in, whose earlier seasons are all in hand or absent from Sleeper.
 *   Drawing an empty rail would be a control that explains itself instead of
 *   doing anything. A league with no moves but an earlier season to load is
 *   deliberately *not* this case: there is something to ask for, so there is
 *   something to draw.
 */
export async function getLeagueTimeline(
  leagueId: string,
): Promise<LeagueTimeline | null> {
  const chain = await getLeagueChain(leagueId);
  if (chain.links.length === 0) return null;

  const leagueIds = chain.links.map((link) => link.league_id);
  const [leagues, eventsByLeague] = await Promise.all([
    getLeagueLineupRows(leagueIds),
    readTimelineEvents(leagueIds),
  ]);
  const seasonOf = new Map(
    chain.links.map((link) => [link.league_id, link.season]),
  );

  // A season with no stored rosters is dropped rather than carried empty — it
  // has nothing to rewind from, which is the same reading the head's own guard
  // takes one line down. Dropping it in the middle of a chain leaves a gap
  // between two years that the rail's own boundary marking already tells the
  // reader about.
  const seasons: TimelineSeason[] = leagues
    .filter((league) => league.rosters.length > 0)
    .map((league) => ({
      league,
      season: seasonOf.get(league.league_id) ?? "",
      events: eventsByLeague.get(league.league_id) ?? [],
    }));

  // The league asked for has to be the head. Without its rosters there is no
  // present to rewind from, and an earlier season standing alone would be a rail
  // whose right-hand end is not the card it sits above.
  if (seasons[0]?.league.league_id !== leagueId) return null;

  const stops = seasons.reduce((sum, season) => sum + season.events.length + 1, 0);
  if (stops <= 1 && chain.earlier_league_id === null) return null;

  return { seasons, earlierLeagueId: chain.earlier_league_id };
}

/**
 * Every completed move in each of these leagues, newest first within a league,
 * with the timestamp the rail labels each stop by.
 *
 * **One round trip for the whole chain**, keyed back out by league: a chain is a
 * handful of seasons and the alternative is a query per season on a read that is
 * already the heaviest thing the manager page makes.
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
 *   from the trade a reader is looking at one page over. It orders **within** a
 *   league here rather than across the chain, which is the same distinction the
 *   seasons themselves draw: two leagues' logs are two orders, not one.
 */
async function readTimelineEvents(
  leagueIds: readonly string[],
): Promise<Map<string, TimelineEvent[]>> {
  const { rows } = await pool.query<
    RewindTransaction & { at: number; league_id: string }
  >(
    `SELECT t.league_id, t.transaction_id, t.type, t.roster_ids, t.adds,
            t.drops, t.draft_picks,
            coalesce(t.status_updated, t.created)::float8 AS at
       FROM transactions t
      WHERE t.league_id = ANY($1::varchar[])
        AND t.status = 'complete'
        AND coalesce(t.status_updated, t.created) IS NOT NULL
      ORDER BY t.league_id, ${TRADE_SORT_SQL} DESC, t.transaction_id DESC`,
    [[...leagueIds]],
  );

  const byLeague = new Map<string, TimelineEvent[]>();
  for (const row of rows) {
    let list = byLeague.get(row.league_id);
    if (!list) byLeague.set(row.league_id, (list = []));
    list.push(narrowEvent(row));
  }
  return byLeague;
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
