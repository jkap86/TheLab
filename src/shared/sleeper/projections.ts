import http from "@thelab/http";

import { sleeperDataUrl } from "./client";
import type { SleeperProjection } from "./types";

/**
 * Fetch every projection Sleeper publishes for one week (~5.6MB, ~9,400
 * entries). Only a tenth of those entries are real projections — see
 * {@link SleeperProjection} — so callers filter before storing anything.
 *
 * Deliberately no `position[]` filter: passing none returns every position,
 * including IDP, in this single request. Filtering by position doesn't shrink the
 * response much (the junk entries dominate either way) and would turn one
 * request per week into nine.
 *
 * An unknown week is not an error here — Sleeper answers 200 with a list of
 * placeholder entries, which the caller's filter reduces to nothing.
 */
export async function fetchWeekProjections(
  season: string,
  week: number,
): Promise<SleeperProjection[]> {
  const url =
    `${sleeperDataUrl("projections", "nfl", season, week)}` +
    `?season_type=regular&order_by=ppr`;

  const { data } = await http.get<SleeperProjection[] | null>(url);
  return Array.isArray(data) ? data : [];
}
