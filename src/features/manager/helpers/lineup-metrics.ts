import type { LineupMetricId, MetricRank } from "@/shared/contract";

// Relative with an explicit extension: this module is read by Node's test
// runner, which resolves neither the `@/*` aliases nor the shared barrel.
import { ordinal } from "../../shared/format.ts";

/**
 * Words for the rank metrics — the card's column headers and the dialog's
 * option lines. Imports from the contract are type-only, so this module (like
 * `ndjson.ts` beside it) resolves under Node's test runner as well as the
 * bundler.
 */
export const LINEUP_METRIC_LABELS: Record<
  LineupMetricId,
  { column: string; option: string }
> = {
  ros_starters: {
    column: "ROS starters",
    option: "Projected points — starters (rest of season)",
  },
  ros_bench: {
    column: "ROS bench",
    option: "Projected points — bench (rest of season)",
  },
  capital_total: {
    column: "Capital",
    option: "Draft capital — whole roster",
  },
  capital_bench: {
    column: "Bench capital",
    option: "Draft capital — bench only",
  },
  capital_starters: {
    column: "Starter capital",
    option: "Draft capital — starters only",
  },
};

/**
 * A rank cell's text. The em dash covers both "no answer yet" (the payload
 * has not landed) and "nothing to rank" (the metric was degenerate
 * league-wide) — the reader's next move is the same either way.
 */
export function formatRank(rank: MetricRank | null): string {
  if (!rank) return "—";
  return `${ordinal(rank.rank)} of ${rank.of}`;
}

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
