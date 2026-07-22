import type { PoolClient } from "pg";

import { pool } from "@/shared/db";
import {
  getDraftPicks,
  getLeagueDrafts,
  getLeagueRosters,
  getLeagueTradedPicks,
  getLeagueTransactions,
  getLeagueUsers,
  getNflState,
  getUserLeagues,
} from "@/shared/sleeper";
import type {
  SleeperDraft,
  SleeperDraftPick,
  SleeperLeague,
  SleeperLeagueUser,
  SleeperRoster,
  SleeperTradedPick,
  SleeperTransaction,
} from "@/shared/sleeper";

/** Serialize a value for a JSONB column (null stays null). */
const j = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));

/** Inclusive week range of transactions fetched for a league this sync. */
type WeekRange = { from: number; to: number };

type LeagueGraph = {
  league: SleeperLeague;
  rosters: SleeperRoster[];
  users: SleeperLeagueUser[];
  tradedPicks: SleeperTradedPick[];
  drafts: SleeperDraft[];
  /** Picks keyed by their draft_id. */
  draftPicks: SleeperDraftPick[];
  /** Roster moves across every fetched week, flattened. */
  transactions: SleeperTransaction[];
  /** Which weeks {@link transactions} covers, so persistence replaces only those. */
  txWeeks: WeekRange;
};

export type SyncSummary = {
  season: string;
  /** true when the sync was skipped because existing data was still fresh. */
  skipped: boolean;
  /** total leagues the manager belongs to this season. */
  total: number;
  /** leagues successfully fetched and persisted. */
  leagues: number;
  /** leagues that failed to sync (e.g. Sleeper timeout) and were skipped. */
  failed: number;
  rosters: number;
  leagueUsers: number;
  tradedPicks: number;
  drafts: number;
  draftPicks: number;
  transactions: number;
};

/** Incremental sync progress, reported after each league finishes. */
export type SyncProgress = { loaded: number; total: number; failed: number };

export type SyncOptions = {
  force?: boolean;
  concurrency?: number;
  onProgress?: (progress: SyncProgress) => void;
};

/** How long a manager's league sync stays fresh before we re-fetch Sleeper. */
export const SYNC_TTL_MS = 10 * 60 * 1000;

/**
 * Leagues fetched+persisted at once. Power users have 100+ leagues; fanning out
 * all of them at once overwhelms the connection and Sleeper, which is what
 * caused the request queue to blow past axios' timeout budget.
 */
export const LEAGUE_FETCH_CONCURRENCY = 6;

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index], index);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
}

/**
 * Fetch a league and all of its child collections from Sleeper. Transactions are
 * fetched only for `txWeeks.from..txWeeks.to` (Sleeper keys them by week and has
 * no all-at-once endpoint) and flattened. Callers pass the full range on a first
 * sync and a short tail window on refreshes — see {@link syncManagerLeagues}.
 */
async function fetchLeagueGraph(
  league: SleeperLeague,
  txWeeks: WeekRange,
): Promise<LeagueGraph> {
  const weeks: number[] = [];
  for (let w = txWeeks.from; w <= txWeeks.to; w++) weeks.push(w);

  const [rosters, users, tradedPicks, drafts, transactions] = await Promise.all([
    getLeagueRosters(league.league_id),
    getLeagueUsers(league.league_id),
    getLeagueTradedPicks(league.league_id),
    getLeagueDrafts(league.league_id),
    Promise.all(
      weeks.map((week) => getLeagueTransactions(league.league_id, week)),
    ).then((byWeek) => byWeek.flat()),
  ]);

  const draftPicks = (
    await Promise.all(drafts.map((d) => getDraftPicks(d.draft_id)))
  ).flat();

  return {
    league, rosters, users, tradedPicks, drafts, draftPicks, transactions, txWeeks,
  };
}

