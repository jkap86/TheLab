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
 * changes with width.** Below `@3xl` it is two lines: the name, his position
 * and his NFL team own the first one and the numbers sit under it. From `@3xl`
 * it is one line: a lane holding the lineup slot, then that same name group,
 * then the numbers beside it. Both shapes are the same cells in the same DOM
 * order — what moves is `--cols`, where the first number starts, and whether
 * the slot chip is in flow (see `PlayerRow`).
 *
 * Two lines exist because at a phone's width the name loses every fight for
 * horizontal space: squeezed between a slot mark and two totals, "Christian
 * McCaffrey" truncates inside a panel rendering at half a card's width. One line
 * exists because above `@3xl` it doesn't have to — and a 40-man roster at two
 * lines is ~1,960px of scrolling beside a twelve-team table.
 *
 * Which metric each number column shows is a separate choice, held above the
 * panel and rendered by {@link ColumnRail}; this only fixes their *width* and
 * lays out however many there are. **How many there are is the selection's**: a
 * panel opened on a season carries two and one opened on a week carries one (see
 * `DEFAULT_WEEK_PLAYER_COLUMNS`), so {@link sectionLayout} picks the template off
 * the count — {@link SPLIT_LAYOUT} for two, {@link ONE_NUMBER} for one, and
 * {@link NO_NUMBERS} for a league with nothing to price.
 */
export type SectionLayout = {
  /** Column template: the shape's own tracks, at every tier. */
  grid: string;
  /** How far the name reaches — everything on its line, in whichever shape. */
  nameSpan: string;
  /**
   * Where the first value column starts in the two-line shape, and nothing at
   * all from `@3xl`.
   *
   * The name spans the whole first line down there, so the numbers auto-place
   * onto the second — and they used to land in the second and third tracks only
   * because a meta cell holding the position and the NFL team occupied the
   * first. With those moved up beside the name there is nothing holding it, so
   * the first number would slide under the name and stop lining up with the
   * heading that names it (see {@link ColumnRail}, whose own leading spacer is
   * what it lines up against). One explicit start is cheaper than a spacer
   * element, and it belongs here rather than in `PlayerRow` because which track
   * that is, is a fact about the template above.
   */
  statStart: string;
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
  // Nothing to place: this layout is paired with an empty column list, so no
  // row using it draws a value cell at all.
  statStart: "",
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
 * **The name shares its line with the position and the NFL team now, and what
 * that costs is stated here rather than discovered later.** Measured in a
 * headless browser against the compiled stylesheet and the real `woff2` files,
 * the pair plus its two gaps is 40px for `RB SF`, 47px for `LB CLE` and 57px
 * for the widest thing a roster can hold, `DEF WAS` — all of it `shrink-0`, so
 * every pixel comes out of the name. At `@3xl` exactly, where the shape has
 * just switched and the half is ~358px, that leaves the name 95–112px against
 * the 135.6px `Christian McCaffrey` renders at, so the longest real names
 * truncate in a band just above the switch and are whole again from a ~850px
 * panel. That is a real regression on one tier and it is the price of
 * the row saying what every player *is*: those two facts used to be drawn only
 * on the two-line shape and only where the chip disagreed with the position, so
 * at most widths, on most rows, the row said nothing about the player at all. A
 * truncated name still reads as a name and carries its whole spelling on the
 * `title`; a team code that is only sometimes there does not.
 *
 * The knock-on is that the *contraction* threshold stays at `@lg` and is
 * deliberately not moved to meet this one: between `@lg` and `@3xl` the name
 * owns its whole line and has room for the full spelling, and re-contracting it
 * at `@3xl` to buy back width would be a third crossing of the same axis.
 *
 * **The name is 0.9375rem and steps to 1rem at `@4xl`, and that tier is a
 * measurement rather than a round number.** It was a flat `text-sm` — the same
 * size as the value column beside it, and smaller than the standings' own
 * manager name — for the field this half is a list *of*. Its two costs are the
 * ones already stated above: the position and the team went to 0.7rem with it,
 * which is the 3–5px the pair gained, and the band where a nineteen-character
 * name truncates in the one-line shape widened from ~768–821px of panel to
 * ~768–850px. `@4xl` is where the step up is safe rather than where it looks
 * tidy — the name track there is 159px against `DEF WAS` and 176px against
 * `RB SF`, and `Christian McCaffrey` is 144.7px at 1rem, so it is the first
 * tier holding that name whole on *every* row. `@3xl`'s own 95–112px holds it
 * at no size at all, which is why the step waits rather than meeting the shape
 * switch.
 */
export const SPLIT_LAYOUT: SectionLayout = {
  grid:
    "grid-cols-[minmax(0,1fr)_2.875rem_2.875rem] " +
    "@lg:grid-cols-[minmax(0,1fr)_3.25rem_3.25rem] " +
    "@3xl:grid-cols-[2.125rem_minmax(0,1fr)_3.5rem_3.5rem]",
  // Two lines: the name group spans the row. One line: it is one cell of it,
  // between the slot lane and the numbers.
  nameSpan: "col-span-3 @3xl:col-span-1",
  // Row two, second track — the first is under the name and belongs to nothing.
  statStart: "@max-3xl:col-start-2",
  // Both tracks plus the `gap-x-2` between them.
  lane: "w-[7.5rem]",
};

/**
 * The same row with one number instead of two — what a panel opened on a week
 * draws, since the week grain has a single metric to show.
 *
 * **Every track keeps the width it is cut to above**, which is what makes this a
 * template rather than a re-measurement: dropping a column only ever hands width
 * *back* to the name, and the string each value track is cut for
 * (`1,041.16` at the tier's own size) is unchanged. A metric whose numbers run
 * wider than that wants both templates re-measured, not this one.
 *
 * The two placements that are not simply "one track fewer" are the ones to
 * check. `nameSpan` still covers the whole of the narrow shape's first line, so
 * it is one less than {@link SPLIT_LAYOUT}'s; `statStart` is unchanged, because
 * what it names is the track the *first* number sits in and the leading track is
 * still the one under the name. And the lane is one 3.5rem track with no gap
 * inside it — it spans the numbers, so with one number there is nothing to span
 * between.
 */
export const ONE_NUMBER: SectionLayout = {
  grid:
    "grid-cols-[minmax(0,1fr)_2.875rem] " +
    "@lg:grid-cols-[minmax(0,1fr)_3.25rem] " +
    "@3xl:grid-cols-[2.125rem_minmax(0,1fr)_3.5rem]",
  nameSpan: "col-span-2 @3xl:col-span-1",
  statStart: "@max-3xl:col-start-2",
  lane: "w-[3.5rem]",
};

/**
 * The template a section takes for `count` value columns.
 *
 * Beside the templates rather than at the call site, so which shape a count
 * means is decided once — a second reader choosing for itself is how two lists
 * that share a heading rail end up laid out differently. A count past what is
 * spelled out falls to the widest template, since a stored selection is fixed to
 * the defaults' length (`resolveColumns`) and cannot legitimately arrive here.
 */
export function sectionLayout(count: number): SectionLayout {
  if (count <= 0) return NO_NUMBERS;
  return count === 1 ? ONE_NUMBER : SPLIT_LAYOUT;
}
