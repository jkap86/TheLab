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
  /** Column template: name/meta, then one track per value column. */
  grid: string;
  /** How far the name reaches on its own line — the meta column plus the numbers. */
  nameSpan: string;
};

// Written out rather than assembled, so Tailwind sees every class string whole.
/**
 * There is no slot gutter in either template, which is the change these two
 * exist to record. The slot used to hold a fixed track spanning both of a row's
 * lines — `1.25rem` below @lg, `2.5rem` above — so a four-letter label was
 * charged to the numbers line as well as the name line, and the bench section
 * paid for it on every row while never filling it. It rides the row's leading
 * corner as a tab now (see `.lab-tab`), and the ~28px that frees is what pays
 * for the second value column at every width.
 *
 * A knock-on worth knowing: a tab sizes to its own label where a track is sized
 * for the widest label in the section, so `SUPER_FLEX` no longer charges `RB`
 * for its width — which is what retired `NARROW_SLOT_LABEL` in `player-row` and
 * the matched-pair hazard that came with it. The other side of the same coin is
 * that a bench row's name now starts where a starter's tab ends rather than
 * lining up with it. That is the honest trade: the alternative is indenting the
 * bench past a mark it doesn't carry, which is the empty gutter again under
 * another name.
 */
export const NO_NUMBERS: SectionLayout = {
  grid: "grid-cols-[minmax(0,1fr)]",
  nameSpan: "col-span-1",
};

/**
 * **Both value columns at every width**, where the second used to wait for @xl.
 *
 * **What sizes these tracks is the heading, not the number** — which is the one
 * thing worth knowing before touching them. The old templates could use `auto`,
 * so the widest of the two set the width and neither could clip; fixed tracks
 * have to be measured against both, and the headings are the wider. In Arial at
 * the rail's 0.6rem, `395.96` is 36.6px at `text-xs` while `Bench` is 34.8px
 * uppercase and tracked — and `Optimal`, in the standings' own catalogue, is
 * 43.8px. That is why both rails drop to sentence case below @lg (see
 * `roster-detail`'s `ColumnRail`): a clipped *name* reads as long, where a
 * heading clipped inside its own word reads as broken.
 *
 * Three tiers, because the constraint only moves twice: the base tier is a
 * 352px phone, @lg is where the NFL team comes back onto the meta line beside
 * the badge, and @xl is where there is room to spend. Every track is wider than
 * the single `3.25rem` this used to carry from @lg up — doubled *and* wider.
 *
 * **Fixed tracks and not `auto`, which is the trap the old grid avoided rather
 * than solved.** Each row and each section heading is its own grid container,
 * so an intrinsic track is measured per row: one row holding `1,041.16` would
 * set its columns wider than the row above it, and the two sections' numbers
 * would not line up. Same reason the standings can't use one either.
 */
export const SPLIT_LAYOUT: SectionLayout = {
  grid:
    "grid-cols-[minmax(0,1fr)_2.75rem_2.75rem] " +
    "@lg:grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] " +
    "@xl:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem]",
  nameSpan: "col-span-3",
};
