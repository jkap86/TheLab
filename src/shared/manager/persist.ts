import type { PoolClient } from "pg";

import { bulkInsert, jsonb as j, pool, withTransaction } from "@/shared/db";
import type { SleeperLeague } from "@/shared/sleeper";

import type { LeagueGraph } from "./graph";
import { dedupeMatchups } from "./matchups";

/**
 * Store leagues Sleeper no longer serves, tombstoned on arrival.
 *
 * `markLeaguesGone` is this marker for a league we already store; this is the
 * same marker for one we never did — a league that appears in some member's
 * league list and then 404s the moment the crawler fetches its graph. Writing
 * the row is what retires it: the id counts as known from then on, so discovery
 * stops selecting it, and `gone_at` keeps it out of the refresh queue. Without a
 * row there is nowhere to record the answer, so every member of that league
 * rediscovers it forever.
 *
 * No children are written — there was never a graph to store — and the conflict
 * clause stamps only the marker: a row already here came from a sync that
 * actually saw the league, and that data is better than the enumeration payload
 * this holds. `persistLeagueGraph` clears the marker if it comes back.
 */
export async function persistGoneLeagues(
  leagues: readonly SleeperLeague[],
): Promise<void> {
  await bulkInsert(pool, {
    table: "leagues",
    columns: [
      "league_id", "name", "season", "sport", "status", "total_rosters", "avatar",
      "previous_league_id", "draft_id", "roster_positions", "settings",
      "scoring_settings", "metadata",
    ],
    rows: leagues,
    values: (x) => [
      x.league_id, x.name, x.season, x.sport, x.status, x.total_rosters, x.avatar,
      x.previous_league_id, x.draft_id, j(x.roster_positions), j(x.settings),
      j(x.scoring_settings), j(x.metadata),
    ],
    trailing: { column: "gone_at", sql: "now()" },
    onConflict: `(league_id) DO UPDATE SET gone_at = now()`,
  });
}

