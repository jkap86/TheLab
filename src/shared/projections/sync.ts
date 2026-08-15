import {
  bulkInsert,
  jsonb as j,
  LOCK_KEYS,
  msInterval,
  pool,
  withAdvisoryLock,
  withTransaction,
} from "@/shared/db";
import { getActiveSeason } from "@/shared/season";
import { fetchWeekProjections, getNflState } from "@/shared/sleeper";
import { errorMessage } from "@/shared/util";

import { toProjectionRows } from "./parse";
import { clearProjectionMetaCaches } from "./queries";
import type { ProjectionRow } from "./parse";
import { validateWeekProjections } from "./validate";
import { horizonWeeks, targetWeeks } from "./weeks";

/**
 * How long a week's stored projections stay fresh.
 *
 * Projections move on news — an injury designation on Friday changes Sunday's
 * numbers — so an hour is about the resolution worth having. It is a per-week
 * gate rather than a whole-table one (`isFresh` reads the newest row in a table,
 * which would call every week fresh the moment any week was written).
 */
export const PROJECTIONS_TTL_MS = 60 * 60 * 1000;

/**
 * How long a rest-of-season week stays fresh.
 *
 * The same data on a different clock. Week 12's projection in July is a
 * strength-of-schedule estimate, not a lineup input: it moves when a depth chart
 * does, over weeks, so refreshing it hourly would spend 90MB a day rewriting
 * identical rows. It reaches the hourly gate on its own, by becoming the current
 * week (see `weeks.targetWeeks`).
 */
export const PROJECTIONS_HORIZON_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Horizon weeks fetched per run, so the backfill trickles instead of arriving as
 * one 90MB tick.
 *
 * The same shape as the KTC history backfill and for the same reason: a tick that
 * pulls the whole rest of the season at once is a burst on Sleeper and a long
 * stretch of held advisory lock. At the 15-minute loop interval two a tick walks
 * all sixteen inside two hours, well within their day-long TTL.
 */
export const HORIZON_WEEKS_PER_TICK = 2;

const COLUMNS = [
  "season", "week", "player_id", "company", "team", "opponent", "game_id",
  "game_date", "pts_std", "pts_half_ppr", "pts_ppr", "stats",
  "source_updated_at",
];

const ON_CONFLICT = `(season, week, player_id) DO UPDATE SET
    company = EXCLUDED.company, team = EXCLUDED.team,
    opponent = EXCLUDED.opponent, game_id = EXCLUDED.game_id,
    game_date = EXCLUDED.game_date, pts_std = EXCLUDED.pts_std,
    pts_half_ppr = EXCLUDED.pts_half_ppr, pts_ppr = EXCLUDED.pts_ppr,
    stats = EXCLUDED.stats, source_updated_at = EXCLUDED.source_updated_at,
    updated_at = now()`;

/** What one week's sync did. */
export type WeekSyncResult = {
  week: number;
  /** Rows upserted. */
  rows: number;
  /** Rows deleted because they are no longer in Sleeper's slate for the week. */
  removed: number;
};

export type ProjectionsSyncSummary = {
  /** true when another instance held the lock and this run did nothing. */
  locked: boolean;
  season: string;
  /** Weeks fetched and written. */
  synced: WeekSyncResult[];
  /** Weeks skipped because the stored rows were still inside the TTL. */
  fresh: number[];
  /**
   * Horizon weeks that were due but past {@link HORIZON_WEEKS_PER_TICK}, left for
   * the next run. Reported rather than folded into `fresh`, because a capped week
   * is stale and a fresh one isn't — and a cap that reads as "nothing to do" is
   * how a backfill silently stops making progress.
   */
  deferred: number[];
  /** Weeks Sleeper had no real projections for; nothing was written. */
  empty: number[];
  /** Weeks whose fetch or write failed. Logged, retried on a later tick. */
  failed: number[];
  /**
   * Weeks whose payload was refused as incomplete — nothing written, no
   * freshness stamp, so the stored week is untouched and the next tick tries
   * again. Separate from `failed` because the fetch *succeeded*: what was
   * rejected is the data, and the reason travels with the week. See
   * `./validate`.
   */
  rejected: { week: number; reason: string }[];
};

