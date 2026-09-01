import { sleeperGet, sleeperUrl } from "./client";
import type { SleeperNflState } from "./types/sleeper.types";

/**
 * The season compiled into this build, used only when nothing better can answer.
 *
 * **It is a release note disguised as a string**, which is the whole reason
 * `shared/season` exists to resolve around it: the day Sleeper rolls the league
 * year over, an un-redeployed app reading this constant looks like it has
 * stopped working rather than like it needs a deploy. Nothing should import it
 * to *default* a season — call `getActiveSeason` — and the one legitimate reader
 * is the resolver, as its last rung.
 *
 * It sits beside {@link getNflState} because that call is what supersedes it;
 * TheLabX keeps it in `sleeper/leagues`, which this app has not ported yet.
 */
export const DEFAULT_SEASON = "2026";

/**
 * Current NFL state. In the offseason `week` is 0 and `season_type` is "off";
 * during the season `week` tracks the current NFL week.
 */
export function getNflState(): Promise<SleeperNflState | null> {
  return sleeperGet<SleeperNflState | null>(sleeperUrl("state", "nfl"), null);
}
