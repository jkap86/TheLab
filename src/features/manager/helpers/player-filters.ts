import type { PlayerShare } from "./shares";

/*
 * What the players drawer is narrowed by, and the one predicate that reads it.
 *
 * Pure, and in `helpers/` rather than beside the panel, for the reason
 * `league-filters/predicates.ts` is: these decisions are silent when wrong — an
 * absent age quietly counting as young, a full-width range counting as a filter
 * — so they have to resolve under Node's own test runner, which resolves the
 * file it is given and knows nothing of the `@/*` aliases.
 */

/**
 * The bucket an absent answer falls in, in both string facets.
 *
 * It is the **em dash the cells already draw** rather than a word, so a chip
 * and the row it counts spell the same absence. One constant for position and
 * team both: "we do not know" is one answer whichever question asked it, and a
 * second spelling is a chip that could not match its own rows.
 */
export const UNKNOWN_VALUE = "—";

/** Sleeper's own vocabulary, in the order a roster is usually read. */
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

export function positionRank(position: string): number {
  const i = POSITION_ORDER.indexOf(position);
  return i === -1 ? POSITION_ORDER.length : i;
}

/** An inclusive numeric span, or null where the facet has nothing to bound. */
export type Span = { lo: number; hi: number } | null;

export type PlayerFilterState = {
  /**
   * Multi-select within a facet, **OR** inside it and **AND** across the four.
   * Empty is "not asked", which is not the same as "every value chosen": a
   * facet nobody has touched must not start excluding a player the moment a
   * new value appears in the population.
   */
  positions: readonly string[];
  teams: readonly string[];
  /** Null until the reader moves a handle — see {@link spanActive}. */
  age: Span;
  draftClass: Span;
};

export const NO_PLAYER_FILTERS: PlayerFilterState = {
  positions: [],
  teams: [],
  age: null,
  draftClass: null,
};

/**
 * The bounds the sliders run between, read off the population rather than
 * compiled in: a board with no rookies on it must not offer a handle for them,
 * and next year's class arrives without an edit here.
 *
 * Null where fewer than two distinct values exist — a slider whose two handles
 * cannot be apart is a control that cannot answer anything, and the panel drops
 * the row rather than drawing a dead one.
 */
export function playerFilterBounds(
  players: readonly PlayerShare[],
  read: (p: PlayerShare) => number | null,
): Span {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of players) {
    const v = read(p);
    if (v == null) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo < hi ? { lo, hi } : null;
}

/**
 * Whether a span is a filter at all. A range sitting on both bounds is the
 * reader not having asked, and counting it would light the Filters key, print a
 * summary and exclude every player whose age is unknown — all for a control
 * nobody has touched.
 */
export function spanActive(span: Span, bounds: Span): boolean {
  if (!span || !bounds) return false;
  return span.lo !== bounds.lo || span.hi !== bounds.hi;
}

/**
 * How many of the four facets are narrowing, for the Filters key's badge.
 * Counted per facet rather than per value — "3" beside the key means three
 * questions have been answered, which is what a reader can act on; the number
 * of chips inside them is the tray's own business.
 */
export function activeFilterCount(
  filters: PlayerFilterState,
  ageBounds: Span,
  classBounds: Span,
): number {
  return (
    (filters.positions.length > 0 ? 1 : 0) +
    (filters.teams.length > 0 ? 1 : 0) +
    (spanActive(filters.age, ageBounds) ? 1 : 0) +
    (spanActive(filters.draftClass, classBounds) ? 1 : 0)
  );
}

/** Whether one number is inside a span that is actually narrowing. */
function insideSpan(value: number | null, span: Span, bounds: Span): boolean {
  if (!span || !spanActive(span, bounds)) return true;
  // **A null answer is outside every span**, never inside one — see below.
  if (value == null) return false;
  return value >= span.lo && value <= span.hi;
}

/**
 * Whether one player survives the four facets.
 *
 * **A null age or draft class is outside every span**, never inside one. An
 * absent answer is not a young player, and folding it in would make "22–25"
 * quietly mean "22–25, and everyone we know nothing about" — the same rule the
 * drawer's own cells are written by, where a missing value draws an em dash
 * rather than a zero and a sort puts the row last rather than at a fabricated
 * bottom of the scale. An *untouched* span is not a span at all, so it keeps
 * those rows: that is `spanActive`'s whole job.
 */
export function keepsPlayer(
  player: PlayerShare,
  filters: PlayerFilterState,
  ageBounds: Span,
  classBounds: Span,
): boolean {
  const { positions, teams } = filters;
  if (positions.length && !positions.includes(player.position ?? UNKNOWN_VALUE)) {
    return false;
  }
  if (teams.length && !teams.includes(player.team ?? UNKNOWN_VALUE)) return false;
  if (!insideSpan(player.age, filters.age, ageBounds)) return false;
  if (!insideSpan(player.draft_class, filters.draftClass, classBounds)) return false;
  return true;
}

/**
 * A facet's values and how many players carry each.
 *
 * **Counted over the unfiltered population**, which is the rule the position
 * chips already lived by and which now covers teams too: a facet says how many
 * it *would leave*, not how many are left, so a chip that reads zero the moment
 * you press it cannot happen and a reader can widen without clearing first.
 */
export function facetCounts(
  players: readonly PlayerShare[],
  read: (p: PlayerShare) => string | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of players) {
    const key = read(p) ?? UNKNOWN_VALUE;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** What the tray says it has narrowed to, for the footer line. */
export function playerFilterSummary(
  filters: PlayerFilterState,
  ageBounds: Span,
  classBounds: Span,
): string | null {
  const parts: string[] = [];
  if (filters.positions.length) parts.push(filters.positions.join("/"));
  if (filters.teams.length) parts.push(filters.teams.join("/"));
  const { age, draftClass } = filters;
  if (age && spanActive(age, ageBounds)) parts.push(`Age ${age.lo}–${age.hi}`);
  if (draftClass && spanActive(draftClass, classBounds)) {
    parts.push(`Class ${draftClass.lo}–${draftClass.hi}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/** Add or remove one value from a facet — the chips' only write. */
export function toggleFacet(
  values: readonly string[],
  value: string,
): readonly string[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}
