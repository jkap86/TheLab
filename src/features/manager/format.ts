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
