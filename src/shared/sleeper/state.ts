import http from "@thelab/http";

import { SLEEPER_API_BASE } from "./client";
import type { SleeperNflState } from "./types";

/**
 * Current NFL state. Used to bound how many weeks of transactions to fetch:
 * in the offseason `week` is 0, so callers floor it to 1 (offseason moves are
 * logged at week 1); during the season it is the current week.
 */
export async function getNflState(): Promise<SleeperNflState | null> {
  const { data } = await http.get<SleeperNflState | null>(
    `${SLEEPER_API_BASE}/state/nfl`,
  );
  return data ?? null;
}
