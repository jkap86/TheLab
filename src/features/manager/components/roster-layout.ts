/**
 * The grid a roster section's rows and its column headings share.
 *
 * One template for both, so the headings stay over their numbers — a header laid
 * out separately drifts the moment a width changes. `RosterSection` renders the
 * headings from `columns` and `PlayerRow` lays its cells on `grid`, which is why
 * the two live in `roster-detail` and `player-row` but the contract between
 * them lives here.
 *
 * Two lines per row rather than one, because a name is the thing you actually read
 * and it was losing to everything else on the row: squeezed between a slot label,
 * a position badge, a team and two totals, "Christian McCaffrey" truncated inside a
 * panel that renders at half the width of a card. So the name takes the whole first
 * line and the rest — position, team, points — sits under it. The numbers keep
 * their own columns on that second line, which is what still makes them comparable
 * down the list.
 *
 * Which metric those two number columns show is a separate choice, held above the
 * panel and rendered by the section's heading pickers; this only fixes their
 * *count* and width. `SPLIT_LAYOUT`'s grid therefore carries exactly two number
 * tracks, matching the two selectable value columns, and `NO_NUMBERS` carries none
 * for a league with nothing to price.
 */
export type SectionLayout = {
  /** Column template: slot gutter, name/meta, then one track per value column. */
  grid: string;
  /** How far the name reaches on its own line — the meta column plus the numbers. */
  nameSpan: string;
};

// Written out rather than assembled, so Tailwind sees every class string whole.
/**
 * The slot gutter is `1.25rem` below `@lg` and `2.5rem` above it, and the narrow
 * figure is derived rather than picked: at `text-[0.6rem]` the widest label the
 * column can be asked to hold is `DEF` at 19.2px, so 20px is that measurement
 * plus nothing. It used to be `1.75rem`, which was sized for `SFLX` at the wider
 * tier's type — 28px of track for a two-letter `RB`, spent out of the one column
 * that can't shorten its own contents.
 *
 * **A fixed track and not `auto`, which is the trap here.** Each row and each
 * section heading is its own grid container, so an intrinsic track is measured
 * per row: the starters section would size to `FLEX` and the bench section — whose
 * rows carry no slot at all — would size to zero, putting the two lists' names and
 * value columns at different x. Same reason the standings can't use one either,
 * one row down: `1` and `12` would not agree.
 *
 * That fixed width is what `NARROW_SLOT_LABEL` in `player-row` exists to respect —
 * the two are a matched pair, and a label added there without a width check here
 * truncates the one thing on the row that must never truncate, since a clipped
 * label reads as broken where a clipped name only reads as long.
 */
export const NO_NUMBERS: SectionLayout = {
  grid: "grid-cols-[1.25rem_minmax(0,1fr)] @lg:grid-cols-[2.5rem_minmax(0,1fr)]",
  nameSpan: "col-span-1",
};

/**
 * Below @xl only the *first* value column is drawn, the same rule the standings
 * half keeps and for the same reason: the panel stays a 50/50 split at every
 * width, which on a phone leaves this half ~155px. Two 3rem tracks left ~19px
 * for everything else, so the section headings truncated to `S..` and `B..` and
 * the numbers overflowed their tracks into the position badge beside them. The
 * surviving track is `auto` rather than a fixed 3rem for that second failure —
 * a season total is eight characters wide and a fixed track can't say so.
 *
 * It is the second slot that goes rather than the first because the reader's
 * leading choice is the one they aimed first, and both are back the moment
 * there is width for them.
 *
 * **@xl and not @lg, which is three tiers rather than two, and the middle one is
 * the whole point.** A container tier describes the *panel*, and each half is
 * barely half of it: at @lg (32rem) a half is ~230px, and once its own `p-4` and
 * two fixed 3.25rem tracks come out of that, the name track is left with **32px**
 * — so `Starters` clipped to `S…` and the NFL team beside the badge was squeezed
 * to nothing, while the *name* looked fine because it spans all three columns and
 * never touches that track. A column added at the tier where the gutters widen
 * looks like one decision and is two; the middle tier is what separates them, so
 * @lg buys the roomier gutter and @xl buys the second number.
 */
export const SPLIT_LAYOUT: SectionLayout = {
  grid:
    "grid-cols-[1.25rem_minmax(0,1fr)_auto] " +
    "@lg:grid-cols-[2.5rem_minmax(0,1fr)_3.25rem] " +
    "@xl:grid-cols-[2.5rem_minmax(0,1fr)_3.25rem_3.25rem]",
  nameSpan: "col-span-2 @xl:col-span-3",
};
