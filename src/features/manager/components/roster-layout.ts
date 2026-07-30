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
 */
export type SectionLayout = {
  /** Column template: slot gutter, name/meta, then one column per number. */
  grid: string;
  /** How far the name reaches on its own line — the meta column plus the numbers. */
  nameSpan: string;
  /** Headings for the number columns, left to right. */
  columns: string[];
};

// Written out rather than assembled, so Tailwind sees every class string whole.
export const NO_NUMBERS: SectionLayout = {
  grid: "grid-cols-[1.75rem_minmax(0,1fr)] @lg:grid-cols-[2.5rem_minmax(0,1fr)]",
  nameSpan: "col-span-1",
  columns: [],
};

export const SPLIT_LAYOUT: SectionLayout = {
  grid: "grid-cols-[1.75rem_minmax(0,1fr)_3rem_3rem] @lg:grid-cols-[2.5rem_minmax(0,1fr)_3.25rem_3.25rem]",
  nameSpan: "col-span-3",
  columns: ["start", "bench"],
};
