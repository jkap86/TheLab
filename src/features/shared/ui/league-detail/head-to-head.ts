/**
 * Which two rosters a week panel puts side by side, and when it has a pair at
 * all.
 *
 * Pure and tested for the reason its neighbours in this folder are: the whole of
 * the decision is three refusals, and every one of them reads as a corner case
 * while being the ordinary state of a league the crawler has not caught up with.
 * A panel that resolved the wrong pair would render perfectly well and put a
 * stranger's bench where the reader's own lineup should be.
 *
 * Generic in the team so it imports nothing at all — the panel's own
 * `LeagueTeamView` satisfies it, and so does a plain object in a test.
 */

/** The reader's roster and the one it is playing, in that order. */
export type HeadToHead<T> = { mine: T; theirs: T };

/**
 * The pair, or null where this panel should draw the league instead.
 *
 * Null is not a failure — it is what every panel that isn't a lineup check
 * answers, and what a lineup check answers on a bye, on a week the crawler has
 * not stored, and on a league whose rosters have moved on since the matchup was
 * read. Each of those is a real state and each of them falls through to the
 * standings, which is the more useful thing to show when there is no game.
 *
 * Three refusals, and the third is the one that is easy to leave out. **Both
 * ids have to be given**, since a caller with no week has neither and a caller
 * on a bye has only the first. **Both have to name a team this league actually
 * holds**, because the matchup and the league detail are two reads and a roster
 * can leave between them. And **they have to differ**: a league that has
 * somehow scheduled a roster against itself would otherwise draw the same
 * lineup twice, side by side, with a `vs` between them.
 */
export function headToHead<T extends { roster_id: number }>(
  teams: readonly T[],
  mineRosterId: number | undefined,
  theirsRosterId: number | undefined,
): HeadToHead<T> | null {
  if (mineRosterId === undefined || theirsRosterId === undefined) return null;
  if (mineRosterId === theirsRosterId) return null;

  const mine = teams.find((team) => team.roster_id === mineRosterId);
  const theirs = teams.find((team) => team.roster_id === theirsRosterId);
  if (!mine || !theirs) return null;

  return { mine, theirs };
}
