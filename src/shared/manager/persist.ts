import type { PoolClient } from "pg";

import { bulkInsert, jsonb as j, pool, withTransaction } from "@/shared/db";

import { dedupeBy } from "./dedupe";
import type { LeagueGraph } from "./graph";
import { dedupeMatchups } from "./matchups";
import { NEVER_REFRESHED_SQL } from "./sync-freshness";

/*
 * TheLabX has two more writers here, both the crawler's: `persistGoneLeagues`
 * (tombstone a league Sleeper 404s the first time it is fetched) and
 * `persistUnsyncedLeagues` (record the row for a discovered league whose first
 * sync failed, so discovery stops re-selecting it). Both exist to bound a
 * discovery pass, and arrive with it. The `gone_at` and `sync_attempt_at`
 * columns they write are already in the schema.
 */

/**
 * The child collections a live league **must** have, and therefore the ones an
 * empty answer for cannot be believed.
 *
 * The rule is the one the guarded deletes below already encode, named so the
 * sync can read it: a collection earns a place here when it can never
 * legitimately be empty for a live league. Sleeper ships every league with
 * members and with rosters, so `[]` for either is a failed request wearing a
 * successful answer — `sleeperGetOptional` folds a 404 and a 200-with-null into
 * the fallback without throwing, so nothing upstream raises.
 *
 * Nothing else belongs here, and the reason is the same rule read the other
 * way. Traded picks empty in a redraft league, transactions and matchups empty
 * in a quiet week, and a draft list can be empty for a league whose draft
 * Sleeper has stopped listing — counting any of those as incomplete would put
 * ordinary leagues on a permanent retry and drown the signal this exists to
 * carry.
 */
export const MANDATORY_GRAPH_COLLECTIONS = ["users", "rosters"] as const;

/** One mandatory collection's name. */
export type MandatoryGraphCollection =
  (typeof MANDATORY_GRAPH_COLLECTIONS)[number];

/**
 * Which mandatory collections a fetched graph came back empty for.
 *
 * Pure and exported so the distinction the sync turns on is testable without a
 * database behind it: an empty list is a graph that can be called *refreshed*,
 * a non-empty one is a graph that was safely *persisted* and nothing more.
 */
export function missingGraphCollections(
  g: Pick<LeagueGraph, "users" | "rosters">,
): MandatoryGraphCollection[] {
  const missing: MandatoryGraphCollection[] = [];
  if (g.users.length === 0) missing.push("users");
  if (g.rosters.length === 0) missing.push("rosters");
  return missing;
}

/**
 * What persisting one league graph actually achieved.
 *
 * **Two facts, and conflating them is the bug this type exists to end.**
 * `persisted` says the transaction committed — every valid piece of the payload
 * is in Postgres and the previous rows for anything mandatory that did not
 * arrive are intact. `complete` says the *upstream* answer was whole. They came
 * apart the moment the guarded deletes landed: a Sleeper child request that
 * failed into `[]` left the stored users and rosters correctly untouched, and
 * then the sync counted the league as loaded, reported `failed === 0`, stamped
 * `synced_at`, and advanced the league's own `updated_at` — so a graph nobody
 * had managed to read was marked fresh for a full TTL and the careful
 * preservation underneath bought nothing.
 */
export type PersistLeagueGraphResult = {
  /** The transaction committed. False is never returned — a throw says that. */
  persisted: boolean;
  /** Every mandatory collection arrived; this graph is genuinely current. */
  complete: boolean;
  /** Why not, in words fit for a log line. Empty when `complete`. */
  incompleteReasons: string[];
};

/**
 * Persist one league graph inside an open transaction, reporting which
 * mandatory collections came back empty.
 *
 * TheLabX also returns `affectedOwnerIds` here — the union of who held a roster
 * before this write and who holds one now, taken off the roster delete's
 * `RETURNING owner_id` — to invalidate three in-process read caches. Those
 * caches are not ported; the set returns with them.
 */
