type Record_ = { wins: number; losses: number; ties: number };

/**
 * A win-loss record, e.g. `"9-4"` or `"9-4-1"`.
 *
 * Ties are omitted when there are none, since most leagues never tie and a
 * trailing `-0` is noise.
 */
export function formatRecord(record: Record_): string {
  const { wins, losses, ties } = record;
  return `${wins}-${losses}${ties ? `-${ties}` : ""}`;
}

/**
 * A win percentage the way a standings page writes one: `.537`, `1.000`, and an
 * em dash where nothing has been played.
 *
 * Three decimals with the leading zero dropped is the convention every sport
 * uses for this number, and it keeps the string four characters wide so it
 * doesn't reflow the gauge it sits inside. Null is the {@link aggregateRecord}
 * no-games case, not a formatting failure — see the rule there.
 */
export function formatWinPct(pct: number | null): string {
  if (pct === null) return "—";
  return pct.toFixed(3).replace(/^0\./, ".");
}

/**
 * Time remaining as a countdown, e.g. `"37d 04h 12m 45s"`, `"4h 09m 00s"`,
 * `"12m 03s"`, `"41s"`.
 *
 * Units the countdown has outgrown drop off the left as they empty — weeks out
 * it reads in days, on game day in hours — while everything after the leading
 * unit is zero-padded so the string ticks in place rather than reflowing.
 * Never negative: an instant already passed clamps to `"0s"`, though callers
 * generally hide the timer before that.
 */
export function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (days > 0)
    return `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

/**
 * Fantasy points to two decimals with locale grouping, e.g. `"1,234.56"`.
 * Always two, because a column of points that changes width row to row is
 * hard to scan.
 */
export function formatPoints(points: number): string {
  return points.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * A KeepTradeCut value with locale grouping and no decimals, e.g. `"41,320"`.
 *
 * The opposite convention to {@link formatPoints}, and deliberately: KTC's
 * numbers are whole and four digits wide, so a decimal place would be two
 * characters of noise on a chip already carrying three totals.
 */
export function formatValue(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// `ordinal` moved to `features/shared/format.ts` when the trades page needed the
// same words for a pick's round; it is re-exported here so this module's own
// consumers keep reading it from where they always have.
export { ordinal } from "../shared/format.ts";

/** `3 weeks`, or `1 week` — for tooltips, where the count is spelled out. */
export function weekCount(n: number): string {
  return `${n} week${n === 1 ? "" : "s"}`;
}

/**
 * The week horizon a projection covers, e.g. `"Wk 3–5"`, `"Wk 3"`, `"Wk 3, 5"`.
 *
 * Worth the few lines because the horizon is not what a reader assumes: the sync
 * keeps a short window of weeks warm, so a "rest of season" total is usually two
 * weeks deep. Every projected number is shown next to this rather than left to
 * imply a full season.
 *
 * Runs of consecutive weeks collapse to a range; gaps (an unsynced week between
 * two synced ones) stay visible as separate entries, since that is a hole in the
 * total rather than a shorter horizon.
 */
export function formatWeekRange(weeks: readonly number[]): string {
  if (weeks.length === 0) return "no weeks";

  const sorted = [...weeks].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const week of sorted) {
    const run = runs.at(-1);
    if (run && week === run[1] + 1) run[1] = week;
    else runs.push([week, week]);
  }

  return `Wk ${runs
    .map(([from, to]) => (from === to ? `${from}` : `${from}–${to}`))
    .join(", ")}`;
}
