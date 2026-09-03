import { sleeperDataUrl, sleeperGet } from "./client";
import type { SleeperScoreGame } from "./types/sleeper.types";

/**
 * One week's NFL scoreboard, from the undocumented data host —
 * `GET api.sleeper.com/scores/nfl/regular/<season>/<week>`.
 *
 * **The only Sleeper call that publishes a kickoff instant**, which is the
 * whole reason it exists: `shared/schedule` reads `start_time` off it to decide
 * which seats have locked and which lock next. {@link SleeperScoreGame}'s doc
 * carries the warning that matters — the obvious source,
 * `schedule/nfl/regular/<season>`, carries no time at all, and reading it for
 * one is what left every kickoff reader silently on a fallback.
 *
 * `sleeperGet` rather than `sleeperGetOptional`, deliberately: a week Sleeper
 * has not scheduled answers `200` with an empty array, so a 404 here is a real
 * fault rather than an answer. Folding it would let the schedule cache above
 * remember an outage as "no games this week" for twelve hours.
 *
 * A body that is not an array is normalised to `[]` rather than trusted —
 * everything downstream reads this defensively, and an unrecognisable shape is
 * the same answer as an unscheduled week.
 */
export async function getNflWeekScores(
  season: string,
  week: number,
): Promise<SleeperScoreGame[]> {
  const games = await sleeperGet<unknown>(
    sleeperDataUrl("scores", "nfl", "regular", season, week),
    [],
  );
  return Array.isArray(games) ? (games as SleeperScoreGame[]) : [];
}
