import { ADP_PEAK } from "../../adp-controls";
import { KTC_COLUMN_SEAT } from "./adp-drawer.constants.ts";

/**
 * The numeric cells every row of the board draws, whatever the row is.
 *
 * They are here rather than beside the player row because a **pick** row draws
 * exactly the same ones — a place on the board, what that place is worth, and
 * what KTC says the same asset costs — and the one thing that must not differ
 * between the two kinds of row is how a number is presented. What differs is
 * upstream of the cell: a player's value is his average put through the curve, a
 * pick's is that same curve discounted for how far out the pick is. So the cells
 * take *numbers* and the rows do the arithmetic, which also keeps the em-dash
 * rule in one place.
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

/**
 * What KeepTradeCut prices this row at, on one of its two boards.
 *
 * **Plain `foreground`, never the accent, and no rail under it.** The accent on
 * this board means "the value curve" — it is spent on the column the slider two
 * inches up is bending, and a second tinted number would claim these two move
 * together when they are the one column here that does not move at all. The rail
 * is the same argument in the other direction: it is what makes the curve's
 * shape legible across the column, and KTC has no curve to make legible.
 *
 * Null is an em dash on the usual terms, and it is the *common* case rather than
 * an edge: KTC carries ~500 dynasty skill players, so every kicker, every
 * defence, every IDP and the deep end of each position is simply off its board.
 * A zero there would report a player as worthless who was never priced at all.
 */
export function KtcCell({
  value,
  title,
}: {
  value: number | null;
  /** Which of KTC's boards this is, and how sure the number is on a pick row. */
  title?: string;
}) {
  if (value === null) {
    return (
      <span className={`${KTC_COLUMN_SEAT} text-right text-xs text-foreground/25`}>
        —
      </span>
    );
  }
  return (
    <span
      className={`${KTC_COLUMN_SEAT} text-right text-xs tabular-nums text-foreground/60`}
      title={title}
    >
      {value.toLocaleString()}
    </span>
  );
}
