/**
 * The facing gauge under a gametime card's two figures: how far each side's
 * bar runs, and where the league's median sits across both.
 *
 * Pure and under Node's own runner, for `seat-compare.ts`'s reason — a bar
 * drawn against the wrong denominator renders perfectly and says something
 * untrue, which is the one failure a page of live scores cannot have. The card
 * itself only positions what this answers.
 *
 * **One scale for both sides, and that is the whole of it.** Two bars each
 * normalised to their own side's projection would both run nearly full and the
 * pair would say nothing about who is ahead; against one scale a reader can see
 * the lead in the gap between the two fills. The median is in that scale rather
 * than measured against it, so a league whose middle is on course to beat both
 * sides still puts its tick inside the track.
 */

/** One side's two fills, as percentages of the row's shared scale. */
export type GaugeSide = {
  /** The side's live projection — the wash the bar is heading toward. */
  ghost: number;
  /** What it has actually scored. */
  live: number;
};

export type MatchupGauge = {
  mine: GaugeSide;
  theirs: GaugeSide;
  /** Where the median's live projection falls, or null where there is none. */
  median: number | null;
};

/**
 * The headroom that keeps the leading bar off the track's outer edge. A fill
 * that reached the end would read as a gauge pinned at its limit rather than as
 * the larger of two figures.
 */
const HEADROOM = 1.05;

type Figures = { scored: number; live: number };

export function matchupGauge(
  mine: Figures,
  theirs: Figures,
  median: Figures | null,
): MatchupGauge {
  const max = Math.max(mine.live, theirs.live, median?.live ?? 0) * HEADROOM;
  // A week nobody has projected — an empty roster, a feed that answered
  // nothing — has no scale, and a division by it would put `NaN%` on every
  // bar. Empty is the honest reading and it is what a zero would draw anyway.
  const share = (value: number) => (max > 0 ? clamp((value / max) * 100) : 0);
  return {
    mine: { ghost: share(mine.live), live: share(mine.scored) },
    theirs: { ghost: share(theirs.live), live: share(theirs.scored) },
    // **A bar with no scale draws empty; a tick with no scale is not drawn at
    // all**, which is `rankPercentile`'s own rule one grain down: an empty bar
    // is the honest reading of a week nothing has been projected for, where a
    // tick is a *position*, and one parked at the inner edge claims the median
    // sits there. Rendered, that is two amber marks floating at the centre
    // gutter of a card with no bars on it.
    median: median === null || max <= 0 ? null : share(median.live),
  };
}

/**
 * **Fantasy scoring goes negative**, which is why this is here rather than left
 * to CSS: a lineup that has scored below zero is a real Sunday-morning reading,
 * and a negative width is one the browser clamps silently while the *scale* it
 * came from could still be negative and flip every bar on the row.
 */
function clamp(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}
