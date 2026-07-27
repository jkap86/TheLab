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
