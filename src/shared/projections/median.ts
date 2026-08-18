/**
 * The middle of a week's scores, for the leagues that play every team against it
 * — Sleeper's `league_average_match`.
 *
 * Pure and tested for the reason its neighbours here are: it is a rule rather
 * than a read, and it is the kind that reads as correct while being wrong. A
 * median over an even population is the *mean of the two middle scores* and not
 * either of them, which is the whole of why Sleeper's median leagues split
 * exactly half and half every week — take the lower middle instead and a
 * twelve-team league hands out seven wins and five losses in perpetuity, which
 * is a bug nothing on screen would show.
 */

/**
 * The median of the scores given, or null where there is no honest middle.
 *
 * Three rules, and each is a different kind of nothing collapsing if it is
 * skipped:
 *
 * - **Fewer than two scores is no median.** One team's score is its own middle,
 *   so every such league would report a tie against itself — a result invented
 *   out of a league the crawler has only half-stored. Null is the answer the
 *   payload already spells for "cannot be projected".
 * - **The population is not sorted in place.** The caller's array is the order
 *   the lineups came back in and is read again after this; sorting it under them
 *   is the in-place edit `deepFreeze` exists to catch one layer up.
 * - **An even count averages the two middles**, per the note above. It is also
 *   why the answer is not necessarily any team's score: a manager can lose to a
 *   median nobody posted, which is correct and is what Sleeper does.
 */
export function medianScore(scores: readonly number[]): number | null {
  if (scores.length < 2) return null;

  const sorted = [...scores].sort((a, b) => a - b);
  const middle = sorted.length / 2;

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[Math.floor(middle)];
}

/**
 * The middle of a solved week in both readings — the best lineups available, and
 * the ones actually set.
 *
 * Both, because the two answer different questions and each has a reader. The
 * league panel prints `optimal`, since the roster headings beside it show each
 * team's best lineup and a bar in different units from the numbers it sits over
 * cannot be compared; the lineup checker's mark is counted on `current`, which
 * is what the week comes to if nothing is touched. Folding one and deriving the
 * other is not available — a median is not linear, so the middle of the best
 * lineups is not the middle of the set ones plus anything.
 *
 * **The two are taken independently and can name different teams**, which is
 * correct rather than a rounding artefact: the team sitting at the middle of the
 * league by best lineup need not be the one sitting there by what it has set.
 *
 * Null where {@link medianScore} refuses either half, which is the same
 * condition for both — fewer than two teams — so a week that has one reading has
 * both, and a caller never has to draw half a bar.
 *
 * Generic in the team so this module still imports nothing: the week view's own
 * `TeamWeekProjection` satisfies it, and so does a plain object in a test.
 */
export function medianLineups<T extends { optimal: number; current: number }>(
  teams: readonly T[],
): { optimal: number; current: number } | null {
  const optimal = medianScore(teams.map((team) => team.optimal));
  const current = medianScore(teams.map((team) => team.current));

  return optimal === null || current === null ? null : { optimal, current };
}