/**
 * Which of `weeks` are stale, judged per week on the newest `updated_at` among
 * that week's rows — or, for a week with no rows, on when it was last fetched
 * (`projection_week_syncs`). Without the second gate an unpublished week is due
 * on every tick, refetched forever, and — because the horizon budget takes the
 * earliest stale weeks first — able to starve published weeks out of the cap.
 */
async function staleWeeks(
  season: string,
  weeks: number[],
  ttlMs: number,
): Promise<number[]> {
  const { rows } = await pool.query<{ week: number }>(
    `SELECT w.week
       FROM unnest($1::int[]) AS w(week)
      WHERE NOT EXISTS (
            SELECT 1
              FROM projections p
             WHERE p.season = $2
               AND p.week = w.week
               AND p.updated_at > now() - $3::interval)
        AND NOT EXISTS (
            SELECT 1
              FROM projection_week_syncs s
             WHERE s.season = $2
               AND s.week = w.week
               AND s.synced_at > now() - $3::interval)
      ORDER BY w.week`,
    [weeks, season, msInterval(ttlMs)],
  );
  return rows.map((r) => r.week);
}

/**
 * How many rows are stored for a `(season, week)` — the population a fresh
 * payload's completeness is judged against. Zero is a first sync of that week.
 */
async function storedWeekCount(season: string, week: number): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM projections WHERE season = $1 AND week = $2`,
    [season, week],
  );
  return Number(rows[0].count);
}

/** Stamp a week as fetched, empty or not — the marker `staleWeeks` reads. */
function markWeekSynced(season: string, week: number): Promise<unknown> {
  return pool.query(
    `INSERT INTO projection_week_syncs (season, week, synced_at)
     VALUES ($1, $2, now())
     ON CONFLICT (season, week) DO UPDATE SET synced_at = now()`,
    [season, week],
  );
}

/**
 * Replace one week's projections with `rows`, in a single transaction so readers
 * never see a half-written week.
 *
 * The delete matters as much as the upsert: an upsert alone leaves behind a
 * projection for a player Sleeper has since dropped from the slate — a stale row
 * that still looks like a live projection. Only reachable with a non-empty
 * `rows`, so an upstream hiccup that returns nothing can never empty a week.
 */
function writeWeek(
  season: string,
  week: number,
  rows: ProjectionRow[],
): Promise<number> {
  return withTransaction(async (client) => {
    await bulkInsert(client, {
      table: "projections",
      columns: COLUMNS,
      rows,
      values: (r) => [
        r.season, r.week, r.player_id, r.company, r.team, r.opponent, r.game_id,
        r.game_date, r.pts_std, r.pts_half_ppr, r.pts_ppr, j(r.stats),
        r.source_updated_at,
      ],
      trailing: { column: "updated_at", sql: "now()" },
      onConflict: ON_CONFLICT,
    });

    const { rowCount } = await client.query(
      `DELETE FROM projections
         WHERE season = $1 AND week = $2 AND player_id <> ALL($3::varchar[])`,
      [season, week, rows.map((r) => r.player_id)],
    );
    return rowCount ?? 0;
  });
}

/**
 * Fetch and store weekly projections.
 *
 * With no options it covers the whole rest of the season, on two clocks: the
 * current week and the next are refreshed hourly because they move on news, and
 * the weeks behind them are refreshed daily, a couple per run (see
 * `PROJECTIONS_HORIZON_TTL_MS` and `HORIZON_WEEKS_PER_TICK`). One gate would have
 * to pick between re-downloading 90MB an hour and letting this week go stale.
 *
 * Pass `weeks` to backfill specific ones — that skips the tiering entirely and
 * fetches exactly what was asked for, which is the only way a past week is ever
 * picked up: its numbers stop changing once its games are played.
 *
 * `force` applies to the near window only. Forcing is for "this week's numbers
 * look wrong", and a flag that quietly turned into a full-season re-download
 * would be a footgun; use explicit `weeks` for that.
 *
 * Weeks are fetched one at a time on purpose: each response is ~5.6MB, so
 * parallelising a handful of weeks would mean tens of megabytes in flight and in
 * memory at once for no useful latency win in a background loop.
 *
 * Held under an advisory lock — including the freshness gate, so whichever
 * instance wins is the one that decides what needs fetching, and extra dynos
 * sharing a database don't each pull the same multi-megabyte week.
 */
export async function syncProjections(
  options: {
    season?: string;
    weeks?: number[];
    force?: boolean;
    ttlMs?: number;
    horizonTtlMs?: number;
    horizonPerRun?: number;
  } = {},
): Promise<ProjectionsSyncSummary> {
  const {
    force = false,
    ttlMs = PROJECTIONS_TTL_MS,
    horizonTtlMs = PROJECTIONS_HORIZON_TTL_MS,
    horizonPerRun = HORIZON_WEEKS_PER_TICK,
  } = options;

  const summary = await withAdvisoryLock(LOCK_KEYS.projections, async () => {
    const explicitWeeks = options.weeks?.length ? options.weeks : null;

    // NFL state decides both the season and the week window; only skip the call
    // when the caller has already pinned both.
    let state = null;
    if (!options.season || !explicitWeeks) {
      try {
        state = await getNflState();
      } catch (error) {
        console.warn(
          "[proj] NFL state unavailable; falling back to defaults:",
          errorMessage(error),
        );
      }
    }

    // The state read above is the same call the resolver makes, so it wins when
    // it worked; the resolver is the ladder underneath it (cached value, then
    // the operator override, then the compiled-in fallback).
    const season =
      options.season ?? state?.season ?? (await getActiveSeason());

    const near = explicitWeeks ?? targetWeeks(state);
    const far = explicitWeeks ? [] : horizonWeeks(state);

    // Two freshness gates, one per clock. The horizon's is capped, so what it
    // leaves behind is stale-but-waiting rather than fresh.
    const nearDue = force ? near : await staleWeeks(season, near, ttlMs);
    const farStale = far.length ? await staleWeeks(season, far, horizonTtlMs) : [];
    const farDue = farStale.slice(0, Math.max(0, horizonPerRun));
    const deferred = farStale.slice(farDue.length);

    const due = [...nearDue, ...farDue];
    const fresh = [...near, ...far].filter(
      (w) => !due.includes(w) && !deferred.includes(w),
    );

    const synced: WeekSyncResult[] = [];
    const empty: number[] = [];
    const failed: number[] = [];
    const rejected: { week: number; reason: string }[] = [];

    for (const week of due) {
      try {
        const entries = await fetchWeekProjections(season, week);
        const rows = toProjectionRows(entries, season, week);

        if (rows.length === 0) {
          // Sleeper answers 200 for a week it has nothing for, so this is a
          // normal state (a week not published yet), not an error. Still a
          // successful fetch: stamp it so the week waits out its TTL instead
          // of being refetched every tick.
          await markWeekSynced(season, week);
          empty.push(week);
          continue;
        }

        // Completeness gate, outside the transaction on purpose: a refusal must
        // leave the stored week byte-for-byte as it was, and the cheapest way to
        // guarantee that is never to open the transaction that deletes.
        const previous = await storedWeekCount(season, week);
        const validation = validateWeekProjections(rows, previous);
        if (!validation.ok) {
          console.error(
            `[proj] Refused a suspicious payload for ${season} week ${week}: ` +
              `${validation.reason} (previous=${validation.previous} ` +
              `valid=${validation.valid} rejected=${validation.rejected} ` +
              `parsed=${rows.length}). Stored rows left untouched.`,
          );
          // No `markWeekSynced`: the week stays stale so the next tick retries.
          rejected.push({ week, reason: validation.reason });
          continue;
        }

        const removed = await writeWeek(season, week, validation.rows);
        await markWeekSynced(season, week);
        // The horizon and the stat-key vocabulary are derived from these rows
        // and cached per season for minutes, so a week that has just landed —
        // or one whose last game has just passed — is published now rather than
        // waiting out a TTL behind the sync that produced it.
        clearProjectionMetaCaches();
        synced.push({ week, rows: validation.rows.length, removed });
      } catch (error) {
        failed.push(week);
        console.warn(
          `[proj] Sync failed for ${season} week ${week}:`,
          errorMessage(error),
        );
      }
    }

    return {
      locked: false, season, synced, fresh, deferred, empty, failed, rejected,
    };
  });

  return (
    summary ?? {
      locked: true,
      season: options.season ?? (await getActiveSeason()),
      synced: [],
      fresh: [],
      deferred: [],
      empty: [],
      failed: [],
      rejected: [],
    }
  );
}
