import type { OverallRecord } from "../shared/record.ts";
import type { LeagueMatchupPayload } from "./types";

/**
 * The record this account is *projected* to take out of the week, summed across
 * the leagues on screen.
 *
 * The plate above this list draws the same shape the manager tabs' plate draws,
 * and deliberately so — but the number behind it is a different question. There
 * it is the season as played; here it is one week as it currently stands, which
 * is the only reading a lineup checker can act on. Pure and tested for the reason
 * {@link aggregateRecord} is: the two rules below are the whole of what this
 * decides, and both are the kind that reads as correct while being wrong.
 *
 * - **The denominator is what contributed, not what was listed.** A league counts
 *   only where *both* sides have a number — a bye has no opponent to beat, a week
 *   the crawler has not reached has no lineup to read, and a league with no slots
 *   or scoring on file cannot be projected at all. Each of those is a league on
 *   the list with no result in it, so `leagues` travels with the totals exactly
 *   as it does for a season record: a denominator smaller than the list is only
 *   honest when it is stated.
 * - **Zero and absent are different answers.** Nothing projectable means `pct` is
 *   null and the dial reads an em dash, never `.000` — a win percentage over no
 *   games is a claim about a week nobody has played, the same call the season
 *   record makes in preseason.
 *
 * The comparison is *current against current*: what these lineups do if nothing
 * is touched. Crediting either side with its best lineup would answer a question
 * nobody asked — and on this page it would answer the wrong one twice over, since
 * the gap between the two readings is the very thing the list's first column is
 * for.
 */
export function projectedRecord(
  leagues: readonly { league_id: string }[],
  matchups: Readonly<Record<string, LeagueMatchupPayload>>,
): OverallRecord {
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const league of leagues) {
    const matchup = matchups[league.league_id];
    const mine = matchup?.projection?.current;
    const theirs = matchup?.opponent_projection;
    // Both halves, and `undefined`/`null` checked rather than falsy: a roster
    // projected to score nothing is a real zero and a real loss, where a missing
    // number is not a result at all.
    if (mine === undefined || theirs === null || theirs === undefined) continue;

    if (mine > theirs) wins++;
    else if (mine < theirs) losses++;
    else ties++;
  }

  const games = wins + losses + ties;
  return {
    wins,
    losses,
    ties,
    games,
    // Every counted league is a game here — unlike a season record, where a
    // league can hold a team and have played nothing — so the two agree by
    // construction. They are still both carried, because the plate reads them
    // as separate facts and one of them being derivable is not a reason for it
    // to be missing.
    leagues: games,
    pct: games > 0 ? (wins + ties / 2) / games : null,
  };
}
