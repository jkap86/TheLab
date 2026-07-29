import { pool } from "@/shared/db";

import type { PlayerWeekStats } from "./aggregate";
import type { ProjectionScoring } from "./filters";

/**
 * The newest week with stored projections for a season, or null when none are
 * stored at all.
 *
 * What a read route should default to: the sync keeps the current and next week
 * fresh, so the newest stored week is the one Sleeper is currently projecting —
 * and asking the database rather than Sleeper's NFL state keeps the read path off
 * the network, and honest about what is actually here to read.
 */
export async function getLatestStoredWeek(season: string): Promise<number | null> {
  const { rows } = await pool.query<{ week: number | null }>(
    `SELECT max(week) AS week FROM projections WHERE season = $1`,
    [season],
  );
  return rows[0]?.week ?? null;
}

/**
 * Today in US Eastern, which is the clock a football week runs on: a Monday night
 * game is still ahead of you at 9pm ET, when UTC has already rolled into Tuesday.
 *
 * A constant rather than a parameter so the week list and the stat lines behind it
 * can't disagree about what "still to come" means — one interpolated expression,
 * used by both queries below.
 */
const TODAY_ET = `(now() AT TIME ZONE 'America/New_York')::date`;

/**
 * Stored weeks of a season with a game still to be played, ascending — the
 * horizon a rest-of-season number covers.
 *
 * A week stays on the list until its *last* game, so it is the right label for the
 * horizon mid-week; {@link listPlayerWeekStats} then drops the individual games
 * inside it that are already over. Deriving both from `game_date` rather than
 * asking `state/nfl` keeps this read off the network, and keeps it honest: it can
 * only ever name weeks that are actually here to read.
 *
 * A week whose rows carry no `game_date` at all is left out rather than assumed
 * future — counting a played week as remaining would silently double a roster's
 * outlook, which reads as a plausible number rather than as a bug.
 */
export async function getRemainingWeeks(season: string): Promise<number[]> {
  const { rows } = await pool.query<{ week: number }>(
    `SELECT week
       FROM projections
      WHERE season = $1
      GROUP BY week
     HAVING max(game_date) >= ${TODAY_ET}
      ORDER BY week`,
    [season],
  );
  return rows.map((r) => r.week);
}

/**
 * Raw stat lines for these players over these weeks — the input to
 * {@link aggregateWeeklyStats}.
 *
 * Only `stats` comes back, because a league scores from the stat line rather than
 * from Sleeper's `pts_*`. Rows are per player-week and simply absent where there
 * is no projection (bye, unpublished week), which the aggregate reports as a
 * missing week rather than a zero.
 *
 * Filtered by game rather than by week, which is the whole reason this doesn't
 * just take the weeks and trust them. An NFL week is spread over five days, so
 * from Friday to Monday `getRemainingWeeks` is still — correctly — naming the
 * current week, while a chunk of it has already been played: on the Sunday of 2025
 * week 1 that was 105 of 835 rows. Counting those adds points nobody can still
 * score, and has the lineup advising a swap for a player whose game is over. A row
 * with no `game_date` is dropped for the same reason the week list drops one.
 */
export async function listPlayerWeekStats({
  season,
  weeks,
  playerIds,
}: {
  season: string;
  weeks: number[];
  playerIds: string[];
}): Promise<PlayerWeekStats[]> {
  if (weeks.length === 0 || playerIds.length === 0) return [];

  const { rows } = await pool.query<PlayerWeekStats>(
    `SELECT player_id, week, COALESCE(stats, '{}'::jsonb) AS stats
       FROM projections
      WHERE season = $1 AND week = ANY($2::int[]) AND player_id = ANY($3::varchar[])
        AND game_date >= ${TODAY_ET}`,
    [season, weeks, playerIds],
  );
  return rows;
}

/**
 * Every stat key the feed publishes for these weeks — the vocabulary
 * `score.unprojectedScoring` measures a league's scoring settings against.
 *
 * Read across the whole week rather than one league's rosters on purpose: the
 * answer is a property of what Sleeper projects, not of who happens to be
 * rostered. Narrowing it to a roster makes a league with no kicker or defence slot
 * report `xpm`, `sack` and `int` as unsupplied — categories the feed publishes for
 * every kicker and defence — and the noise hides the gaps that are real.
 */
export async function getProjectedStatKeys({
  season,
  weeks,
}: {
  season: string;
  weeks: number[];
}): Promise<string[]> {
  if (weeks.length === 0) return [];

  const { rows } = await pool.query<{ key: string }>(
    `SELECT DISTINCT k AS key
       FROM projections,
            LATERAL jsonb_object_keys(COALESCE(stats, '{}'::jsonb)) k
      WHERE season = $1 AND week = ANY($2::int[])`,
    [season, weeks],
  );
  return rows.map((r) => r.key);
}

/** One row of a ranked week, scored by the caller's chosen format. */
export type RankedProjection = {
  player_id: string;
  team: string | null;
  opponent: string | null;
  game_date: string | null;
  /** Projected points in the requested scoring; null when Sleeper published none. */
  points: number | null;
  stats: Record<string, number>;
};

/**
 * Interpolated into `ORDER BY` and the select list, so it must never be built
 * from caller input — `ProjectionScoring` is a closed enum for this reason.
 */
const POINTS_COLUMN: Record<ProjectionScoring, string> = {
  std: "pts_std",
  half_ppr: "pts_half_ppr",
  ppr: "pts_ppr",
};

/**
 * One week's projections, ranked by the requested scoring, with the size of the
 * full matched set and when it was last written.
 *
 * `playerIds` narrows the set; an empty array means nothing matched (a position
 * filter that hit no cached players, say) and short-circuits to no rows, rather
 * than being read as "no filter".
 */
export async function listWeekProjections({
  season,
  week,
  scoring,
  playerIds,
  includeStats,
  limit,
  offset,
}: {
  season: string;
  week: number;
  scoring: ProjectionScoring;
  playerIds?: string[] | null;
  includeStats?: boolean;
  limit: number;
  offset: number;
}): Promise<{
  rows: RankedProjection[];
  player_count: number;
  updated_at: string | null;
}> {
  if (playerIds && playerIds.length === 0) {
    return { rows: [], player_count: 0, updated_at: null };
  }

  const points = POINTS_COLUMN[scoring];
  const params: unknown[] = [season, week];
  const where =
    `season = $1 AND week = $2` +
    (playerIds ? ` AND player_id = ANY($${params.push(playerIds)})` : "");

  const { rows: totals } = await pool.query<{ count: string; updated_at: string | null }>(
    `SELECT count(*)::text AS count,
            to_char(max(updated_at), 'YYYY-MM-DD"T"HH24:MI:SSOF') AS updated_at
       FROM projections
      WHERE ${where}`,
    params,
  );

  const { rows } = await pool.query<RankedProjection>(
    // `player_id` breaks ties so paging is stable — plenty of players share a
    // projected total, and without it a row can appear on two pages or neither.
    `SELECT player_id, team, opponent,
            to_char(game_date, 'YYYY-MM-DD') AS game_date,
            ${points}::float8 AS points,
            ${includeStats ? `COALESCE(stats, '{}'::jsonb)` : `'{}'::jsonb`} AS stats
       FROM projections
      WHERE ${where}
      ORDER BY ${points} DESC NULLS LAST, player_id
      LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
    params,
  );

  return {
    rows,
    player_count: Number(totals[0]?.count ?? 0),
    updated_at: totals[0]?.updated_at ?? null,
  };
}
