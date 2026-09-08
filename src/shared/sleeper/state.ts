import { sleeperGet, sleeperUrl } from "./client";
import { memoizeNflState } from "./memoize-nfl-state";
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

function fetchNflState(): Promise<SleeperNflState | null> {
  return sleeperGet<SleeperNflState | null>(sleeperUrl("state", "nfl"), null);
}

/**
 * Cached on `globalThis` for the reason the Sleeper limiter is — a per-bundle
 * copy would ask Sleeper once per route rather than once per process. The
 * memo's whole state is its closure, so the closure is what is shared.
 */
const MEMO_KEY = Symbol.for("thelab.sleeper.nfl-state");
const globalScope = globalThis as typeof globalThis & {
  [MEMO_KEY]?: ReturnType<typeof memoizeNflState>;
};
const memoized = (globalScope[MEMO_KEY] ??= memoizeNflState(fetchNflState));

/**
 * Current NFL state. In the offseason `week` is 0 and `season_type` is "off";
 * during the season `week` tracks the current NFL week.
 *
 * Memoized for a minute (`memoize-nfl-state`): five routes read it per request
 * and three loops per tick, and none of them wants a fresher answer than that.
 */
export function getNflState(): Promise<SleeperNflState | null> {
  return memoized();
}
