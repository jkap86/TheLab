import { rangeBounds } from "./adp-controls.ts";
import type { AdpRange } from "./adp-controls.ts";
import { shiftDays } from "./date-range.ts";
import { nflMarkersIn } from "./nfl-calendar.ts";
import { daysBetween } from "./range-domain.ts";
import type { ScrubDomain } from "./range-domain.ts";

/**
 * The counter's two fields ⇄ the stored range: the maths behind the ADP
 * board's window control, the way `range-domain` is the maths behind its
 * density strip.
 *
 * The window is a sentence — *last N days, ending on a date that defaults to
 * today* — and this module is the translation between that sentence and the
 * {@link AdpRange} everything else already speaks. Pure and tested for the
 * reason its neighbours are: the component that renders the lenses should be
 * laying out pixels, not deciding what a window means.
 *
 * One rule in here is worth more than the rest: **which storage a write lands
 * in depends on the end date, because "ending today" is a different claim from
 * "ending on the 5th".** A window that ends today is *relative* — it is stored
 * as a preset (`30d`, `90d`, or the general `lookback`) and rolls forward with
 * the calendar, exactly as "Last 30 days" always has. A hand-set end date
 * freezes it into a `custom` range, because a reader who named a day meant that
 * day. The lens shows the same two values either way; what differs is what they
 * mean tomorrow.
 *
 * The `.ts` extensions on the imports are the test runner's requirement, the
 * same mechanism every pure module here shares.
 */

/** The stored range read as the counter's fields. */
export type LookbackView = {
  /** Days back from `end` to the window's start; null when the start is open. */
  days: number | null;
  /** The window's end as a calendar date — today when the end is open. */
  end: string;
  /** The end is open: the window rolls forward, and the Today key is lit. */
  endsToday: boolean;
};

/**
 * Read the stored range as the two lenses. Every range the store can hold has
 * a reading — a `12m` preset is ~365 days back, a half-open `custom` shows the
 * end it has — so the counter never opens on fields it can't explain.
 */
export function lookbackView(range: AdpRange, today: string): LookbackView {
  const { from, to } = rangeBounds(range, today);
  const end = to ?? today;
  return {
    // A `from` past the end would be a malformed range, not a negative window;
    // clamping keeps the lens from rendering a minus sign over it.
    days: from === null ? null : Math.max(0, daysBetween(from, end)),
    end,
    endsToday: to === null,
  };
}

/**
 * Write the fields back as a stored range.
 *
 * Ending today (or later — a caller clamps, but a clock can disagree by a
 * midnight) stays relative: no days is the whole season, 30 and 90 land on the
 * *named* presets so the resting line's chips light exactly, and any other
 * count is a `lookback`. An earlier end freezes the window into `custom`, with
 * no days meaning "through the end" — a half-open historical cut.
 */
export function lookbackRange(days: number | null, end: string, today: string): AdpRange {
  if (end >= today) {
    if (days === null) return { preset: "all", from: null, to: null };
    if (days === 30) return { preset: "30d", from: null, to: null };
    if (days === 90) return { preset: "90d", from: null, to: null };
    return { preset: "lookback", from: null, to: null, days };
  }
  return {
    preset: "custom",
    from: days === null ? null : shiftDays(end, -days),
    to: end,
  };
}

/**
 * The range the ◆ draft key writes: **pinned at the draft**, not a day count.
 *
 * The key computes days-since-the-draft for the lens, but storing that count
 * would make the window drift — a relative window's start moves with today,
 * and "since the draft" means the draft, tomorrow included. So it writes a
 * `custom` range anchored on the date, keeping the end exactly as it was:
 * open for a board ending today, the frozen date for a historical cut.
 */
export function sinceDraftRange(draftDate: string, view: LookbackView): AdpRange {
  return {
    preset: "custom",
    from: draftDate,
    to: view.endsToday ? null : view.end,
  };
}

/** The draft the ◆ key anchors on, resolved from the calendar table. */
export type DraftAnchor = {
  /** Round one's date, `YYYY-MM-DD`. */
  date: string;
  /** The table's own label — names the season, and `(projected)` when derived. */
  label: string;
};

/**
 * The NFL draft the key means on this board: the latest one inside the strip's
 * domain that isn't after the window's end.
 *
 * "Since the draft" is the one cut no typed number can carry — the date moves
 * every April, which is why the old strip flew a flag for it — and on the
 * all-seasons board there are several. The latest at-or-before `end` is the one
 * a reader ending a window *there* means; a domain holding none (a season with
 * no April in it yet) returns null and the key simply isn't drawn.
 */
export function draftAnchor(domain: ScrubDomain, end: string): DraftAnchor | null {
  const drafts = nflMarkersIn(domain.from, domain.to).filter(
    (m) => m.kind === "draft" && m.from <= end,
  );
  const latest = drafts[drafts.length - 1];
  return latest === undefined ? null : { date: latest.from, label: latest.label };
}
