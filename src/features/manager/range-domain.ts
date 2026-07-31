import { MONTH_ABBREVIATIONS, shiftDays } from "./adp-controls.ts";
import type { AdpRange } from "./adp-controls.ts";

/**
 * The maths behind the ADP board's range scrubber: what span the strip covers,
 * where a date sits on it, and what a handle position means.
 *
 * Pure and beside `adp-controls` for the reason the filter modules are — the
 * component that renders the strip should be laying out pixels, not deciding
 * what a window means. One rule in here is worth more than the rest and is the
 * reason this isn't inlined: **a handle parked on an edge of the domain is an
 * open bound, not that date**. It is what lets a range stay two independent
 * halves after being dragged, and it is invisible in the component.
 *
 * The `.ts` extension on the import above is the test runner's requirement, the
 * same mechanism `shared/query` is shared by.
 */

/** The span the strip covers, as inclusive `YYYY-MM-DD` bounds. */
export type ScrubDomain = { from: string; to: string };

/** A month on the axis: `YYYY-MM`, and the crawled drafts in it. */
export type MonthBar = { month: string; drafts: number };

/**
 * The strip's span: the first month holding a crawled draft, through the end of
 * the month containing `through`.
 *
 * For a season still being drafted, `through` is today: the right-hand edge is
 * what "now" means to a reader dragging toward it, and a quiet fortnight must
 * not shorten the axis and make an open end unreachable. For a season that is
 * over, today is months or years past the last draft that will ever be counted,
 * and an axis running to it would be mostly blank — {@link densityThrough}
 * decides which. It starts at the data either way, because there is nothing to
 * select before it.
 *
 * With no data at all the domain is the twelve months ending at `through`, so
 * the control still works (the presets and the calendar markers don't need bars).
 */
export function scrubDomain(months: readonly MonthBar[], through: string): ScrubDomain {
  const withDrafts = months.filter((m) => m.drafts > 0).map((m) => m.month);
  const last = monthOf(through);
  const first = withDrafts.length > 0 ? withDrafts.reduce((a, b) => (a < b ? a : b)) : null;
  return {
    from: `${first !== null && first < last ? first : addMonths(last, -11)}-01`,
    to: monthEnd(last),
  };
}

/**
 * Where the strip's right-hand edge belongs: today while drafts for this board
 * are still being run, otherwise the end of the last month that has any.
 *
 * `live` is the caller's question, not this module's — the all-seasons board and
 * the current season are both open-ended, a finished season is not. The
 * fallback when a season has no crawled drafts at all is `today`, which gives
 * the twelve-month empty domain {@link scrubDomain} falls back to rather than an
 * axis of zero width.
 */
export function densityThrough(
  months: readonly MonthBar[],
  today: string,
  live: boolean,
): string {
  if (live) return today;
  const last = months.filter((m) => m.drafts > 0).map((m) => m.month).sort().pop();
  return last === undefined ? today : monthEnd(last);
}

/**
 * Every month on the axis, gaps filled with zeroes. A month Sleeper handed us no
 * drafts for is a real answer — a quiet January — and leaving it out would
 * shorten the axis rather than flatten one bar.
 */
export function monthBars(
  months: readonly MonthBar[],
  domain: ScrubDomain,
): MonthBar[] {
  const counts = new Map(months.map((m) => [m.month, m.drafts]));
  const bars: MonthBar[] = [];
  const last = monthOf(domain.to);
  for (let m = monthOf(domain.from); m <= last; m = addMonths(m, 1)) {
    bars.push({ month: m, drafts: counts.get(m) ?? 0 });
  }
  return bars;
}

/** Where a date sits on the domain, 0–1, clamped to its ends. */
export function fractionOf(domain: ScrubDomain, date: string): number {
  const span = daysBetween(domain.from, domain.to);
  if (span <= 0) return 0;
  return clamp(daysBetween(domain.from, date) / span, 0, 1);
}

/** The date at a fraction of the domain, snapped to a whole day. */
export function dateAtFraction(domain: ScrubDomain, fraction: number): string {
  const span = daysBetween(domain.from, domain.to);
  return shiftDays(domain.from, Math.round(clamp(fraction, 0, 1) * span));
}

/**
 * A range's two ends as concrete dates on the domain — what the handles draw.
 * An open bound becomes the domain's own edge, which is where {@link edgeBounds}
 * reads it back as open again.
 */
