/**
 * What a facet tray's span rows and chip rows are, arithmetically — the two
 * rules a second copy of would be silent when it drifted.
 *
 * Pure and free of imports, on `league-subjects.ts`' terms and for its reason:
 * both features' filter helpers reach it **relatively with `.ts`** so they go
 * on resolving under Node's own runner, which resolves the file it is given
 * and knows nothing of the `@/*` aliases.
 *
 * It came out of `features/manager/helpers/player-filters.ts` when the
 * gametime board's Filters tray became a second reader — the line
 * `CONSOLE_KEY`, `ManagerPlate` and `CollapseTray` all moved on. That file
 * re-exports every name here, so no manager caller moved with it; what could
 * not stay there is the *rule*, because the two trays ask it of two different
 * scales (an age, a quarter of a football game) and a span that counted as a
 * filter on one page and not the other would be a Filters badge reading `1`
 * over a list nothing had narrowed.
 */

/** An inclusive numeric span, or null where the facet has nothing to bound. */
export type Span = { lo: number; hi: number } | null;

/**
 * Whether a span is a filter at all. A range sitting on both bounds is the
 * reader not having asked, and counting it would light the Filters key, print
 * a summary and exclude every row whose answer is unknown — all for a control
 * nobody has touched.
 */
export function spanActive(span: Span, bounds: Span): boolean {
  if (!span || !bounds) return false;
  return span.lo !== bounds.lo || span.hi !== bounds.hi;
}

/**
 * Whether one value is inside a span that is actually narrowing.
 *
 * **A null answer is outside every span**, never inside one. An absent answer
 * is not a young player and not an early kickoff, and folding it in would make
 * `22–25` quietly mean "22–25, and everyone we know nothing about" — the same
 * rule both trays' own cells are written by, where a missing value draws an em
 * dash rather than a zero and a sort puts the row last rather than at a
 * fabricated bottom of the scale.
 *
 * An *untouched* span is not a span at all, so it keeps those rows: that is
 * {@link spanActive}'s whole job, and it is why this asks it rather than
 * taking a boolean the caller worked out for itself.
 */
export function insideSpan(value: number | null, span: Span, bounds: Span): boolean {
  if (!span || !spanActive(span, bounds)) return true;
  if (value == null) return false;
  return value >= span.lo && value <= span.hi;
}

/**
 * Add or remove one value from a multi-select facet — the chips' only write.
 *
 * Order is the press order, which is what a trigger's `CIN · LAR` summary
 * reads back.
 */
export function toggleFacet<T extends string>(
  values: readonly T[],
  value: T,
): readonly T[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}