/** Persist one league graph inside an open transaction. */
async function writeLeagueGraph(client: PoolClient, g: LeagueGraph): Promise<void> {
  const l = g.league;

  await bulkInsert(client, {
    table: "leagues",
    columns: [
      "league_id", "name", "season", "sport", "status", "total_rosters", "avatar",
      "previous_league_id", "draft_id", "roster_positions", "settings",
      "scoring_settings", "metadata",
    ],
    rows: [l],
    values: (x) => [
      x.league_id, x.name, x.season, x.sport, x.status, x.total_rosters, x.avatar,
      x.previous_league_id, x.draft_id, j(x.roster_positions), j(x.settings),
      j(x.scoring_settings), j(x.metadata),
    ],
    trailing: { column: "updated_at", sql: "now()" },
    onConflict: `(league_id) DO UPDATE SET
        name = EXCLUDED.name, season = EXCLUDED.season, sport = EXCLUDED.sport,
        status = EXCLUDED.status, total_rosters = EXCLUDED.total_rosters,
        avatar = EXCLUDED.avatar, previous_league_id = EXCLUDED.previous_league_id,
        draft_id = EXCLUDED.draft_id, roster_positions = EXCLUDED.roster_positions,
        settings = EXCLUDED.settings, scoring_settings = EXCLUDED.scoring_settings,
        metadata = EXCLUDED.metadata, updated_at = now(),
        -- Sleeper just answered for this league, so any crawler tombstone is
        -- stale — clearing it puts the league back in the refresh queue.
        gone_at = NULL`,
  });

  // Child collections are replaced wholesale so the DB mirrors Sleeper.
  await client.query(`DELETE FROM league_users WHERE league_id = $1`, [l.league_id]);
  await bulkInsert(client, {
    table: "league_users",
    columns: [
      "league_id", "user_id", "display_name", "avatar", "team_name", "is_owner",
      "is_bot", "metadata",
    ],
    rows: g.users,
    values: (u) => [
      l.league_id, u.user_id, u.display_name, u.avatar,
      u.metadata?.team_name ?? null, u.is_owner, u.is_bot, j(u.metadata),
    ],
  });

  await client.query(`DELETE FROM rosters WHERE league_id = $1`, [l.league_id]);
  await bulkInsert(client, {
    table: "rosters",
    columns: [
      "league_id", "roster_id", "owner_id", "players", "starters", "reserve",
      "taxi", "settings", "metadata",
    ],
    rows: g.rosters,
    values: (r) => [
      l.league_id, r.roster_id, r.owner_id, j(r.players), j(r.starters),
      j(r.reserve), j(r.taxi), j(r.settings), j(r.metadata),
    ],
  });

  await client.query(`DELETE FROM traded_picks WHERE league_id = $1`, [l.league_id]);
  await bulkInsert(client, {
    table: "traded_picks",
    columns: ["league_id", "season", "round", "roster_id", "owner_id", "previous_owner_id"],
    rows: g.tradedPicks,
    values: (p) => [l.league_id, p.season, p.round, p.roster_id, p.owner_id, p.previous_owner_id],
  });

  // Deleting drafts cascades to draft_picks, so re-insert both.
  await client.query(`DELETE FROM drafts WHERE league_id = $1`, [l.league_id]);
  await bulkInsert(client, {
    table: "drafts",
    columns: [
      "draft_id", "league_id", "season", "status", "type", "start_time",
      "last_picked", "draft_order", "settings", "metadata",
    ],
    rows: g.drafts,
    values: (d) => [
      d.draft_id, l.league_id, d.season, d.status, d.type, d.start_time,
      // Coalesced because Sleeper's draft shape is not versioned: a build that
      // stopped sending `last_picked` must store null (no cutoff, every trade
      // kept) rather than `undefined`, which bulkInsert would bind as a
      // parameter the column can't take.
      d.last_picked ?? null,
      j(d.draft_order), j(d.settings), j(d.metadata),
    ],
  });
  await bulkInsert(client, {
    table: "draft_picks",
    columns: ["draft_id", "pick_no", "round", "roster_id", "player_id", "picked_by", "metadata"],
    rows: g.draftPicks,
    values: (p) => [p.draft_id, p.pick_no, p.round, p.roster_id, p.player_id, p.picked_by, j(p.metadata)],
  });

  // Replace only the weeks we re-fetched; earlier weeks (frozen once past) stay.
  await client.query(
    `DELETE FROM transactions WHERE league_id = $1 AND week BETWEEN $2 AND $3`,
    [l.league_id, g.txWeeks.from, g.txWeeks.to],
  );
  await bulkInsert(client, {
    table: "transactions",
    columns: [
      "transaction_id", "league_id", "type", "status", "week", "creator", "created",
      "status_updated", "roster_ids", "consenter_ids", "adds", "drops",
      "draft_picks", "waiver_budget", "settings", "metadata",
    ],
    rows: g.transactions,
    values: (t) => [
      t.transaction_id, l.league_id, t.type, t.status, t.leg, t.creator,
      t.created, t.status_updated, j(t.roster_ids), j(t.consenter_ids),
      j(t.adds), j(t.drops), j(t.draft_picks), j(t.waiver_budget),
      j(t.settings), j(t.metadata),
    ],
  });

  // Same rule as transactions, for the same reason: only the weeks this sync
  // re-fetched are replaced. Points do move after a week closes (stat
  // corrections), which is what the refresh window's one week of look-back is
  // for — earlier weeks are settled and stay as stored.
  await client.query(
    `DELETE FROM matchups WHERE league_id = $1 AND week BETWEEN $2 AND $3`,
    [l.league_id, g.matchupWeeks.from, g.matchupWeeks.to],
  );
  await bulkInsert(client, {
    table: "matchups",
    columns: [
      "league_id", "week", "roster_id", "matchup_id", "points", "custom_points",
      "starters", "players", "starters_points", "players_points",
    ],
    rows: dedupeMatchups(g.matchups),
    values: (m) => [
      l.league_id, m.week, m.roster_id, m.matchup_id, m.points,
      m.custom_points, j(m.starters), j(m.players), j(m.starters_points),
      j(m.players_points),
    ],
    // Reached only across chunk boundaries — a duplicate *within* one INSERT is
    // what {@link dedupeMatchups} is for, because `ON CONFLICT DO UPDATE` does
    // not cover that case: Postgres refuses the whole command with "cannot
    // affect row a second time" rather than applying the clause.
    onConflict: `(league_id, week, roster_id) DO UPDATE SET
        matchup_id = EXCLUDED.matchup_id, points = EXCLUDED.points,
        custom_points = EXCLUDED.custom_points, starters = EXCLUDED.starters,
        players = EXCLUDED.players, starters_points = EXCLUDED.starters_points,
        players_points = EXCLUDED.players_points, updated_at = now()`,
  });
}

