import { ADP_PEAK } from "../../adp-controls";
import {
  AUCTION_COLUMN_SEAT,
  AUCTION_PAIR_SEAT,
} from "./adp-drawer.constants.ts";

/**
 * The numeric cells every row of the board draws, whatever the row is.
 *
 * They are here rather than beside the player row because a **pick** row draws
 * exactly the same ones — a place on the board, what that place is worth, and
 * what the auctions in the same population paid for it — and the one thing that
 * must not differ between the two kinds of row is how a number is presented.
 * What differs is upstream of the cell: a player's value is his average put
 * through the curve, a pick's is that same curve discounted for how far out the
 * pick is. So the cells take *numbers* and the rows do the arithmetic, which
 * also keeps the em-dash rule in one place.
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
 * What this row cost at auction, as a share of the room's budget.
 *
 * **Plain `foreground` and no rail.** The accent on this board means "the value
 * curve", and this column does not move under the slider — it is a price the
 * market actually paid rather than a reading of one.
 *
 * `label` arrives already formatted ({@link auctionShare}), because what varies
 * is only how many digits the number deserves and that decision belongs
 * somewhere testable. Null is an em dash on the usual terms and is the common
 * case rather than an edge: auctions are a small slice of the crawled corpus, so
 * most rows on most boards have no share to report — which is a different claim
 * from having gone cheap.
 *
 * **`paired` is which of two seats it takes, and the two are different tiers
 * rather than a preference.** One market lit puts a single Bid column at `@md`;
 * both lit puts one per market in the `@lg` tail, where there is room for two.
 * The cell reads the seat from the same constant its heading does, so the label
 * and the numbers under it cannot arrive at different widths.
 */
export function AuctionCell({
  label,
  title,
  paired = false,
}: {
  /** The share as it is written, or null for a row with no reading. */
  label: string | null;
  title?: string;
  /** This is one of the both-boards pair rather than the single-board column. */
  paired?: boolean;
}) {
  const seat = paired ? AUCTION_PAIR_SEAT : AUCTION_COLUMN_SEAT;
  if (label === null) {
    // The title rides on the em dash too, unlike the other cells here: a *pick*
    // row's blank is a column that does not apply rather than a gap in the data,
    // and that difference is only sayable on the dash itself.
    return (
      <span className={`${seat} text-right text-xs text-foreground/25`} title={title}>
        —
      </span>
    );
  }
  return (
    <span
      className={`${seat} text-right text-xs tabular-nums text-foreground/60`}
      title={title}
    >
      {label}
    </span>
  );
}
