/**
 * The geometry a list's stat columns are laid on: the width one column takes,
 * the inset around it, and the box the row of them sits in.
 *
 * **Written once because more than two components have to agree to the pixel.**
 * A card renders the numbers, the heading rail above the list names them, and a
 * heading a hair wider than the number under it reads as a misaligned table —
 * exactly the drift a retyped width produces. It lived in the manager tool's
 * `metric-column`; the lineup checker's rows wear the same four columns, so it is
 * here now under the usual mover's rule, with that module importing it from where
 * its own consumers already read it.
 *
 * **From `sm` up the width is set by the longest label, not by the numbers.** It
 * was 80px everywhere, which fits every number these columns print and truncates
 * a third of the manager catalogue's labels ("Proj bench" is 69px at this size).
 * That was survivable while the label sat on every card, where a reader could read
 * it off a neighbouring row; with the labels lifted into one heading rail, a
 * truncated one is the only name that column has. 96px clears the widest of them
 * with the gutters counted, and the name beside it is the field that gives up the
 * space — it truncates to a tooltip, where a heading truncates to nothing.
 *
 * **Below `sm` the columns divide the row instead of being 96px wide.** Four of
 * them at that width plus the card's insets overflow a 390px screen, which is why
 * the card stacks down there — the name takes the first line and the columns take
 * the second, whole. So a column is an equal share of that line
 * (`flex-1 min-w-0`, no fixed width to overflow), which on a phone is ~82px:
 * wider than the 80px this used to hard-code, and, more to the point, a width the
 * heading rail can reproduce exactly. That is what keeps one geometry at both
 * breakpoints rather than two.
 *
 * **The width is what the two ends share; the inset is not.** A heading's label
 * sits in a milled slot with an inset of its own, so a heading spends its 10px as
 * 6px of cell and 4px of channel where a cell spends all 10 at once — the text
 * still starts at the same x, which is the whole of what has to hold. That is why
 * {@link COLUMN_WIDTH} is split out and the padding is added per end: a shared box
 * that also owned the inset would have to be overridden by the rail, which is the
 * drift writing the geometry once was meant to prevent.
 */
export const COLUMN_WIDTH = "min-w-0 flex-1 sm:w-24 sm:flex-none sm:shrink-0";

/** {@link COLUMN_WIDTH} plus the inset a *cell* spends in one go. */
export const COLUMN_BOX = `${COLUMN_WIDTH} px-2.5`;

/**
 * The box the four columns sit in — full width below `sm` where they divide a
 * line of their own, shrink-wrapped from `sm` up where they ride at the end of a
 * row.
 *
 * **The heading rail does not wear this.** A card's columns shrink-wrap because
 * the name beside them is what takes the rest of the row; the rail spans the row
 * instead, and reaches this geometry through the cells it holds at the end of it.
 */
export const COLUMN_ROW = "flex w-full items-stretch sm:w-auto sm:shrink-0";
