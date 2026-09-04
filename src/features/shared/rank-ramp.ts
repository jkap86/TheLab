/**
 * A place in a field: how full its meter is, what percentile colours it, where
 * a figure places among others, and the ramp that turns any of them into a
 * colour.
 *
 * The ramp lived in `features/manager/helpers/lineup-metrics.ts` until the
 * lineup checker's projected-outcome pip needed the same green and the same
 * red — the line that moves a client piece into `features/shared`, the one
 * `CONSOLE_KEY` and `ManagerPlate` moved on. A second red drawn beside this one
 * would be two greens for "good" on two pages showing the same leagues, and
 * only one of them would invert correctly for light mode.
 *
 * The three readings below followed it when `LeagueTeams` did, for the reason a
 * module in this folder cannot import one from `features/manager`: the
 * standings pane draws its own meters and colours its own totals, and it is a
 * sibling feature's to read now rather than the manager page's alone. They stay
 * in one module with the ramp because {@link rankFill} and {@link rankColor}
 * must be fed the same number — split across two files is how the bar and the
 * hue would come to disagree.
 *
 * `lineup-metrics.ts` re-exports all four, so its own readers and its test did
 * not move with them — which is also why the file keeps its name.
 */

import type { MetricRank } from "@/shared/contract";

/**
 * How full a tile's meter is: 100% for 1st, 0% for last.
 *
 * **`of - 1` is the divisor, not `of`.** A meter that ran `rank / of` would
 * leave 1st of 12 sitting at 92% and last of 12 at 8%, so neither end of the
 * scale would ever be reached and the bar would read as a broken gauge rather
 * than as a position. A one-roster league (`of === 1`) has no spread to show
 * and draws empty, as does a null rank.
 */
export function rankFill(rank: MetricRank | null): number {
  if (!rank || rank.of <= 1) return 0;
  return Math.round((1 - (rank.rank - 1) / (rank.of - 1)) * 100);
}

/**
 * The percentile a rank's *colour* is taken from, or null where there is no
 * position to colour.
 *
 * It exists because {@link rankFill} answers 0 to two different questions.
 * Last of twelve is 0 and so is "nothing to rank" — a null rank, or a
 * one-roster league with no spread — and the meter is right to draw both
 * empty. The ramp is not: painting an absent answer in full red claims a
 * result the page has not been given. So the degenerate cases come back as
 * null here and land on the neutral, and only a real last place is red.
 */
export function rankPercentile(rank: MetricRank | null): number | null {
  if (!rank || rank.of <= 1) return null;
  return rankFill(rank);
}

/**
 * A rank, as a colour on a red -> neutral -> green ramp.
 *
 * **A rank's colour is its percentile, not its ordinal**: 1st of 12 and 1st of
 * 8 are different achievements, and the figure beside it already says which.
 * The number fed in is therefore the same one the meter's width is taken from
 * ({@link rankFill}), so the bar and the hue can never disagree.
 *
 * Chroma rides distance from mid-pack rather than the rank itself, which is
 * what keeps the scale honest: a middling rank lands on the theme's neutral
 * and only a real result earns any colour at all. The hue only picks the side.
 *
 * The lightness and chroma bounds are tokens because the same ramp runs on two
 * very different glasses — near-white on the dark readout, dark grey on the
 * light one — and only the endpoints differ. That is also why this returns a
 * computed string rather than a Tailwind class: the value is continuous, so it
 * goes through `style`, and there is no utility to generate.
 *
 * This replaced the metric-*family* colouring (`metricToneClass` /
 * `metricFillClass`, accent for points and `--metric-secondary` for capital).
 * A tile has one colour to spend and it now spends it on the rank; the unit is
 * read off the label above the figure.
 *
 * @param fill 0–100 from {@link rankPercentile}, or null for mid-pack neutral.
 * @param alpha Optional opacity, for the meter's glow.
 */
export function rankColor(fill: number | null, alpha?: number): string {
  const p = fill === null ? 0.5 : Math.max(0, Math.min(1, fill / 100));
  // 0 at the median, 1 at either end.
  const t = Math.abs(p - 0.5) * 2;
  const hue = p < 0.5 ? 25 : 150;
  const l = `calc(var(--rank-l-mid) + (var(--rank-l) - var(--rank-l-mid)) * ${t})`;
  const c = `calc(var(--rank-c) * ${t})`;
  return `oklch(${l} ${c} ${hue}${alpha === undefined ? "" : ` / ${alpha}`})`;
}

/**
 * Where one figure sits among the league's, as a rank the meters and the ramp
 * above can read.
 *
 * The server ranks the nine metrics a card's tiles show; this is the same
 * reading taken client-side for a figure it does not rank — today the bench
 * total under whichever lens the expanded card is on, which changes with a
 * control rather than with the payload. It is **standard competition ranking**,
 * the same rule `MetricRank` documents: tied figures share the better rank and
 * the next distinct one skips.
 *
 * Null where there is nothing to rank, which is two cases and not one: a field
 * of fewer than two, and a field where every figure is zero — a league with no
 * projections read, or one whose KeepTradeCut board could not be. "1st of 12"
 * among all-zero totals is a claim, which is exactly why `LineupRanks` ships
 * null for it rather than a rank.
 */
export function placeAmong(
  value: number,
  all: readonly number[],
): MetricRank | null {
  if (all.length <= 1 || all.every((figure) => figure === 0)) return null;
  return { rank: all.filter((figure) => figure > value).length + 1, of: all.length };
}
