import type { PoolClient } from "pg";

import { bulkInsert, jsonb as j, pool, withTransaction } from "@/shared/db";
import type { SleeperLeague } from "@/shared/sleeper";

import { dedupeBy } from "./dedupe";
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

  // A refused replacement is said out loud, because it is otherwise invisible:
  // the sync reports this league as synced either way, and the answer that
  // tripped the guard arrived as a 200. Warned rather than thrown — what is
  // stored is still consistent, and the next pass re-fetches.
  const empty = [
    g.users.length === 0 ? "users" : null,
    g.rosters.length === 0 ? "rosters" : null,
  ].filter((name): name is string => name !== null);
  if (empty.length > 0) {
    console.warn(
      `[leagues] ${l.league_id} answered with no ${empty.join(" and ")}; keeping what is stored.`,
    );
  }

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

  // Child collections are replaced wholesale so the DB mirrors Sleeper, and each
  // is deduplicated on its own primary key first — {@link dedupeBy} has why a
  // repeat inside one INSERT costs this league's whole transaction rather than
  // being absorbed by a conflict clause. The keys drop `league_id`, which is
  // constant across one graph.
  //
  // **Users and rosters are replaced only on a non-empty fetch, and the rule
  // behind that guard is whether a collection can legitimately be empty for a
  // live league.** These two cannot — Sleeper ships every league with both — so
  // `[]` here is a failed request wearing a successful answer: `sleeperGet`
  // folds Sleeper's 200-with-null into the fallback without throwing, so nothing
  // upstream raises and the transaction would commit the wipe. What that costs
  // is not cosmetic: an emptied `rosters` drops the league out of every member's
  // list, since `FIELDED_A_TEAM_SQL` reads a roster to decide it was fielded.
  // The guard can only ever keep rows a previous sync wrote — a league that
  // genuinely has none has none stored either, so the skipped delete had nothing
  // to delete.
  //
  // Traded picks, transactions and matchups are *not* guarded, for the same
  // rule read the other way: each empties legitimately (a redraft league trades
  // no picks, a quiet week has no moves), so refusing to clear them would leave
  // rows that quietly look current — the opposite failure, and the one the
  // upsert-then-delete-what's-missing rule exists to prevent.
  if (g.users.length > 0) {
    await client.query(`DELETE FROM league_users WHERE league_id = $1`, [l.league_id]);
    await bulkInsert(client, {
      table: "league_users",
      columns: [
        "league_id", "user_id", "display_name", "avatar", "team_name", "is_owner",
        "is_bot", "metadata",
      ],
      rows: dedupeBy(g.users, (u) => u.user_id),
      values: (u) => [
        l.league_id, u.user_id, u.display_name, u.avatar,
        u.metadata?.team_name ?? null, u.is_owner, u.is_bot, j(u.metadata),
      ],
    });
  }

  if (g.rosters.length > 0) {
    await client.query(`DELETE FROM rosters WHERE league_id = $1`, [l.league_id]);
    await bulkInsert(client, {
      table: "rosters",
      columns: [
        "league_id", "roster_id", "owner_id", "players", "starters", "reserve",
        "taxi", "settings", "metadata",
      ],
      rows: dedupeBy(g.rosters, (r) => String(r.roster_id)),
      values: (r) => [
        l.league_id, r.roster_id, r.owner_id, j(r.players), j(r.starters),
        j(r.reserve), j(r.taxi), j(r.settings), j(r.metadata),
      ],
    });
  }

  await client.query(`DELETE FROM traded_picks WHERE league_id = $1`, [l.league_id]);
  await bulkInsert(client, {
    table: "traded_picks",
    columns: ["league_id", "season", "round", "roster_id", "owner_id", "previous_owner_id"],
    rows: dedupeBy(g.tradedPicks, (p) => `${p.season}:${p.round}:${p.roster_id}`),
    values: (p) => [l.league_id, p.season, p.round, p.roster_id, p.owner_id, p.previous_owner_id],
  });

  // **Drafts are upserted rather than replaced, and that is what takes the
  // cascade out of the picture.** `DELETE FROM drafts` cascades to
  // `draft_picks`, so a drafts fetch that came back empty took the league's ADP
  // corpus with it — and for a league Sleeper has since deleted that is
  // permanent, because the crawler tombstones it and never fetches its graph
  // again. Those picks are exactly what `gone_at` keeps the row around to
  // preserve. Nothing wanted the delete anyway: Sleeper does not drop a draft
  // from a league, and one it stopped listing is the row worth keeping.
  await bulkInsert(client, {
    table: "drafts",
    columns: [
      "draft_id", "league_id", "season", "status", "type", "start_time",
      "last_picked", "draft_order", "settings", "metadata",
    ],
    rows: dedupeBy(g.drafts, (d) => d.draft_id),
    values: (d) => [
      d.draft_id, l.league_id, d.season, d.status, d.type, d.start_time,
      // Coalesced because Sleeper's draft shape is not versioned: a build that
      // stopped sending `last_picked` must store null (no cutoff, every trade
      // kept) rather than `undefined`, which bulkInsert would bind as a
      // parameter the column can't take.
      d.last_picked ?? null,
      j(d.draft_order), j(d.settings), j(d.metadata),
    ],
    onConflict: `(draft_id) DO UPDATE SET
        league_id = EXCLUDED.league_id, season = EXCLUDED.season,
        status = EXCLUDED.status, type = EXCLUDED.type,
        start_time = EXCLUDED.start_time, last_picked = EXCLUDED.last_picked,
        draft_order = EXCLUDED.draft_order, settings = EXCLUDED.settings,
        metadata = EXCLUDED.metadata, updated_at = now()`,
  });

  // Picks are replaced per draft that actually returned some, rather than for
  // every draft on the league: a pick is never un-picked, so a draft answering
  // with none is either pre-draft (nothing stored to lose) or a failed fetch
  // (everything to lose), and neither wants its stored picks cleared. Scoping
  // the delete to the drafts present in the payload is what keeps one draft's
  // failure from emptying another's.
  const pickedDraftIds = [...new Set(g.draftPicks.map((p) => p.draft_id))];
  if (pickedDraftIds.length > 0) {
    await client.query(
      `DELETE FROM draft_picks WHERE draft_id = ANY($1::varchar[])`,
      [pickedDraftIds],
    );
    await bulkInsert(client, {
      table: "draft_picks",
      columns: ["draft_id", "pick_no", "round", "roster_id", "player_id", "picked_by", "metadata"],
      rows: dedupeBy(g.draftPicks, (p) => `${p.draft_id}:${p.pick_no}`),
      values: (p) => [p.draft_id, p.pick_no, p.round, p.roster_id, p.player_id, p.picked_by, j(p.metadata)],
    });
  }

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
    rows: dedupeBy(g.transactions, (t) => t.transaction_id),
    values: (t) => [
      t.transaction_id, l.league_id, t.type, t.status, t.leg, t.creator,
      t.created, t.status_updated, j(t.roster_ids), j(t.consenter_ids),
      j(t.adds), j(t.drops), j(t.draft_picks), j(t.waiver_budget),
      j(t.settings), j(t.metadata),
    ],
    // The delete above covers the weeks this sync re-fetched, and the primary
    // key does not mention a week: a transaction arriving under a different one
    // from the copy already stored — a null `leg`, or a refresh window that has
    // since moved past where it was filed — meets a row the delete never saw.
    // The clause makes the write idempotent whatever week the stored copy wore.
    onConflict: `(transaction_id) DO UPDATE SET
        league_id = EXCLUDED.league_id, type = EXCLUDED.type,
        status = EXCLUDED.status, week = EXCLUDED.week,
        creator = EXCLUDED.creator, created = EXCLUDED.created,
        status_updated = EXCLUDED.status_updated, roster_ids = EXCLUDED.roster_ids,
        consenter_ids = EXCLUDED.consenter_ids, adds = EXCLUDED.adds,
        drops = EXCLUDED.drops, draft_picks = EXCLUDED.draft_picks,
        waiver_budget = EXCLUDED.waiver_budget, settings = EXCLUDED.settings,
        metadata = EXCLUDED.metadata, updated_at = now()`,
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
