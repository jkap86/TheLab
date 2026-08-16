import type { OverallRecord } from "../shared/record.ts";
import { projectedOutcomes } from "./projected-result.ts";
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
 *   only where a result can be formed — a bye has no opponent to beat, a week
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
 * **A league is not a game, which is where this parts company with the version
 * before it.** A league playing Sleeper's median takes *two* results out of a
 * week — one against its opponent and one against the field — so `games` and
 * `leagues` are counted apart rather than one being assigned from the other. It
 * is also why the sum runs through {@link projectedOutcomes} rather than
 * comparing the two numbers here: a card prints exactly those marks, so the
 * plate reading them through the same function is what stops it from disagreeing
 * with the list underneath it.
 *
 * The comparison is *current against current* throughout — see
 * {@link projectedOutcomes} for why no side is ever credited with its best
 * lineup.
 */
export function projectedRecord(
  leagues: readonly { league_id: string }[],
  matchups: Readonly<Record<string, LeagueMatchupPayload>>,
): OverallRecord {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let counted = 0;

  for (const league of leagues) {
    const outcomes = projectedOutcomes(matchups[league.league_id]);
    if (outcomes.length === 0) continue;
    counted++;

    for (const { outcome } of outcomes) {
      if (outcome === "W") wins++;
      else if (outcome === "L") losses++;
      else ties++;
    }
  }

  const games = wins + losses + ties;
  return {
    wins,
    losses,
    ties,
    games,
    // Both carried and no longer derivable from each other: a median league is
    // one league and two games, so the plate's "from N of M leagues" line and
    // its win percentage are counting different things.
    leagues: counted,
    pct: games > 0 ? (wins + ties / 2) / games : null,
  };
}
