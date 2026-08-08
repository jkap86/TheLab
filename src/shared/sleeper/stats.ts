import http from "@thelab/http";

import { sleeperDataUrl } from "./client";
import type { SleeperProjection } from "./types";

/**
 * Fetch every actual stat line Sleeper publishes for one week.
 *
 * The projections endpoint's sibling in every respect that matters — same
 * undocumented host, same envelope, same `season_type=regular` — which is why it
 * reuses {@link SleeperProjection} rather than declaring a near-identical type
 * beside it. The two differ in `category` ("stat" against "proj") and in what
 * `stats` holds; the shape around them is one shape.
 *
 * **The host is load-bearing, the same trap `fetchWeekProjections` documents.**
 * `api.sleeper.app/v1/stats/nfl/…` answers 200 with an object of empty objects,
 * which parses cleanly and means nothing — so this builds from
 * {@link sleeperDataUrl} and a "working" read against the v1 host is the failure
 * to watch for.
 *
 * Deliberately no `position[]` filter, for the reason projections takes none:
 * omitting it returns every position including IDP in this one request, where
 * filtering would turn one request per week into nine without meaningfully
 * shrinking the response.
 *
 * A week that has not been played is not an error — Sleeper answers 200 with
 * placeholder entries carrying no game and no stats, which the caller's filter
 * reduces to nothing. That is a real answer ("not played yet"), and the sync
 * stamps it as fetched rather than treating it as a failure.
 */
export async function fetchWeekStats(
  season: string,
  week: number,
): Promise<SleeperProjection[]> {
  const url =
    `${sleeperDataUrl("stats", "nfl", season, week)}` +
    `?season_type=regular&order_by=ppr`;

  const { data } = await http.get<SleeperProjection[] | null>(url);
  return Array.isArray(data) ? data : [];
}
