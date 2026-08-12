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

/** One NFL team's game in a week: who they play, which end of it they are, and when. */
export type TeamGame = {
  /**
   * The other team's code, or null where the schedule names only this side.
   *
   * Null is "not named", never a bye: a team on a bye has no entry at all, so
   * the two are told apart by the map rather than by this field. Keeping the
   * half-named game is what lets {@link weekKickoffs} stay exactly what it was
   * — the instant is knowable whether or not the opponent is.
   */
  opponent: string | null;
  /** Whether this team is the home side. */
  home: boolean;
  /**
   * Kickoff, epoch ms, or null where the schedule gives only a date.
   *
   * Null rather than an hour invented from `date`, {@link openingKickoff}'s own
   * rule: this module reports what the schedule claims and nothing more.
   */
  kickoff: number | null;
};

/**
 * Whether a second listing of one team supersedes the one already held.
 *
 * A dated game beats an undated one and the earlier of two dated games wins —
 * the conservative read for anything deciding what has already locked, which is
 * the rule {@link weekKickoffs} has always kept and now inherits from here.
 */
const supersedes = (next: TeamGame, held: TeamGame): boolean =>
  next.kickoff !== null && (held.kickoff === null || next.kickoff < held.kickoff);

/**
 * Team → its game for one week of the schedule: the opponent, the side of it,
 * and the kickoff instant.
 *
 * Both sides of a game are filed, each with the other named as its opponent, so
 * a lookup by the NFL team on a player row answers both "who does he play" and
 * "when". A team **absent** from a non-empty map is on a bye; an empty map is a
 * schedule this process could not read, which is a different answer and is why
 * callers test the map rather than the entry.
 *
 * A team the data lists twice in one week keeps one entry, per
 * {@link supersedes}.
 */
export function weekGames(
  games: readonly SleeperScheduleGame[],
  week: number,
): Map<string, TeamGame> {
  const byTeam = new Map<string, TeamGame>();

  const named = (team: string | null | undefined): string | null =>
    typeof team === "string" && team !== "" ? team : null;

  for (const game of games) {
    if (game?.week !== week) continue;
    const kickoff = believable(game.start_time) ? game.start_time : null;
    const home = named(game.home);
    const away = named(game.away);

    for (const side of [
      { team: home, opponent: away, home: true },
      { team: away, opponent: home, home: false },
    ]) {
      if (side.team === null) continue;
      const entry: TeamGame = {
        opponent: side.opponent,
        home: side.home,
        kickoff,
      };
      const held = byTeam.get(side.team);
      if (held === undefined || supersedes(entry, held)) byTeam.set(side.team, entry);
    }
  }

  return byTeam;
}

/**
 * Team → kickoff instant for one week of the schedule, epoch ms — what a
 * kickoff-ordered lineup (`projections/kickoff-order`) reads a player's game
 * time from, through the team on his player row.
 *
 * **Derived from {@link weekGames} rather than walked for itself**, the usual
 * rule here: two passes over the same array with subtly different ideas of
 * which listing of a team wins is two answers to one question. Dropping the
 * undated entries is what keeps this exactly what it was — an absent team is
 * "not known", which the ordering answers by holding the seat, never a guess.
 */
export function weekKickoffs(
  games: readonly SleeperScheduleGame[],
  week: number,
): Map<string, number> {
  const kickoffs = new Map<string, number>();

  for (const [team, game] of weekGames(games, week)) {
    if (game.kickoff !== null) kickoffs.set(team, game.kickoff);
  }

  return kickoffs;
}
