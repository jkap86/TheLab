import { sleeperGet, sleeperUrl } from "./client";
import type { SleeperPlayerMap } from "./types";

/**
 * Fetch Sleeper's entire NFL players map (~12k entries, ~5MB). Sleeper asks
 * callers to hit this at most once per day, so it must be cached — see
 * `@/shared/players`.
 */
export function getAllPlayers(): Promise<SleeperPlayerMap> {
  return sleeperGet(sleeperUrl("players", "nfl"), {});
}
