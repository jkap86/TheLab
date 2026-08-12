import http from "@thelab/http";

import { sleeperDataUrl } from "./client";
import type { SleeperScoreGame } from "./types";

/**
 * Fetch one week's NFL scoreboard — sixteen-odd games, each carrying the two
 * teams and the kickoff instant.
 *
 * Lives on the undocumented data host like the projections, and for the usual
 * reason: build the URL with `sleeperDataUrl`, since the v1 host's habit of
 * answering unknown paths with plausible-looking 200s is exactly the trap
 * `SLEEPER_DATA_BASE` exists to avoid.
 *
 * **Per week rather than per season, which is cheaper than what it replaced.**
 * The schedule call it supersedes returned all 272 games of a season and was
 * re-fetched for every week anyway (only the derived map was cached), so a week
 * now costs sixteen entries instead of a season's worth.
 *
 * A season Sleeper hasn't scheduled answers `[]`, as does a week past the
 * regular season — both verified — so an unknown week is not an error here. The
 * response is normalised to an array so callers never see the endpoint's shape,
 * and a response this code doesn't recognise reads as an unscheduled week
 * rather than throwing: every reader above treats "no games" as "no answer",
 * which is the honest degradation. Deliberately *not* `Object.values`-ed like
 * the projections map — a payload keyed by week would yield arrays of games,
 * and each would then fail every field test in silence.
 */
export async function getNflWeekScores(
  season: string,
  week: number,
): Promise<SleeperScoreGame[]> {
  const url = sleeperDataUrl("scores", "nfl", "regular", season, week);
  const { data } = await http.get<unknown>(url);
  return Array.isArray(data) ? (data as SleeperScoreGame[]) : [];
}
