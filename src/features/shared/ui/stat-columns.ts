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
 * sits in a milled slot with an inset of its own, so a heading spends its inset as
 * cell-plus-channel where a cell spends the same total in one go — the text still
 * starts at the same x, which is the whole of what has to hold. That is why
 * {@link COLUMN_WIDTH} is split out and the padding is added per end: a shared box
 * that also owned the inset would have to be overridden by the rail, which is the
 * drift writing the geometry once was meant to prevent.
 *
 * **That total is 4px below `sm` and 10px from it, and the narrow one is a
 * measurement rather than a taste.** From `sm` the column is a fixed 96px and the
 * inset costs the row nothing; below it the four columns divide a line whose width
 * is *the phone's*, which is the one length in the app `--app-font-scale` cannot
 * scale — so raising the type takes width out of the columns from both ends at
 * once, the card's own insets growing while the numbers do. Measured in Chromium
 * against the compiled stylesheet, a 360px viewport had **no slack at all** at a
 * scale of 1 — every arm measured exactly its own column, to the pixel — so the
 * phone is where a global type increase lands first and hardest. Trimming the
 * inset to 4px is one half of buying that back and the number arms' own step
 * down below `sm` (see `StatBody`) is the
 * other; together they clear every arm at 360, 375 and 390. It is the padding
 * that gives and not the `divide-x` between the columns, per the league panel's
 * own rule: an inset holds content off an edge nothing is written on, where that
 * line is the only thing separating one number from the next.
 */
export const COLUMN_WIDTH = "min-w-0 flex-1 sm:w-24 sm:flex-none sm:shrink-0";

/** {@link COLUMN_WIDTH} plus the inset a *cell* spends in one go. */
export const COLUMN_BOX = `${COLUMN_WIDTH} px-1 sm:px-2.5`;

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
