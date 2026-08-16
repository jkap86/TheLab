import type { LeagueMatchupPayload } from "./types";

/**
 * What a league's week is projected to come to — one result against the
 * scheduled opponent, and a second against the league median where the league
 * plays one.
 *
 * Pure and tested beside {@link projectedRecord}, and it exists as its own
 * module because **the plate and the cards read it through one function**: the
 * record above the list is the sum of the marks the rows print, so a league that
 * shows `W L` has to be the league that contributed one win and one loss. Two
 * spellings of "did this lineup win" is exactly the drift that would leave a
 * plate disagreeing with the list under it, and neither number looks wrong on
 * its own.
 */

/** One projected result: a win, a loss, or a tie. */
export type ProjectedOutcome = "W" | "L" | "T";

/**
 * What a result was measured against — the scheduled opponent, or the middle of
 * the league's week.
 *
 * It travels with the outcome because a mark is one letter and a letter cannot
 * say which question it answered. Nothing on the row is written to explain the
 * pair, so the *seat* carries it visually and this carries it for the hover and
 * for a screen reader, which have no seat to read.
 */
export type ProjectedBar = "opponent" | "median";

/** One league's projected result against one bar. */
export type ProjectedResult = {
  against: ProjectedBar;
  outcome: ProjectedOutcome;
};

/**
 * Which way a projection falls against a bar, or null where there is no result
 * to report.
 *
 * **Null and zero are different answers, and both halves are checked
 * explicitly.** A roster projected to score nothing is a real zero and a real
 * loss; a projection that is *missing* — a bye with nobody to beat, a week the
 * crawler has not reached, a league with no slots or scoring on file — is not a
 * result at all. Written against `undefined` and `null` rather than falsily,
 * since a `0` on either side is the case a truthiness test gets wrong.
 */
export function projectedOutcome(
  mine: number | null | undefined,
  bar: number | null | undefined,
): ProjectedOutcome | null {
  if (mine === null || mine === undefined) return null;
  if (bar === null || bar === undefined) return null;

  if (mine > bar) return "W";
  if (mine < bar) return "L";
  return "T";
}

/**
 * Every result this league's week holds, in the order a card prints them:
 * against the opponent first, then against the median.
 *
 * **The order is the load-bearing part.** A median league's mark reads `W L`,
 * and which half is which is not written anywhere on the row — it is the seat
 * that says so, exactly as the head-to-head result sits beside the opponent it
 * is a result against. So the opponent's leads on every card that has one, and
 * a card missing one result draws one mark rather than a gap.
 *
 * Both are the *current* lineups on every side — the manager's, the opponent's,
 * and the whole field's for the median. What today's lineups do if nothing is
 * touched is the only reading a lineup checker can act on; crediting anybody
 * with their best lineup would answer a question nobody asked, and on this page
 * it would answer the wrong one twice over, since the gap between the two
 * readings is what the list's own column is for.
 *
 * A league can legitimately contribute **two, one or none**: two in a median
 * league whose week projects, one in an ordinary league — or in a median league
 * where the manager is on a bye, which is a real week in an odd-sized league and
 * a real result against the field — and none where nothing projects at all.
 */
export function projectedOutcomes(
  matchup: LeagueMatchupPayload | undefined,
): ProjectedResult[] {
  const mine = matchup?.projection?.current;

  const results: ProjectedResult[] = [];
  const head = projectedOutcome(mine, matchup?.opponent_projection);
  if (head) results.push({ against: "opponent", outcome: head });
  const median = projectedOutcome(mine, matchup?.median_projection);
  if (median) results.push({ against: "median", outcome: median });

  return results;
}
