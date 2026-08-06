/**
 * Formatting shared by more than one tool. Most of it isn't: the manager
 * feature's `format.ts` still owns the points and week horizons only that tool
 * renders. What lands here is what a second tool needed — the trades page names
 * a pick's round the same way the roster panel does, and a round spelled two
 * ways in one app is the drift this file exists to stop.
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

/**
 * The five below came here with the manager plate, when the lineup checker
 * started wearing the same card for a *projected* week's record — four of them
 * are what that plate is written in, and `formatPoints` is what its list's own
 * bench-gap column prints. The plate itself is `ui/manager-header`.
 */

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
  return countdownSegments(msLeft)
    .map((segment) => `${segment.value}${segment.short}`)
    .join(" ");
}

/** One unit of a countdown, as its own readout cell. */
export type CountdownSegment = {
  /** The digits, zero-padded except in the leading cell. */
  value: string;
  /** The unit under the digits, e.g. `"days"`. */
  unit: string;
  /** The same unit as the single letter {@link formatCountdown} writes. */
  short: string;
};

/**
 * The same countdown split into its units, for a readout that gives each one a
 * cell of its own rather than a run of text.
 *
 * It is the primitive and {@link formatCountdown} is the join of it, so the
 * segmented display and the string a screen reader is handed can't disagree
 * about how long is left — the two are one calculation. The dropping and the
 * padding are that function's rules verbatim: units the countdown has outgrown
 * fall off the left as they empty, and everything after the leading unit is
 * padded so the cells tick in place rather than reflowing.
 */
export function countdownSegments(msLeft: number): CountdownSegment[] {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const all = [
    { value: Math.floor(total / 86_400), unit: "days", short: "d" },
    { value: Math.floor((total % 86_400) / 3_600), unit: "hrs", short: "h" },
    { value: Math.floor((total % 3_600) / 60), unit: "min", short: "m" },
    { value: total % 60, unit: "sec", short: "s" },
  ];

  // Everything from the first non-zero unit onward; seconds alone when the whole
  // countdown is under a minute.
  const lead = all.findIndex((segment) => segment.value > 0);
  const shown = all.slice(lead === -1 ? all.length - 1 : lead);

  return shown.map((segment, index) => ({
    ...segment,
    value: index === 0 ? String(segment.value) : String(segment.value).padStart(2, "0"),
  }));
}
