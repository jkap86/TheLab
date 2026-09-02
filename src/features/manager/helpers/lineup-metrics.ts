import type { LineupMetricId, MetricRank } from "@/shared/contract";

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
 * Which metrics read as *points* and which read as *capital*.
 *
 * The console gives the two families different colours — accent cyan for the
 * projection metrics, `--color-metric-secondary` (the chrome band's mid-stop)
 * for the capital ones — so a reader can tell at a glance which unit a tile is
 * in without reading its label. Exhaustive by construction, like every other
 * `Record<LineupMetricId, …>` on this side of the seam.
 */
const METRIC_FAMILY: Record<LineupMetricId, "points" | "capital"> = {
  ros_starters: "points",
  ros_bench: "points",
  capital_total: "capital",
  capital_bench: "capital",
  capital_starters: "capital",
};

/** The Tailwind text colour a metric's figure is drawn in. */
export function metricToneClass(id: LineupMetricId): string {
  return METRIC_FAMILY[id] === "points"
    ? "text-active"
    : "text-metric-secondary";
}

/** The same tone as a background, for the tile's meter fill. */
export function metricFillClass(id: LineupMetricId): string {
  return METRIC_FAMILY[id] === "points"
    ? "bg-active"
    : "bg-metric-secondary";
}

/** `1st`, `2nd`, `3rd`, `4th` — with the 11th–13th rule English insists on. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

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
