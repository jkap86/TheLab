import http from "@thelab/http";

import { SLEEPER_API_BASE } from "./client";
import type { SleeperPlayerMap } from "./types";

/**
 * Fetch Sleeper's entire NFL players map (~12k entries, ~5MB). Sleeper asks
 * callers to hit this at most once per day, so it must be cached — see
 * `@/shared/players`.
 */
export async function getAllPlayers(): Promise<SleeperPlayerMap> {
  const { data } = await http.get<SleeperPlayerMap | null>(
    `${SLEEPER_API_BASE}/players/nfl`,
  );
  return data ?? {};
}
