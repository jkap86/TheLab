// Relative and with the extension, never the `@/shared/projections` barrel: this
// module is tested under Node's runner, so a value import has to resolve without
// the alias — and that barrel would drag `pg` in behind it. `score.ts` is pure,
// which is what makes the pure→pure relative import the right spelling rather
// than a workaround (`optimal.ts` → `./slots.ts` is the same seam).
import { scoreStatLine } from "../projections/score.ts";

/**
 * Points per game, from stored stat lines and one league's scoring.
 *
 * Pure — the scoring settings and the lines both arrive as arguments, the bar
 * `ktc/match` and `projections/score` hold — so the rules below can be read and
 * tested without a database behind them.
 *
 * Three decisions live here rather than in the route that calls it, and each is
 * the kind that reads as a detail and shows up as a wrong number.
 */

/** One played week for one player: the week, and the line he put up in it. */
export type StatLine = {
  week: number;
  stats: Record<string, number> | null;
};

/** A points-per-game reading, with the population it was counted over. */
export type Ppg = {
  /** The average itself, in the league's own scoring. */
  average: number;
  /** Total points across the games counted. */
  points: number;
  /**
   * How many games contributed.
   *
   * It travels *with* the average rather than being derivable from it — the same
   * habit as `outlook.weeks`, KTC's `priced` of `rostered` and
   * `aggregateRecord`'s league count. An average over two games and one over
   * eleven are different claims, and only the denominator says which you are
   * reading.
   */
  games: number;
};

/**
 * The weeks a points-per-game average is counted over, for a board being read at
 * `week`.
 *
 * **Strictly before it, which is what makes the week-1 fallback mean anything.**
 * The average answers "what has this player been doing coming into this week",
 * so the week on screen is not in its own average — including it would fold a
 * projection's own week into the form the projection is being judged against,
 * and mid-week it would fold in a *part-played* week, which is a low number
 * wearing the same units as a full one.
 *
 * Week 1 therefore has an empty window, which is not an edge case to guard but
 * the whole reason {@link Ppg} has a prior-season spelling: there is nothing this
 * season to average, so the honest stand-in is what last season said.
 */
export function ppgWindow(week: number): number[] {
  const upto = Math.trunc(week) - 1;
  if (!Number.isFinite(upto) || upto < 1) return [];
  return Array.from({ length: upto }, (_, i) => i + 1);
}

/**
 * One player's points per game across the lines he has, or null when he has
 * none.
 *
 * **Null rather than zero, and the difference is the point.** A player with no
 * stored line for a week did not play it — injured, inactive, on another team's
 * practice squad — and averaging that as a nought would report a healthy starter
 * who missed three games as a worse player rather than as a player who missed
 * three games. So the denominator is games *played*, not weeks elapsed, and a
 * player who has played none reads as an em dash.
 *
 * A line that is present and scores nothing is a real zero and counts: Sleeper
 * carries `gp` and the snap counts for a player who dressed and did nothing, so
 * {@link hasStatLine} keeps him, and one bad game is part of an average in a way
 * that a missed game is not.
 */
export function playerPpg(
  lines: readonly StatLine[],
  scoring: Record<string, number> | null | undefined,
): Ppg | null {
  if (lines.length === 0) return null;

  let points = 0;
  for (const line of lines) points += scoreStatLine(line.stats, scoring);

  const games = lines.length;
  return { average: round(points / games), points: round(points), games };
}

/**
 * Points per game for a whole team, from what it actually put on the board.
 *
 * Deliberately **not** the sum of its players' averages. A team's score is the
 * lineup it set, so a roster carrying three excellent quarterbacks would read as
 * scoring all three of them; what a league records is one number a week, and
 * that is the number worth averaging. It also needs no scoring settings — the
 * league already applied its own when it scored the week.
 *
 * `points` is nullable per week because Sleeper stores a matchup row before the
 * week is played; a null is not a nought, on the same terms as a missing stat
 * line, so it is dropped from both halves of the average rather than counted as
 * a shutout.
 */
export function teamPpg(weeks: readonly { points: number | null }[]): Ppg | null {
  const played = weeks.filter(
    (w): w is { points: number } =>
      typeof w.points === "number" && Number.isFinite(w.points),
  );
  if (played.length === 0) return null;

  const points = played.reduce((sum, w) => sum + w.points, 0);
  return {
    average: round(points / played.length),
    points: round(points),
    games: played.length,
  };
}

/** Two decimals, the precision a fantasy score is quoted at. */
const round = (n: number): number => Math.round(n * 100) / 100;
