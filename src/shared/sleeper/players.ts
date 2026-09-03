import { sleeperGet, sleeperUrl } from "./client";
import type { SleeperPlayerMap } from "./types/sleeper.types";

/**
 * Sleeper's entire NFL players map (~12k entries, ~5MB).
 *
 * **Sleeper asks callers to hit this at most once per day**, which is why
 * nothing calls it directly: `shared/players` holds the stored copy and the
 * TTL, and this is the one fetch behind it. It goes through `sleeperGet` like
 * everything else, so it queues on the same process-wide limiter — a 5MB
 * response is exactly the request that should not be racing a page's fan-out.
 *
 * `sleeperGet` rather than `sleeperGetOptional`, so a **404 throws**: an empty
 * players map would leave every name on the trades board unresolved, and the
 * sync would rather fail and leave yesterday's rows standing. The `{}` is only
 * the fallback for Sleeper's 200-with-null spelling, and the sync reads a zero
 * count from it as "nothing to write".
 */
export function getAllPlayers(): Promise<SleeperPlayerMap> {
  return sleeperGet<SleeperPlayerMap>(sleeperUrl("players", "nfl"), {});
}