export function drawnBounds(
  bounds: { from: string | null; to: string | null },
  domain: ScrubDomain,
): { from: string; to: string } {
  const from = clampDate(bounds.from ?? domain.from, domain);
  const to = clampDate(bounds.to ?? domain.to, domain);
  return from > to ? { from: to, to: from } : { from, to };
}

/**
 * The reverse: two handle positions as a custom range, where a handle on an edge
 * of the domain means that side is unbounded.
 *
 * Reading an edge as open is the whole reason "all time" is reachable by
 * dragging, and it costs nothing in truth: the domain starts at the first
 * crawled draft, so a bound on that day and no bound at all match exactly the
 * same drafts — except that the open one keeps matching as the crawler reaches
 * further back. The right edge is today's month end, so an open end also keeps
 * catching drafts that happen after the page was loaded.
 */
export function edgeBounds(
  from: string,
  to: string,
  domain: ScrubDomain,
): AdpRange {
  return {
    preset: "custom",
    from: from <= domain.from ? null : from,
    to: to >= domain.to ? null : to,
  };
}

/**
 * Slide a window along the axis without changing its length.
 *
 * Dragging the selected block is the half of a brush the scrubber was missing:
 * "the same fortnight, a month earlier" took two handle drags, and the second
 * one had to be measured by eye against the first. The shift is clamped rather
 * than the window being squashed at the edge — a pan that silently shortened
 * the span would answer a different question than the one being dragged.
 */
export function panWindow(
  window: { from: string; to: string },
  deltaDays: number,
  domain: ScrubDomain,
): { from: string; to: string } {
  const shift = clamp(
    deltaDays,
    -daysBetween(domain.from, window.from),
    daysBetween(window.to, domain.to),
  );
  return { from: shiftDays(window.from, shift), to: shiftDays(window.to, shift) };
}

/** A label on the month axis, with the extent it is centred over. */
export type AxisTick = {
  month: string;
  left: number;
  width: number;
  label: string;
  /** January, which reads as the year — the one tick that anchors the rest. */
  year: boolean;
};

/**
 * The axis labels, thinned to what the width can hold.
 *
 * A month gets its name where there is room for one, its initial where there
 * isn't, and nothing at all once even the initials would collide — at which
 * point the January ticks are the axis. That is the same rule at three
 * densities rather than three rules: the domain is however many months have
 * been crawled, so a twelve-month axis and a five-year one are the same
 * control.
 *
 * January always reads as the year instead of a name. It is the only tick that
 * says *which* May a bar is, and a reader scanning for last summer needs the
 * boundary more than the month.
 */
export function axisTicks(bars: readonly MonthBar[], domain: ScrubDomain): AxisTick[] {
  const named = bars.length <= 13;
  const initials = bars.length <= 30;

  return bars.flatMap((bar): AxisTick[] => {
    const month = Number(bar.month.slice(5, 7));
    const january = month === 1;
    if (!january && !initials) return [];
    // A four-digit year is three times the width of the initials around it, so
    // where the months are down to one letter the year gives up two of its own
    // — a tick wider than its month is clipped, and "202" is not a year.
    const label = january
      ? named || !initials
        ? bar.month.slice(0, 4)
        : `’${bar.month.slice(2, 4)}`
      : named
        ? MONTH_ABBREVIATIONS[month - 1]
        : MONTH_ABBREVIATIONS[month - 1].charAt(0);
    return [{ month: bar.month, label, year: january, ...monthExtent(bar.month, domain) }];
  });
}

/** `2026-05-14` → `2026-05`. */
function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** The last day of a `YYYY-MM`, as a full date. */
function monthEnd(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** Shift a `YYYY-MM` by whole months. */
function addMonths(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/**
 * Whole days from `a` to `b`; negative when `b` is earlier. Exported because
 * the scrubber counts in days too — the slider positions its handles read, the
 * span it reports — and two spellings of a date subtraction is one timezone
 * assumption away from disagreeing.
 */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function clampDate(date: string, domain: ScrubDomain): string {
  return date < domain.from ? domain.from : date > domain.to ? domain.to : date;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** The bounds of a `YYYY-MM` on the axis, as fractions of the domain. */
export function monthExtent(
  month: string,
  domain: ScrubDomain,
): { left: number; width: number } {
  const left = fractionOf(domain, `${month}-01`);
  // The bar runs to the start of the next month, so adjacent months meet with
  // no seam — ending it on its own last day would leave a day-wide gap.
  const right = fractionOf(domain, `${addMonths(month, 1)}-01`);
  return { left, width: Math.max(0, right - left) };
}
