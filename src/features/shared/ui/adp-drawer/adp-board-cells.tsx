import { ADP_PEAK } from "../../adp-controls";

/**
 * The two numeric cells every row of the board draws, whatever the row is.
 *
 * They are here rather than beside the player row because a **pick** row draws
 * exactly the same two — a place on the board and what that place is worth —
 * and the one thing that must not differ between the two kinds of row is how a
 * number is presented. What differs is upstream of the cell: a player's value is
 * his average put through the curve, a pick's is that same curve discounted for
 * how far out the pick is. So the cells take *numbers* and the rows do the
 * arithmetic, which also keeps the em-dash rule in one place.
 */

/**
 * One board's average for one row. Null is an em dash, never a zero — the board
 * took this player in too few drafts to average, or the pick's rung is past the
 * class it priced, and either is a different answer from a bad pick.
 */
export function AdpCell({
  adp,
  title,
}: {
  adp: number | null;
  /** What that number is over — the cell is a bare figure without it. */
  title?: string;
}) {
  if (adp === null) {
    return <span className="text-right text-xs text-foreground/25">—</span>;
  }
  return (
    <span className="text-right font-semibold tabular-nums" title={title}>
      {adp.toFixed(1)}
    </span>
  );
}

/**
 * The draft-capital preview for one row. The rail under the number is what makes
 * the slider legible: the shape of the whole column bends as the curve does,
 * where a row of digits only moves for the reader checking one. `collapsible` is
 * the both-boards spelling, seated only from `@md` up — see
 * `BOARD_COLUMNS_BOTH` for the arithmetic.
 */
export function ValueCell({
  value,
  title,
  collapsible = false,
}: {
  value: number | null;
  title?: string;
  collapsible?: boolean;
}) {
  const seat = collapsible ? "hidden @md:block" : "";
  if (value === null) {
    return <span className={`${seat} text-right text-xs text-foreground/25`}>—</span>;
  }
  return (
    <span
      className={`${seat} relative text-right text-xs tabular-nums text-active/80`}
      title={title}
    >
      {value.toLocaleString()}
      <span
        aria-hidden
        className="absolute inset-x-0 -bottom-0.5 h-px bg-active/45"
        style={{ transform: `scaleX(${value / ADP_PEAK})`, transformOrigin: "right" }}
      />
    </span>
  );
}
