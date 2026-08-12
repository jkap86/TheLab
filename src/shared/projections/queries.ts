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
 * The week a lineup is being set for: the earliest stored week with a game still
 * to be played, or null when nothing ahead of today is stored.
 *
 * The head of {@link getRemainingWeeks}, asked as its own question and answered
 * by its own query so a caller that wants one week doesn't read eighteen. The
 * derivation is deliberately identical — a week stays current until its *last*
 * game, so this still names week 1 on the Monday night of week 1, which is when
 * a lineup for it can still be changed.
 *
 * **Not `manager`'s `getCurrentWeek`, which reads `state/nfl`.** That one is for
 * the sync path, where a Sleeper call is the point; a cache-backed route never
 * waits on Sleeper for something the database can already answer. The cost of
 * that is honesty rather than accuracy: this can only name a week whose
 * projections are actually stored, so a season nothing is synced for answers null
 * and the routes above it come back empty rather than guessing at a calendar.
 */
export async function getUpcomingWeek(season: string): Promise<number | null> {
  const { rows } = await pool.query<{ week: number }>(
    `SELECT week
       FROM projections
      WHERE season = $1
      GROUP BY week
     HAVING max(game_date) >= ${TODAY_ET}
      ORDER BY week
      LIMIT 1`,
    [season],
  );
  return rows[0]?.week ?? null;
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

/** One player's week, with whether his game is already behind us. */
export type LineupWeekStats = PlayerWeekStats & {
  /**
   * True where the game's date has passed: the slot he is in is settled, and
   * neither he nor it can be part of a lineup decision any more.
   *
   * **Day-accurate, because a day is all `game_date` holds.** Sleeper sends a
   * bare date and the column is a `DATE`, so on its own a 1pm game reads as
   * unlocked until the date rolls over in ET. It is the *fallback* rather than
   * the whole answer now: `getWeekLineups` folds the schedule's own
   * `start_time`s over it (`lockedPlayers` in `./locks`), locking at the
   * minute wherever the schedule names one — and only ever earlier, so a
   * schedule that can't be read degrades to this flag rather than unlocking a
   * played game.
   */
  locked: boolean;
};

/**
 * One week's stat lines for these players — **all of them**, including games
 * already played, each marked with whether it is still ahead.
 *
 * The counterpart to {@link listPlayerWeekStats} rather than a variant of it,
 * and the difference is the question. A rest-of-season total wants the played
 * games *gone*: they cannot be scored again, so counting them would inflate what
 * a roster has left. A lineup decision for one week wants them **present but
 * settled** — a starter whose game is over still contributes his points to what
 * this lineup scores, and dropping him would read as an empty slot for the
 * optimiser to fill with somebody who has not played, which is advice to make a
 * swap the platform will refuse.
 *
 * A row with no `game_date` is kept and left unlocked. The week list drops those
 * because it cannot tell whether they are ahead; here the forgiving reading is
 * the safe one, since the cost of a wrong guess is a frozen slot rather than a
 * doubled total.
 */
export async function listLineupWeekStats({
  season,
  week,
  playerIds,
}: {
  season: string;
  week: number;
  playerIds: string[];
}): Promise<LineupWeekStats[]> {
  if (playerIds.length === 0) return [];

  const { rows } = await pool.query<LineupWeekStats>(
    `SELECT player_id, week, COALESCE(stats, '{}'::jsonb) AS stats,
            (game_date IS NOT NULL AND game_date < ${TODAY_ET}) AS locked
       FROM projections
      WHERE season = $1 AND week = $2 AND player_id = ANY($3::varchar[])`,
    [season, week, playerIds],
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
