import { sleeperDataUrl, sleeperGet } from "@/shared/sleeper";
import { collectWithConcurrency } from "@/shared/util";

import { LAST_REGULAR_WEEK } from "./plan.ts";
import type { SleeperStatRow, WeekStats } from "./season-line.ts";

/**
 * One season's weekly stat rows, from Sleeper's data host.
 *
 * **The path mirrors `projections/ros-read` exactly**, which is the one shape
 * on that host this repo has verified, with `projections` swapped for `stats`
 * — the swap `SleeperProjection`'s own doc names ("the same endpoint shape is
 * used for actual stats"). Everything else about it is that file's: the
 * requests go through {@link sleeperGet} and therefore through the one
 * process-wide concurrency bound, and a span with no data is a null body that
 * folds to an empty week rather than throwing.
 *
 * **A week that fails fails the season.** A corpus silently missing week 12 is
 * a season in which every player is a game short and every points-per-game is
 * wrong by a sixteenth, with nothing on any card saying so — the same lie the
 * projections span refuses for the same reason. The loader is a script an
 * operator watches, so a failure there is a line they read and a rerun, which
 * is a far better outcome than a quietly short season written into a table
 * nothing revisits.
 *
 * Injected as {@link SeasonStatSource} into the load rather than called by it,
 * which is what lets the loader be tested against a fixture with no network at
 * all — and what leaves room for the nflverse source the migration's own note
 * names, whose extra columns (routes run, draft capital) are the two this one
 * cannot fill.
 */

/** What a load needs from a source: one season's weeks, in order. */
export type SeasonStatSource = (season: number) => Promise<WeekStats[]>;

export const SLEEPER_SOURCE_NAME = "sleeper-season-stats";

/**
 * Weeks in flight at once — `projections/ros-read`'s `ROS_FETCH_CONCURRENCY`,
 * spelled here because that barrel is server-only and this file mirrors that
 * read rather than importing it. Same host, same reason: eighteen at once is
 * most of the process-wide Sleeper bound spent on one season, and a corpus
 * load fans out over several seasons in a row.
 */
const WEEK_FETCH_CONCURRENCY = 4;

export function sleeperSeasonStats(season: number): Promise<WeekStats[]> {
  const weeks: number[] = [];
  for (let week = 1; week <= LAST_REGULAR_WEEK; week++) weeks.push(week);

  // In the input's order whatever order they land in — `collectWithConcurrency`
  // zips its results back against the items — so the weeks come back ascending.
  return collectWithConcurrency(weeks, WEEK_FETCH_CONCURRENCY, async (week) => ({
    week,
    rows: await sleeperGet<SleeperStatRow[]>(
      `${sleeperDataUrl("stats", "nfl", season, week)}?season_type=regular`,
      [],
    ),
  }));
}
