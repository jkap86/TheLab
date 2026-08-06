import type { LeagueMatchupPayload, MatchupOpponentPayload } from "./types";

/**
 * What a league's row can say about this week's game, and how to say it.
 *
 * Pure and tested for the reason its neighbours in the other tools are: the two
 * rules below are the whole of what the row decides, and both are the kind that
 * reads as correct while being wrong.
 */

/**
 * What to call the team on the other side: their Sleeper username, else the team
 * name, else the roster number.
 *
 * The username leads because this list spans a manager's whole portfolio — the
 * same opponent turns up in several leagues, and a team name is a nickname
 * someone picked for one of them and changes at will, so labelling by it makes
 * one person read as several. It is the same call the standings' `managerLabel`
 * makes, for the same reason; the team name is still worth falling back to,
 * since a made-up name identifies someone better than "Roster 7" does.
 */
export function opponentLabel(opponent: MatchupOpponentPayload): string {
  return (
    opponent.display_name || opponent.team_name || `Roster ${opponent.roster_id}`
  );
}

/**
 * What a row knows about its matchup — four answers, because three of them are
 * different kinds of nothing and a row that drew them all as an em dash would be
 * telling a reader their league has no game when what it has is no data.
 *
 * - `no-week`: nothing ahead of today is stored for the season at all, so there
 *   is no week to have a matchup in. A property of the payload, not of a league.
 * - `unsynced`: the league is missing from the read — the crawler has not stored
 *   this week for it yet. Absent is not empty.
 * - `bye`: stored, and the league scheduled this roster nobody to play. A real
 *   answer: an odd-sized league byes somebody every week.
 * - `opponent`: the team to beat.
 */
export type MatchupState =
  | { kind: "no-week" }
  | { kind: "unsynced" }
  | { kind: "bye" }
  | { kind: "opponent"; opponent: MatchupOpponentPayload };

export function matchupState(
  week: number | null,
  matchup: LeagueMatchupPayload | undefined,
): MatchupState {
  if (week === null) return { kind: "no-week" };
  if (!matchup) return { kind: "unsynced" };
  if (!matchup.opponent) return { kind: "bye" };
  return { kind: "opponent", opponent: matchup.opponent };
}
