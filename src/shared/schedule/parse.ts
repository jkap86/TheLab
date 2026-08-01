import type { SleeperScheduleGame } from "@/shared/sleeper";

/**
 * Bounds a kickoff instant must land in to be believed, epoch ms. Sleeper's
 * clocks are milliseconds everywhere (draft `start_time`, a projection's
 * `last_modified`), but this endpoint is undocumented — a seconds epoch would
 * read as January 1970, and trusting it would count down to fifty years ago.
 * The window is generous on purpose: it exists to reject a different *unit*,
 * not to argue with a strange schedule.
 */
const MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1);
const MAX_PLAUSIBLE_MS = Date.UTC(2100, 0, 1);

/**
 * The instant of a season's opening kickoff: the earliest week-1 game the
 * schedule stamps with a believable `start_time`. Null when it doesn't say —
 * a season Sleeper hasn't published, or one scheduled only to the day.
 *
 * Null rather than an hour invented from `date`, deliberately: this module
 * reports what the schedule call actually claims, and the client already
 * holds the provisional fallback (the NFL calendar table) for a season with
 * no scheduled instant. Inventing 8:20 PM here would dress a guess up as
 * Sleeper's word.
 */
export function openingKickoff(
  games: readonly SleeperScheduleGame[],
): number | null {
  let earliest: number | null = null;

  for (const game of games) {
    if (game?.week !== 1) continue;
    const at = game.start_time;
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    if (at < MIN_PLAUSIBLE_MS || at > MAX_PLAUSIBLE_MS) continue;
    if (earliest === null || at < earliest) earliest = at;
  }

  return earliest;
}