/** Persist one league graph in its own transaction (atomic per league). */
export function persistLeagueGraph(g: LeagueGraph): Promise<void> {
  return withTransaction((client) => writeLeagueGraph(client, g));
}

/**
 * Store the order Sleeper listed a manager's leagues in, replacing what was
 * stored for that (manager, season).
 *
 * Only the manager's own sync calls this, because it is the only place that
 * enumeration happens for a known manager — the crawler reaches a league from
 * whichever member came up in its queue, which says nothing about where that
 * league sits in anyone's list.
 *
 * The wipe is guarded on a non-empty fetch, the same rule the projections
 * refresh follows: Sleeper answers 200-with-null (→ `[]`) for a user it can't
 * resolve, and an ordering dropped on that hiccup would silently re-sort every
 * league on screen. Leaving a stale row costs nothing — it only orders a league
 * the manager still belongs to.
 */
export function replaceManagerLeagueOrder(
  userId: string,
  season: string,
  leagueIds: readonly string[],
): Promise<void> {
  if (leagueIds.length === 0) return Promise.resolve();
  // Deduplicated by first mention: the primary key is (manager, season, league),
  // so a league Sleeper listed twice would fail the whole sync over a position
  // nobody can tell apart.
  const ordered = [...new Set(leagueIds)];
  return withTransaction(async (client) => {
    await client.query(
      `DELETE FROM manager_league_order WHERE user_id = $1 AND season = $2`,
      [userId, season],
    );
    await bulkInsert(client, {
      table: "manager_league_order",
      columns: ["user_id", "season", "league_id", "position"],
      rows: ordered.map((leagueId, position) => ({ leagueId, position })),
      values: (r) => [userId, season, r.leagueId, r.position],
    });
  });
}

/**
 * Highest week already stored per league in one of the week-keyed tables.
 *
 * The table is a closed union rather than a string, because it is interpolated:
 * these are the only two collections Sleeper keys by week, and each needs its
 * own answer. A league absent from the map has nothing stored there yet (→ full
 * backfill), which is exactly the state every league is in for `matchups` until
 * a sync has run since they were first stored — reading the transaction gate for
 * both would leave those weeks permanently behind the refresh window.
 */
async function maxWeekByLeague(
  table: "transactions" | "matchups",
  leagueIds: string[],
): Promise<Map<string, number>> {
  if (leagueIds.length === 0) return new Map();
  const { rows } = await pool.query<{ league_id: string; max_week: number }>(
    `SELECT league_id, max(week) AS max_week
       FROM ${table}
      WHERE league_id = ANY($1::varchar[]) AND week IS NOT NULL
      GROUP BY league_id`,
    [leagueIds],
  );
  return new Map(rows.map((r) => [r.league_id, Number(r.max_week)]));
}

/**
 * Highest transaction week already stored per league, for the given league ids.
 * Leagues with no transactions yet are absent from the map (→ full backfill).
 */
export function getStoredMaxWeekByLeague(
  leagueIds: string[],
): Promise<Map<string, number>> {
  return maxWeekByLeague("transactions", leagueIds);
}

/**
 * Highest matchup week already stored per league. Absent means no matchups yet,
 * which backfills the season — see {@link maxWeekByLeague}.
 */
export function getStoredMaxMatchupWeekByLeague(
  leagueIds: string[],
): Promise<Map<string, number>> {
  return maxWeekByLeague("matchups", leagueIds);
}
