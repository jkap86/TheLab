/**
 * What to say, and what to offer, when a league grid narrows to nothing.
 *
 * **Which narrowing emptied it is the whole question.** Three pages narrow their
 * grid two ways — the league rules, and the subjects picked in the drawers — and
 * the two are undone by two different controls, so a message naming the wrong
 * one comes with a key that does nothing: `Clear filters` over filters already
 * at their defaults leaves the reader looking at the same empty page, with the
 * token tray above it as the only clue and nothing pointing at it.
 *
 * **It is `features/shared` because three pages ask it**, and it arrived here
 * from `/manager` on the pass that gave the two week tools their own subject
 * narrowing. `/manager` had the three arms; the checker and gametime had one
 * message and read `filterSummary` under it whatever had narrowed — so a page
 * emptied by a player nobody rosters said "No leagues match these filters" over
 * the words "all leagues", which is two contradictory claims on one plate. The
 * fix is not a second copy of the three arms: the sentences a reader sees are
 * the same sentences on all three pages, and the day one is reworded it has to
 * be reworded once.
 *
 * Pure, and the two states arrive as booleans rather than as the filters and the
 * subject set: what this decides is a *reading*, and a module that took the two
 * objects would have to know how each page counts an active narrowing. The
 * `clear` action stays at the call site for the same reason — three pages hold
 * that state three ways, and the only thing they agree on is what to call it.
 *
 * It never answers for a page with neither narrowing active: a grid with nothing
 * narrowing it and no visible leagues has no unfiltered leagues either, which is
 * a different empty state and a claim about the *manager* rather than about the
 * selection.
 */

/** Which of the two controls a page should point the reader at. */
export type NarrowedEmptyAction = "all" | "subjects" | "filters";

export type NarrowedEmptyState = {
  /** The claim: what narrowed, in a sentence. */
  message: string;
  /**
   * The league filters in words, or **null where they are not what emptied the
   * page**.
   *
   * A subject-only narrowing prints nothing here deliberately: the tokens are
   * named in the tray above, where the reader can already see them, and the
   * filter summary is a sentence nothing else on the page carries. Printed
   * under a subject-only narrowing it reads "all leagues", which is true of the
   * filters and the opposite of what the plate is saying.
   */
  summary: string | null;
  /** The key's legend. */
  label: string;
  /** Which state the key clears — the caller holds it. */
  action: NarrowedEmptyAction;
};

/**
 * The reading, given which narrowings are in force.
 *
 * `summary` is the caller's `filterSummary(filters)` rather than something
 * derived here, so the sentence on the empty plate and the sentence on the
 * header are one spelling.
 */
export function narrowedEmptyState(
  filtersActive: boolean,
  subjectsActive: boolean,
  summary: string,
): NarrowedEmptyState {
  if (filtersActive && subjectsActive) {
    return {
      message: "No leagues match the current filters and selection.",
      summary,
      label: "Clear all",
      action: "all",
    };
  }
  if (subjectsActive) {
    return {
      message: "No leagues match this selection.",
      summary: null,
      label: "Clear selection",
      action: "subjects",
    };
  }
  return {
    message: "No leagues match these filters.",
    summary,
    label: "Clear filters",
    action: "filters",
  };
}
