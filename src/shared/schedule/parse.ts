import type { SleeperScoreGame } from "@/shared/sleeper";

/**
 * Bounds a kickoff instant must land in to be believed, epoch ms. Sleeper's
 * clocks are milliseconds everywhere (draft `start_time`, a projection's
 * `last_modified`), and the scoreboard is no exception — but this endpoint is
 * undocumented, and a seconds epoch would read as January 1970 and count down
 * to fifty years ago. The window is generous on purpose: it exists to reject a
 * different *unit*, not to argue with a strange schedule.
 *
 * **It rejects rather than converts, which is the right half of a real trap.**
 * A wrong unit here would drive lineup advice and game locking, so believing
 * one is worse than having none. What it must never be asked to do is stand in
 * for a *missing* field: the schedule endpoint publishes no `start_time` at
 * all, and reading it through this guard produced an empty answer that looked
 * exactly like a rejected unit — see {@link SleeperScoreGame}.
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
 * The instant of a season's opening kickoff: the earliest game on the week-1
 * scoreboard carrying a believable `start_time`. Null when it doesn't say — a
 * season Sleeper hasn't published, which answers with no games at all.
 *
 * The caller names week 1 in the request, so there is no week to filter on
 * here; every row it is handed is a week-1 game by construction.
 *
 * Null rather than an hour invented from `date`, deliberately: this module
 * reports what Sleeper actually claims, and the client already holds the
 * provisional fallback (the NFL calendar table) for a season with no scheduled
 * instant. Inventing 8:20 PM here would dress a guess up as Sleeper's word.
 */
export function openingKickoff(
  games: readonly SleeperScoreGame[],
): number | null {
  let earliest: number | null = null;

  for (const game of games) {
    if (!believable(game?.start_time)) continue;
    if (earliest === null || game.start_time < earliest) earliest = game.start_time;
  }

  return earliest;
}

/** One NFL team's game in a week: who they play, which end of it they are, and when. */
export type TeamGame = {
  /**
   * The other team's code, or null where the scoreboard names only this side.
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
   * Kickoff, epoch ms, or null where the row carries no believable instant.
   *
   * Null rather than an hour invented from `date`, {@link openingKickoff}'s own
   * rule: this module reports what Sleeper claims and nothing more.
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
 * Team → its game for one week of the scoreboard: the opponent, the side of it,
 * and the kickoff instant.
 *
 * Both sides of a game are filed, each with the other named as its opponent, so
 * a lookup by the NFL team on a player row answers both "who does he play" and
 * "when". A team **absent** from a non-empty map is on a bye; an empty map is a
 * week this process could not read, which is a different answer and is why
 * callers test the map rather than the entry.
 *
 * The week is named in the request rather than filtered here, so a row Sleeper
 * files under a week of its own is still this week's game — the endpoint
 * answers one week and nothing else.
 *
 * A team the data lists twice in one week keeps one entry, per
 * {@link supersedes}.
 */
export function weekGames(
  games: readonly SleeperScoreGame[],
): Map<string, TeamGame> {
  const byTeam = new Map<string, TeamGame>();

  const named = (team: string | null | undefined): string | null =>
    typeof team === "string" && team !== "" ? team : null;

  for (const game of games) {
    const kickoff = believable(game?.start_time) ? game.start_time : null;
    // The two teams live on `metadata`, which is the whole shape difference
    // between this endpoint and the timeless schedule call it replaced.
    const home = named(game?.metadata?.home_team);
    const away = named(game?.metadata?.away_team);

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
 * Team → kickoff instant for one week, epoch ms — what a kickoff-ordered lineup
 * (`projections/kickoff-order`) reads a player's game time from, through the
 * team on his player row.
 *
 * **Derived from {@link weekGames} rather than walked for itself**, the usual
 * rule here: two passes over the same array with subtly different ideas of
 * which listing of a team wins is two answers to one question. Dropping the
 * undated entries is what keeps this exactly what it was — an absent team is
 * "not known", which the ordering answers by holding the seat, never a guess.
 */
export function weekKickoffs(
  games: readonly SleeperScoreGame[],
): Map<string, number> {
  const kickoffs = new Map<string, number>();

  for (const [team, game] of weekGames(games)) {
    if (game.kickoff !== null) kickoffs.set(team, game.kickoff);
  }

  return kickoffs;
}
