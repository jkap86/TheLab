import http from "@thelab/http";

import { sleeperDataUrl } from "./client";
import type { SleeperScheduleGame } from "./types";

/**
 * Fetch one season's regular-season schedule.
 *
 * Lives on the undocumented data host like the projections — build the URL
 * with `sleeperDataUrl`, since the v1 host's habit of answering unknown paths
 * with plausible-looking 200s is exactly the trap `SLEEPER_DATA_BASE` exists
 * to avoid. The response is normalised to an array here so callers never see
 * the endpoint's shape: a season Sleeper hasn't published answers empty, and
 * so would a response this code doesn't recognise.
 */
export async function getNflSchedule(
  season: string,
): Promise<SleeperScheduleGame[]> {
  const url = sleeperDataUrl("schedule", "nfl", "regular", season);
  const { data } = await http.get<unknown>(url);
  if (Array.isArray(data)) return data as SleeperScheduleGame[];
  // Some data-host endpoints key collections by id rather than listing them;
  // accept that spelling too rather than reading it as an empty season.
  if (data && typeof data === "object") {
    return Object.values(data) as SleeperScheduleGame[];
  }
  return [];
}