/** Persist one league graph inside an open transaction. */
async function writeLeagueGraph(client: PoolClient, g: LeagueGraph): Promise<void> {
  const l = g.league;

  await client.query(
    `INSERT INTO leagues (league_id, name, season, sport, status, total_rosters,
        avatar, previous_league_id, draft_id, roster_positions, settings,
        scoring_settings, metadata, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     ON CONFLICT (league_id) DO UPDATE SET
        name = EXCLUDED.name, season = EXCLUDED.season, sport = EXCLUDED.sport,
        status = EXCLUDED.status, total_rosters = EXCLUDED.total_rosters,
        avatar = EXCLUDED.avatar, previous_league_id = EXCLUDED.previous_league_id,
        draft_id = EXCLUDED.draft_id, roster_positions = EXCLUDED.roster_positions,
        settings = EXCLUDED.settings, scoring_settings = EXCLUDED.scoring_settings,
        metadata = EXCLUDED.metadata, updated_at = now()`,
    [
      l.league_id, l.name, l.season, l.sport, l.status, l.total_rosters,
      l.avatar, l.previous_league_id, l.draft_id, j(l.roster_positions),
      j(l.settings), j(l.scoring_settings), j(l.metadata),
    ],
  );

  // Child collections are replaced wholesale so the DB mirrors Sleeper.
  await client.query(`DELETE FROM league_users WHERE league_id = $1`, [l.league_id]);
  for (const u of g.users) {
    await client.query(
      `INSERT INTO league_users (league_id, user_id, display_name, avatar,
          team_name, is_owner, is_bot, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [l.league_id, u.user_id, u.display_name, u.avatar,
        u.metadata?.team_name ?? null, u.is_owner, u.is_bot, j(u.metadata)],
    );
  }

  await client.query(`DELETE FROM rosters WHERE league_id = $1`, [l.league_id]);
  for (const r of g.rosters) {
    await client.query(
      `INSERT INTO rosters (league_id, roster_id, owner_id, players, starters,
          reserve, taxi, settings, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [l.league_id, r.roster_id, r.owner_id, j(r.players), j(r.starters),
        j(r.reserve), j(r.taxi), j(r.settings), j(r.metadata)],
    );
  }

  await client.query(`DELETE FROM traded_picks WHERE league_id = $1`, [l.league_id]);
  for (const p of g.tradedPicks) {
    await client.query(
      `INSERT INTO traded_picks (league_id, season, round, roster_id, owner_id,
          previous_owner_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [l.league_id, p.season, p.round, p.roster_id, p.owner_id, p.previous_owner_id],
    );
  }

  // Deleting drafts cascades to draft_picks, so re-insert both.
  await client.query(`DELETE FROM drafts WHERE league_id = $1`, [l.league_id]);
  for (const d of g.drafts) {
    await client.query(
      `INSERT INTO drafts (draft_id, league_id, season, status, type, start_time,
          draft_order, settings, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [d.draft_id, l.league_id, d.season, d.status, d.type, d.start_time,
        j(d.draft_order), j(d.settings), j(d.metadata)],
    );
  }
  for (const p of g.draftPicks) {
    await client.query(
      `INSERT INTO draft_picks (draft_id, pick_no, round, roster_id, player_id,
          picked_by, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [p.draft_id, p.pick_no, p.round, p.roster_id, p.player_id, p.picked_by, j(p.metadata)],
    );
  }

  // Replace only the weeks we re-fetched; earlier weeks (frozen once past) stay.
  await client.query(
    `DELETE FROM transactions WHERE league_id = $1 AND week BETWEEN $2 AND $3`,
    [l.league_id, g.txWeeks.from, g.txWeeks.to],
  );
  for (const t of g.transactions) {
    await client.query(
      `INSERT INTO transactions (transaction_id, league_id, type, status, week,
          creator, created, status_updated, roster_ids, consenter_ids, adds,
          drops, draft_picks, waiver_budget, settings, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [t.transaction_id, l.league_id, t.type, t.status, t.leg, t.creator,
        t.created, t.status_updated, j(t.roster_ids), j(t.consenter_ids),
        j(t.adds), j(t.drops), j(t.draft_picks), j(t.waiver_budget),
        j(t.settings), j(t.metadata)],
    );
  }
}

/** Persist one league graph in its own transaction (atomic per league). */
async function persistLeagueGraph(g: LeagueGraph): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await writeLeagueGraph(client, g);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Highest transaction week already stored per league, for the given league ids.
 * Leagues with no transactions yet are absent from the map (→ full backfill).
 */
async function getStoredMaxWeekByLeague(
  leagueIds: string[],
): Promise<Map<string, number>> {
  if (leagueIds.length === 0) return new Map();
  const { rows } = await pool.query<{ league_id: string; max_week: number }>(
    `SELECT league_id, max(week) AS max_week
       FROM transactions
      WHERE league_id = ANY($1::varchar[]) AND week IS NOT NULL
      GROUP BY league_id`,
    [leagueIds],
  );
  return new Map(rows.map((r) => [r.league_id, Number(r.max_week)]));
}

/**
 * Fetch a manager's leagues (and rosters, members, traded picks, drafts, and
 * draft picks) from Sleeper for a season and persist them to Postgres.
 *
 * Leagues are fetched+persisted with bounded concurrency and each league is its
 * own transaction, so one slow/failed league neither stalls the others nor
 * rolls back the whole sync. `onProgress` fires after each league completes.
 */
export async function syncManagerLeagues(
  userId: string,
  season: string,
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const {
    force = false,
    concurrency = LEAGUE_FETCH_CONCURRENCY,
    onProgress,
  } = options;

  if (!force) {
    const { rows } = await pool.query<{ synced_at: Date }>(
      `SELECT synced_at FROM manager_syncs WHERE user_id = $1 AND season = $2`,
      [userId, season],
    );
    const syncedAt = rows[0]?.synced_at;
    if (syncedAt && Date.now() - syncedAt.getTime() < SYNC_TTL_MS) {
      return {
        season, skipped: true, total: 0, leagues: 0, failed: 0,
        rosters: 0, leagueUsers: 0, tradedPicks: 0, drafts: 0, draftPicks: 0,
        transactions: 0,
      };
    }
  }

  // One state call gives the current NFL week (floored to 1: offseason moves are
  // logged at week 1 while state reports week 0). Nothing exists past it.
  const nflState = await getNflState();
  const currentWeek = Math.max(nflState?.week ?? 1, 1);

  const leagues = await getUserLeagues(userId, season);
  const total = leagues.length;

  // How far each league has already been synced. A league's transaction weeks
  // are frozen once past, so on a refresh we only re-fetch from its last stored
  // week minus one (to catch late-settling waivers/trades in the just-closed
  // week) up to the current week — a first sync (no rows) backfills from week 1.
  const storedMaxWeek = await getStoredMaxWeekByLeague(
    leagues.map((l) => l.league_id),
  );
  const txWeeksFor = (leagueId: string): WeekRange => {
    const stored = storedMaxWeek.get(leagueId);
    return {
      from: stored ? Math.max(stored - 1, 1) : 1,
      to: Math.max(currentWeek, stored ?? 1, 1),
    };
  };

  let loaded = 0;
  let failed = 0;
  const counts = {
    rosters: 0, leagueUsers: 0, tradedPicks: 0, drafts: 0, draftPicks: 0,
    transactions: 0,
  };

  onProgress?.({ loaded, total, failed });

  await mapWithConcurrency(leagues, concurrency, async (league) => {
    try {
      const graph = await fetchLeagueGraph(league, txWeeksFor(league.league_id));
      await persistLeagueGraph(graph);
      counts.rosters += graph.rosters.length;
      counts.leagueUsers += graph.users.length;
      counts.tradedPicks += graph.tradedPicks.length;
      counts.drafts += graph.drafts.length;
      counts.draftPicks += graph.draftPicks.length;
      counts.transactions += graph.transactions.length;
      loaded += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `[leagues] failed to sync league ${league.league_id}:`,
        error instanceof Error ? error.message : error,
      );
    } finally {
      onProgress?.({ loaded, total, failed });
    }
  });

  // Stamp the sync so subsequent loads inside the TTL skip the re-fetch. Written
  // even on partial failure to avoid hammering Sleeper; the TTL retries later.
  await pool.query(
    `INSERT INTO manager_syncs (user_id, season, synced_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id, season) DO UPDATE SET synced_at = now()`,
    [userId, season],
  );

  return { season, skipped: false, total, leagues: loaded, failed, ...counts };
}
