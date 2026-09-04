/**
 * The rank ramp: a place in a field, as a colour.
 *
 * It lived in `features/manager/helpers/lineup-metrics.ts` until the lineup
 * checker's projected-outcome pip needed the same green and the same red — the
 * line that moves a client piece into `features/shared`, the one `CONSOLE_KEY`
 * and `ManagerPlate` moved on. A second red drawn beside this one would be two
 * greens for "good" on two pages showing the same leagues, and only one of them
 * would invert correctly for light mode.
 *
 * `lineup-metrics.ts` re-exports it, so its own readers and its test did not
 * move with it.
 */

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
