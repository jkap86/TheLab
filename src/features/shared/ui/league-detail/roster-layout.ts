/**
 * The grid a roster section's rows and its column headings share.
 *
 * One template for both, so the headings stay over their numbers — a header laid
 * out separately drifts the moment a width changes. `RosterSection` renders the
 * headings from `columns` and `PlayerRow` lays its cells on `grid`, which is why
 * the two live in `roster-detail` and `player-row` but the contract between
 * them lives here.
 *
 * **The row has two shapes, and which one it takes is the only thing that
 * changes with width.** Below `@3xl` it is two lines: the name owns the first
 * one and the position, the NFL team and the numbers sit under it. From `@3xl`
 * it is one line: a lane holding the lineup slot, then the name, then the
 * numbers beside it. Both shapes are the same cells in the same DOM order —
 * what moves is `--cols`, whether the meta cell is drawn, and whether the slot
 * chip is in flow (see `PlayerRow`).
 *
 * Two lines exist because at a phone's width the name loses every fight for
 * horizontal space: squeezed between a slot mark and two totals, "Christian
 * McCaffrey" truncates inside a panel rendering at half a card's width. One line
 * exists because above `@3xl` it doesn't have to — and a 40-man roster at two
 * lines is ~1,960px of scrolling beside a twelve-team table.
 *
 * Which metric the two number columns show is a separate choice, held above the
 * panel and rendered by {@link ColumnRail}; this only fixes their *count* and
 * width. Both templates therefore carry exactly two number tracks, and
 * `NO_NUMBERS` carries none for a league with nothing to price.
 */
export type SectionLayout = {
  /** Column template: the shape's own tracks, at every tier. */
  grid: string;
  /** How far the name reaches — everything on its line, in whichever shape. */
  nameSpan: string;
  /**
   * The recessed lane the two number columns run down, or null where there are
   * no numbers to run down it. Drawn once per section rather than once per row
   * (see `.lab-lane`), so this is the width of both tracks plus the gap between
   * them and nothing else — the section positions it.
   */
  lane: string | null;
};

// Written out rather than assembled, so Tailwind sees every class string whole.
/**
 * A league with no projections, no KTC and no ADP: the name and nothing else.
 *
 * It still carries the slot lane from `@3xl`, because the shape switch is about
 * the row rather than about the numbers — a starters list with no numbers on it
 * is still a list of slots.
 */
export const NO_NUMBERS: SectionLayout = {
  grid: "grid-cols-[minmax(0,1fr)] @3xl:grid-cols-[2.125rem_minmax(0,1fr)]",
  nameSpan: "col-span-1",
  lane: null,
};

/**
 * **Every track here is measured in the face the app actually renders**, which
 * is Geist as of the `--font-sans` registration in `globals.css` and was Arial
 * before it. That is not a footnote: the widths below were re-taken in a real
 * browser rather than carried over, and one of them had to move.
 *
 * What sizes a value track is the **wider of the heading and the number**, and
 * on this half it is always the number — the rail drops to sentence case at the
 * narrow tiers (see `ColumnRail`), where `Bench` is 28px against `1,041.16`'s
 * 44.8px. The eight-character season total in a high-scoring league is the
 * string every track is cut for:
 *
 * | tier | size | `1,041.16` | track | slack |
 * | --- | --- | --- | --- | --- |
 * | base | `0.7rem` (11.2px) | 44.8px | `2.875rem` = 46px | 1.2px |
 * | `@lg` | `0.75rem` (12px) | 48.0px | `3.25rem` = 52px | 4.0px |
 * | `@3xl` | `0.8125rem` (13px) | 45.5px | `3.5rem` = 56px | 10.5px |
 *
 * The base tier's `2.875rem` is the one that moved, and Geist is why it could:
 * the numbers step up from `0.65rem` to `0.7rem` there — the space the position
 * badge used to occupy on that line, handed to the figures — and 44.8px does not
 * fit the `2.75rem` this used to carry. Geist's tabular figures are *narrower*
 * than Arial's at equal size (36.4px against 40.5px for that string), so every
 * other track on this half gained slack rather than losing it.
 *
 * **Fixed tracks and not `auto`, which is the trap the grid has to keep
 * avoiding.** Each row and each section heading is its own grid container, so an
 * intrinsic track is measured per row: one row holding `1,041.16` would set its
 * columns wider than the row above it, and the two sections' numbers would not
 * line up. Same reason the standings can't use one either.
 *
 * **The slot lane is `2.125rem` and it is sized by the widest label, not the
 * widest slot.** `FLEX` and `SFLX` are 23px at the chip's 9px monospace with its
 * tracking, plus the chip's own 8px of padding — 31px against 34px. A label
 * added to `SLOT_LABEL` past four characters wants this re-measured, because
 * what truncates is the *marker*, and a clipped marker reads as broken where a
 * clipped name only reads as long.
 *
 * **The tiers are the panel's container, not the viewport, and the shape switch
 * is at `@3xl` rather than at the `@2xl` it reads as wanting.** That is the
 * non-monotonicity this panel keeps having to be swept for: a tier that adds a
 * *cell* takes back more width than it gained, so the name is not monotonic in
 * the panel's width. Measured in the browser, one line leaves the name 121px at
 * a 690px panel and 168px at an 800px one, against the 198px the two-line shape
 * already gives it at 520px — so switching at `@2xl` would truncate
 * `Christian McCaffrey` (126.6px at `text-sm`) in the tier immediately above the
 * one that had just started showing it whole. `@3xl` is the first tier where one
 * line is not a step backwards for the field a reader is actually scanning.
 *
 * The knock-on is that the *contraction* threshold stays at `@lg` and is
 * deliberately not moved to meet this one: between `@lg` and `@3xl` the name
 * owns its whole line and has room for the full spelling, and re-contracting it
 * at `@3xl` to buy back width would be a third crossing of the same axis.
 */
export const SPLIT_LAYOUT: SectionLayout = {
  grid:
    "grid-cols-[minmax(0,1fr)_2.875rem_2.875rem] " +
    "@lg:grid-cols-[minmax(0,1fr)_3.25rem_3.25rem] " +
    "@3xl:grid-cols-[2.125rem_minmax(0,1fr)_3.5rem_3.5rem]",
  // Two lines: the name spans the row. One line: the name is one cell of it,
  // between the slot lane and the numbers.
  nameSpan: "col-span-3 @3xl:col-span-1",
  // Both tracks plus the `gap-x-2` between them.
  lane: "w-[7.5rem]",
};
