import { BubblingFlask, WeekGauge } from "@/features/shared";

import {
  formatProjectedRecord,
  formatProjectedWinPct,
  type WeekSummary as Summary,
} from "../helpers/week-summary";

/**
 * The week's figures, milled into the identity billet: the projected record and
 * how many lineups want a press, and a mounted gauge for the win rate the record
 * implies.
 *
 * The part is `WeekGauge`, shared with the gametime page since it draws the
 * same gauge over a live record — this file is the checker's words and its
 * second count. The rules the count carries survive whole: it is `—` until the
 * check lands (a zero would read as "all clear" for the length of a round
 * trip), it is `--error` above zero and the billet's own figure ink at zero,
 * the `aria-live` that announces the answer rides the figure, and its
 * denominator is the leagues *on screen* the check answered for. The spelling
 * is `3 / 12` rather than `3 of 12` because it stands in a well of ratios, and
 * the `title` carries the sentence.
 *
 * **Leagues with no opponent are already gone** — `weekSummary` drops them
 * rather than counting a future week as a loss — so a week with nothing
 * projected draws an empty track and an em dash, never `0.0%`.
 */
export function WeekSummary({
  summary,
  attention,
  of,
  pending,
}: {
  summary: Summary;
  /** How many of the leagues on screen want a press — over leagues, not reasons. */
  attention: number;
  /** The leagues on screen the check answered for. */
  of: number;
  /** True until the check lands. */
  pending: boolean;
}) {
  const lit = !pending && attention > 0;

  return (
    <WeekGauge
      record={formatProjectedRecord(summary)}
      winPct={summary.winPct}
      pct={formatProjectedWinPct(summary)}
      recordLabel="Proj rec"
      winLabel="Proj win"
      pending={pending}
      pendingLabel="Checking"
      count={{
        label: "Need a look",
        tone: lit ? "var(--error)" : undefined,
        live: true,
        // The figure is a drawn object while the check runs, and the bay is
        // aligned on a baseline it does not have — see `StampedCount`.
        centred: pending,
        title: pending
          ? undefined
          : `${attention} of ${of} league${of === 1 ? "" : "s"} checked need a look`,
        // 24px: this bay is a label and a figure on one line, and the flask
        // stands in for the figure rather than beside it.
        value: pending ? <BubblingFlask size={24} label="Checking" /> : `${attention} / ${of}`,
      }}
    />
  );
}
