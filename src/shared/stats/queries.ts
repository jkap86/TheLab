import { pool } from "@/shared/db";

import type { StatLine } from "./ppg";

/** One player's line in one week, as stored. */
export type PlayerStatWeek = StatLine & { player_id: string };

/**
 * The stored stat lines for a set of players over a set of weeks of one season.
 *
 * Only `stats` comes back, because a league scores from the stat line rather
 * than from Sleeper's `pts_*` — the `listPlayerWeekStats` rule one module over,
 * and for the identical reason: `pts_ppr` is 0.05 a passing yard against
 * Sleeper's own league default of 0.04, so quoting it would be a different
 * league's answer.
 *
 * **No `game_date` filter here, which is where it parts company with its
 * projections twin.** That one drops games already played, because points behind
 * us cannot be scored again and a rest-of-season total must not count them. This
 * read wants exactly the opposite population: a points-per-game average is made
 * *of* games already played, so a date bound would empty it.
 *
 * Rows are simply absent where a player did not play a week, which
 * {@link playerPpg} reads as a game not played rather than as a nought.
 */
export async function listPlayerStatLines({
  season,
  weeks,
  playerIds,
}: {
  season: string;
  weeks: number[];
  playerIds: string[];
}): Promise<PlayerStatWeek[]> {
  if (weeks.length === 0 || playerIds.length === 0) return [];

  const { rows } = await pool.query<PlayerStatWeek>(
    `SELECT player_id, week, COALESCE(stats, '{}'::jsonb) AS stats
       FROM player_week_stats
      WHERE season = $1
        AND week = ANY($2::int[])
        AND player_id = ANY($3::varchar[])`,
    [season, weeks, playerIds],
  );
  return rows;
}

/**
 * Which of `weeks` have any stat line stored for a season.
 *
 * What it is for is telling "week 1, nothing to average" apart from "mid-season,
 * but this database has not backfilled those weeks" — the first is a fact about
 * the calendar and the second is a fact about the sync, and only the second is
 * fixed by waiting. The route uses it to decide whether to fall back to the
 * previous season, so a cold database reads as a prior-season average rather
 * than as a column of em dashes.
 */
export async function listStoredStatWeeks({
  season,
  weeks,
}: {
  season: string;
  weeks: number[];
}): Promise<number[]> {
  if (weeks.length === 0) return [];

  const { rows } = await pool.query<{ week: number }>(
    `SELECT DISTINCT week
       FROM player_week_stats
      WHERE season = $1 AND week = ANY($2::int[])
      ORDER BY week`,
    [season, weeks],
  );
  return rows.map((r) => r.week);
}

// What a *team* averaged is not read here: it comes off `matchups`, which the
// manager module owns — see `listRosterWeekPoints` and `getPreviousLeagueScores`
// there. A module owns its tables, and this one owns `player_week_stats`.
