/**
 * Formatting shared by more than one tool. Most of it isn't: the manager
 * feature's `format.ts` still owns the records, points and week horizons only
 * that tool renders. What lands here is what a second tool needed — the trades
 * page names a pick's round the same way the roster panel does, and a round
 * spelled two ways in one app is the drift this file exists to stop.
 *
 * `format.ts` re-exports what moves here so its own consumers keep their import.
 */

/**
 * A number as an ordinal, e.g. `1` → `"1st"`, `2` → `"2nd"`, `13` → `"13th"`.
 *
 * How draft picks are spoken about — "a 2026 1st", "their 3rd" — so it labels a
 * pick's round that way rather than as a bare number.
 */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
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
