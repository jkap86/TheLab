/**
 * The date vocabulary the app's two date-range controls share: the ADP drawer's
 * window over crawled drafts, and the trades page's window over completed
 * trades.
 *
 * They are different populations chosen against different things — the ADP one
 * is a lookback counter over a density readout, the trades one a row of presets
 * — but "what day is it", "shift a `YYYY-MM-DD` by days" and "write a date out"
 * are the same questions in both, and two copies of a month table is exactly the
 * drift the `shared/query` primitives were consolidated to stop. It lives here rather than
 * in either feature for that reason; `adp-controls` re-exports what its own
 * consumers already import from it.
 *
 * Every function is pure and takes the date it works from, so a control's output
 * changes when the *date* does rather than on every render — and so both ends
 * stay testable without a clock.
 */

/** Today where the reader is, as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * How long until {@link todayIso} answers something else, where the reader is.
 *
 * The pair to it: that one reads the day, this one says when it turns over. A
 * relative window ("last 30 days") is resolved against a date, so a tab left open
 * overnight goes on asking about yesterday until something re-renders it — see
 * {@link useTodayIso}, which is the one caller and exists for that.
 *
 * Local rather than UTC, because it is the local day being watched, and built
 * from the calendar fields rather than by adding 86,400,000ms: a day is 23 or 25
 * hours long either side of a daylight-saving change, and the `Date` constructor
 * is what knows which. It is always positive — the next local midnight is by
 * construction after any instant on the day before it.
 */
export function msUntilNextLocalMidnight(now: Date = new Date()): number {
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0,
  );
  return next.getTime() - now.getTime();
}

/** Shift a `YYYY-MM-DD` by whole days, in UTC so no zone can move the boundary. */
export function shiftDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Shift by whole months, keeping the day of the month where one exists. Day 31
 * has no counterpart in a 30-day month, so the result is clamped to that month's
 * last day rather than rolling into the next one — a "last 12 months" window
 * starting on the 1st of the wrong month is a whole month of data.
 */
export function shiftMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Spelled out rather than left to `Intl`, so a date reads the same in every
 * locale the app is opened in — one month table behind every label the range
 * controls write, not several that could disagree.
 */
export const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** `2026-06-01` → `Jun 1, 2026`. */
export function formatRangeDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${MONTH_ABBREVIATIONS[Number(month) - 1]} ${Number(day)}, ${year}`;
}

/** `2026-06` → `Jun 2026`. What a bar on the ADP window's channel is. */
export function formatRangeMonth(month: string): string {
  return `${MONTH_ABBREVIATIONS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}
