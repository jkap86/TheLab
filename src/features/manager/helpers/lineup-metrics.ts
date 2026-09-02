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