async function writeLeagueGraph(
  client: PoolClient,
  g: LeagueGraph,
): Promise<MandatoryGraphCollection[]> {
  const l = g.league;

  // A refused replacement is said out loud, because it is otherwise invisible:
  // the answer that tripped the guard arrived as a 200. Warned rather than
  // thrown — what is stored is still consistent, and the sync now hears about
  // it through the return value, so the league is not reported as refreshed.
  const missing = missingGraphCollections(g);
  if (missing.length > 0) {
    console.warn(
      `[leagues] ${l.league_id} answered with no ${missing.join(" and ")}; ` +
        `keeping what is stored and leaving the league due.`,
    );
  }
  // **A partial graph must not advance the league's own freshness.**
  // `updated_at` is what `leagueQueueStats` counts due and what
  // `claimStaleLeagues` orders on, so stamping it here would tell the crawler
  // the whole graph is current on the strength of a fetch that failed — and the
  // league would then wait out a full TTL before anybody asked again. Left
  // alone, it stays due and rotates to the back of its own tier on
  // `sync_attempt_at`, which the claim already stamped.
  //
  // **A row that does not exist yet is written as never refreshed**, rather
  // than taking the column's `DEFAULT now()`. The default was the same claim
  // one row over: a league discovered this tick whose users or rosters came
  // back empty had no graph at all, and `updated_at = now()` told the crawler
  // its graph was current — so the very first thing that happened to it was a
  // full freshness TTL of quiet. `NEVER_REFRESHED_SQL` says what is true, and
  // reads correctly everywhere freshness is compared: always past the TTL,
  // always in the starved tier.
  //
  // What keeps that from being a retry loop is `sync_attempt_at`, not this
  // column. `claimStaleLeagues` will not reclaim a league it has attempted
  // inside the same TTL however stale its graph is, so a league that cannot
  // sync is tried exactly as often as the default used to allow — and is no
  // longer lying about it in between.
  const fresh = missing.length === 0;

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
    // The insert's own value, which only a brand-new row ever takes: `now()` for
    // a whole graph, the never-refreshed sentinel for a partial one. An existing
    // row keeps whatever it had, through the conflict clause below.
    trailing: {
      column: "updated_at",
      sql: fresh ? "now()" : NEVER_REFRESHED_SQL,
    },
    onConflict: `(league_id) DO UPDATE SET
        name = EXCLUDED.name, season = EXCLUDED.season, sport = EXCLUDED.sport,
        status = EXCLUDED.status, total_rosters = EXCLUDED.total_rosters,
        avatar = EXCLUDED.avatar, previous_league_id = EXCLUDED.previous_league_id,
        draft_id = EXCLUDED.draft_id, roster_positions = EXCLUDED.roster_positions,
        settings = EXCLUDED.settings, scoring_settings = EXCLUDED.scoring_settings,
        metadata = EXCLUDED.metadata,
        updated_at = ${fresh ? "now()" : "leagues.updated_at"},
        -- Sleeper just answered for this league, so any crawler tombstone is
        -- stale — clearing it puts the league back in the refresh queue. Cleared
        -- on a partial graph too: whatever else went wrong, Sleeper served the
        -- league itself, which is the one thing the tombstone denies.
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

  return missing;
}

/**
 * Persist one league graph in its own transaction (atomic per league).
 *
 * TheLabX drops three in-process read caches here, *after* the commit — the
 * league's own detail and, for every manager whose roster this write touched,
 * their ranks and their solved-lineup snapshot. None of those caches is ported,
 * so there is nothing to forget; the invalidation returns with them, and it is
 * `affectedOwnerIds` on {@link writeLeagueGraph} that it needs back.
 *
 * **It reports rather than returning void**, and the two fields it reports are
 * the distinction the callers turn on — see {@link PersistLeagueGraphResult}.
 */
export async function persistLeagueGraph(
  g: LeagueGraph,
): Promise<PersistLeagueGraphResult> {
  const missing = await withTransaction((client) => writeLeagueGraph(client, g));

  return {
    persisted: true,
    complete: missing.length === 0,
    incompleteReasons: missing.map(
      (collection) => `${collection} came back empty`,
    ),
  };
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
