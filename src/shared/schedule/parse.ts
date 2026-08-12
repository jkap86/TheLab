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

/** Whether a claimed kickoff is a believable ms epoch — see the note above. */
const believable = (at: number | null | undefined): at is number =>
  typeof at === "number" &&
  Number.isFinite(at) &&
  at >= MIN_PLAUSIBLE_MS &&
  at <= MAX_PLAUSIBLE_MS;

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
    if (!believable(game.start_time)) continue;
    if (earliest === null || game.start_time < earliest) earliest = game.start_time;
  }

  return earliest;
}

/**
 * Team → kickoff instant for one week of the schedule, epoch ms — what a
 * kickoff-ordered lineup (`projections/kickoff-order`) reads a player's game
 * time from, through the team on his player row.
 *
 * Both sides of a game kick off together, so a believable `start_time` is
 * filed under the home and the away team alike. A game without one is skipped
 * on `openingKickoff`'s own terms — an absent team here is "not known", which
 * the ordering answers by holding the seat, never a guess. A team the data
 * lists twice in one week keeps its earliest instant, the conservative read
 * for anything deciding what has already locked.
 */
export function weekKickoffs(
  games: readonly SleeperScheduleGame[],
  week: number,
): Map<string, number> {
  const kickoffs = new Map<string, number>();

  for (const game of games) {
    if (game?.week !== week) continue;
    if (!believable(game.start_time)) continue;
    for (const team of [game.home, game.away]) {
      if (typeof team !== "string" || team === "") continue;
      const known = kickoffs.get(team);
      if (known === undefined || game.start_time < known) {
        kickoffs.set(team, game.start_time);
      }
    }
  }

  return kickoffs;
}
