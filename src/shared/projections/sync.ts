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

import { consultedWeeks, HORIZON_ORDER_SQL, WEEK_ORDER_SQL } from "./horizon-queue";
import type { WeekOrderSql } from "./horizon-queue";
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
 * stretch of held advisory lock. At the 15-minute loop interval four a tick walks
 * all fifteen inside an hour, comfortably within their day-long TTL — and the
 * daily volume is unchanged either way, since the TTL is what decides how often a
 * week is refetched at all. The cap is about the size of the burst, so what it
 * buys is how long a *cold* horizon spends describing a shorter season than the
 * one it is meant to cover. Sized against `SETTLED_WEEKS_PER_TICK`, which is six
 * against a much larger backlog.
 *
 * A cap only trickles where the queue rotates: see `./horizon-queue` for what a
 * week that never stamps used to do to it.
 */
export const HORIZON_WEEKS_PER_TICK = 4;

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
  /**
   * Why the horizon's freshness gate could not be consulted this run, or null.
   *
   * The two tiers are one `await` apart and were one failure apart too: the
   * horizon's `staleWeeks` runs before any week is fetched, and its rejection
   * left `withAdvisoryLock` through `syncProjections` entirely — so a fault in
   * the *daily, optional* tier cost the *hourly, critical* one, which had
   * already been asked for and was sitting in `nearDue` when the tick died. The
   * whole signal was one `[proj] Tick failed:` line, and this week's lineup
   * numbers went stale behind it.
   *
   * Observed rather than hypothesised: a database one migration behind (the
   * `attempt_at` column {@link HORIZON_ORDER_SQL} orders on) errors on exactly
   * this query and no other, so every tick threw and nothing — near or far —
   * was ever fetched.
   *
   * So the horizon read is the one that is allowed to fail: it degrades to "no
   * horizon this run", the near window proceeds, and the reason travels on the
   * summary the way a refusal's does. **The near read is deliberately not
   * wrapped** — it is the tier being protected, and a tick that cannot ask what
   * this week needs has nothing to degrade *to*.
   */
  horizonUnavailable: string | null;
};

/**
 * Which of `weeks` are stale, judged per week on the newest `updated_at` among
 * that week's rows — or, for a week with no rows, on when it was last fetched
 * successfully (`projection_week_syncs.synced_at`). Without the second gate an
 * unpublished week is due on every tick, refetched forever, and — because a
 * capped pass takes the head of this list — able to starve published weeks out
 * of the cap.
 *
 * `order` is the other half of that starvation and is chosen by the caller: a
 * capped list rotates on `attempt_at` so a week that never succeeds cannot hold
 * the head of it, an uncapped one stays in week order. Both spellings live in
 * `./horizon-queue` beside the rule they encode. Neither reads `attempt_at` as
 * freshness — a week that was tried and failed is still due, which is the whole
 * point of stamping the two separately.
 */
async function staleWeeks(
  season: string,
  weeks: number[],
  ttlMs: number,
  order: WeekOrderSql,
): Promise<number[]> {
  const { rows } = await pool.query<{ week: number }>(
    // Outer-joined rather than a second `NOT EXISTS`, because the ordering needs
    // the stamp row itself and a week that has never been stamped has to survive
    // the join to be ordered first.
    `SELECT w.week
       FROM unnest($1::int[]) AS w(week)
       LEFT JOIN projection_week_syncs s
              ON s.season = $2 AND s.week = w.week
      WHERE NOT EXISTS (
            SELECT 1
              FROM projections p
             WHERE p.season = $2
               AND p.week = w.week
               AND p.updated_at > now() - $3::interval)
        AND (s.synced_at IS NULL OR s.synced_at <= now() - $3::interval)
      ORDER BY ${order}`,
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

/**
 * Stamp a week as *tried*, before the fetch that may not come back.
 *
 * Ordering only — `synced_at` is left exactly as it was, so a week stamped here
 * and nowhere else is still stale and still due. Stamped before rather than
 * after, the `refreshLeague` rule: a fetch that throws, times out or is refused
 * has to rotate too, and the only stamp guaranteed to have happened by then is
 * one written first.
 */
function markWeekAttempted(season: string, week: number): Promise<unknown> {
  return pool.query(
    `INSERT INTO projection_week_syncs (season, week, attempt_at)
     VALUES ($1, $2, now())
     ON CONFLICT (season, week) DO UPDATE SET attempt_at = now()`,
    [season, week],
  );
}

/** Stamp a week as fetched, empty or not — the marker `staleWeeks` gates on. */
function markWeekSynced(season: string, week: number): Promise<unknown> {
  return pool.query(
    `INSERT INTO projection_week_syncs (season, week, synced_at, attempt_at)
     VALUES ($1, $2, now(), now())
     ON CONFLICT (season, week) DO UPDATE SET synced_at = now(), attempt_at = now()`,
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
 * current week and the next two are refreshed hourly because they move on news,
 * and
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
    // leaves behind is stale-but-waiting rather than fresh — and capped is why
    // it rotates on the last attempt rather than running in week order (see
    // `./horizon-queue`).
    const nearDue = force
      ? near
      : await staleWeeks(season, near, ttlMs, WEEK_ORDER_SQL);
    // Non-fatal on purpose — see `horizonUnavailable`. The near window is
    // already resolved above and must not be lost to a fault in the tier behind
    // it.
    let horizonUnavailable: string | null = null;
    let farStale: number[] = [];
    if (far.length) {
      try {
        farStale = await staleWeeks(season, far, horizonTtlMs, HORIZON_ORDER_SQL);
      } catch (error) {
        // With a fallback, so the overload returns `string`: a non-Error throw
        // still has to name itself on the summary.
        horizonUnavailable = errorMessage(error, "unknown error");
        console.error(
          `[proj] Horizon freshness gate failed for ${season}; syncing the near ` +
            `window only:`,
          horizonUnavailable,
        );
      }
    }
    const farDue = farStale.slice(0, Math.max(0, horizonPerRun));
    const deferred = farStale.slice(farDue.length);

    const due = [...nearDue, ...farDue];
    // A horizon that could not be *asked* is not a horizon that is fresh; see
    // `consultedWeeks`, where that rule is spelled out and tested.
    const fresh = consultedWeeks(near, far, horizonUnavailable === null).filter(
      (w) => !due.includes(w) && !deferred.includes(w),
    );

    const synced: WeekSyncResult[] = [];
    const empty: number[] = [];
    const failed: number[] = [];
    const rejected: { week: number; reason: string }[] = [];

    for (const week of due) {
      try {
        // Rotation, not freshness: this week has now had its turn whatever
        // comes back, so a week that fails every time gives way to the ones
        // behind it instead of consuming the cap on every tick forever. It
        // stays stale — `synced_at` is untouched — so it is still retried, just
        // no longer ahead of everything else.
        //
        // Left fatal to the week, deliberately, though it is only bookkeeping.
        // Swallowing it to "fetch anyway" was tried and is worse: the write
        // that *records* the fetch (`markWeekSynced`) stamps the same column,
        // so on a database missing it the week fails regardless — having first
        // spent ~5.6MB of Sleeper budget and rewritten the rows, every week of
        // every tick, forever. Failing here spends nothing and says the same
        // thing. A stamp is only skippable where what follows it can succeed.
        await markWeekAttempted(season, week);

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
      horizonUnavailable,
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
      horizonUnavailable: null,
    }
  );
}
