/**
 * The maths behind the ADP board's density displays — the resting sparkline
 * and the lookback panel's channel: what span they cover, where a month's bar
 * sits on it, and where a date falls as a fraction of it.
 *
 * Pure and beside `adp-controls` for the reason the filter modules are — the
 * component that renders a strip should be laying out pixels, not deciding
 * what a span means. It used to carry the range *scrubber's* gesture maths too
 * (handle proximity, panning, sweep targets); the counter that replaced the
 * scrubber asks for none of that, so what is left is the domain and the bars,
 * which both remaining readers draw through the same functions so they cannot
 * disagree about where a month sits. Its counterpart for what a window *means*
 * is `lookback.ts`.
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
 * `lookback` counts in days too — the lens's whole subject — and two spellings
 * of a date subtraction is one timezone assumption away from disagreeing.
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
