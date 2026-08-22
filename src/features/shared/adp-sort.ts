import { previewAdpValue } from "./adp-controls.ts";
import type { AdpBoardEntry } from "./adp-picks.ts";
import type { LeagueFilters } from "./league-filters/types.ts";
import type { AdpBoardType } from "@/shared/manager";

/**
 * Which column the drawer's board is ordered on, and which way.
 *
 * **The board had exactly one ordering and it was the right one, which is why
 * this is a layer over it rather than a replacement.** `adpBoardEntries` merges
 * the players with the picks that stand on them, in ADP order, and that merge
 * carries three rules a sort must not undo — a single board keeps only the rows
 * it can average, a tie puts the player above the pick annotating it, and the
 * order is *total* so two renders agree. All of that survives here: the natural
 * order is a column like any other ({@link DEFAULT_ADP_SORT}), and every other
 * column falls back to it on a tie, so a sort re-orders the list without ever
 * inventing an order for rows it cannot tell apart.
 *
 * Three decisions are worth reading before adding a column:
 *
 * - **A column sorts what the cell actually draws**, never a number behind it.
 *   The Taken cell is a share of *this board's* drafts, so it sorts on the
 *   sample — the denominator is one number for the whole column, so the two
 *   orderings are identical and the sample needs no board count threaded in.
 *   The Value cells are the curve applied to an average, so they sort on the
 *   curve's answer rather than on the average: for a player those are the same
 *   ordering reversed, but a *pick* carries a future-season discount on top, and
 *   sorting it by ADP would put a 2032 first exactly where a current-year one
 *   sits while the column beside it says otherwise.
 * - **A row with nothing in the column sinks, whichever way the column is
 *   pointed.** An em dash is not a small number and not a large one — it is the
 *   absence of an answer, so it belongs at the bottom of both directions. It is
 *   the trade card's own rule for an unpriced line, which sinks to the bottom of
 *   its block and never out of it.
 * - **A press picks the direction that answers the question.** ADP ascends
 *   (pick 1 is the best pick); value, Taken and Bid descend (more is more); a
 *   name ascends. A second press on the same column flips it. That is what makes
 *   one press enough, and it is {@link NATURAL_DIRECTION}.
 *
 * Pure and tested: the runtime import is relative with an explicit `.ts`
 * extension — the mechanism the pure modules already use between themselves —
 * and every shape arrives as an erased `import type`.
 */

/**
 * A column the board can be ordered on.
 *
 * Board-qualified rather than positional (`adp_redraft`, not "the fourth
 * column"), because the same heading means different data in the two board
 * modes: in single-board mode the one ADP column *is* whichever market is lit.
 * The header maps its own columns onto these, so a sort survives the reader
 * toggling a board on — {@link resolveAdpSort} is what catches the case where it
 * cannot.
 */
export type AdpSortColumn =
  | "rank"
  | "name"
  | "position"
  | "adp_redraft"
  | "adp_dynasty"
  | "taken"
  | "auction_redraft"
  | "auction_dynasty"
  | "value_redraft"
  | "value_dynasty";

export type AdpSortDirection = "asc" | "desc";

export type AdpSort = {
  column: AdpSortColumn;
  direction: AdpSortDirection;
};

/**
 * The board's own order: the merge {@link AdpBoardEntry} arrives in.
 *
 * Spelled as a column rather than as `null` so that "sorted by nothing" is not a
 * second state the header has to draw differently — the `#` heading is lit like
 * any other, and pressing it reverses the board, which is a genuinely useful
 * thing to be able to ask for and would otherwise need a control of its own.
 */
export const DEFAULT_ADP_SORT: AdpSort = { column: "rank", direction: "asc" };

/**
 * Which way a column points on its *first* press — the direction that answers
 * the question the column is there to answer.
 *
 * A reader pressing Bid wants the players a room emptied its budget on, not the
 * dollar fliers; a reader pressing ADP wants pick 1. Opening every column
 * ascending would make half of them a two-press control for their obvious
 * reading.
 */
const NATURAL_DIRECTION: Record<AdpSortColumn, AdpSortDirection> = {
  rank: "asc",
  name: "asc",
  position: "asc",
  adp_redraft: "asc",
  adp_dynasty: "asc",
  taken: "desc",
  auction_redraft: "desc",
  auction_dynasty: "desc",
  value_redraft: "desc",
  value_dynasty: "desc",
};

/**
 * What pressing a heading does: flip the column already sorted, or move to a new
 * one in its natural direction.
 */
export function nextAdpSort(current: AdpSort, column: AdpSortColumn): AdpSort {
  if (current.column === column) {
    return { column, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { column, direction: NATURAL_DIRECTION[column] };
}

/**
 * The columns a given board mode actually draws.
 *
 * `taken` is the one that is genuinely mode-specific: both boards trade it for
 * the second ADP column, and its share moves to that column's hover. Everything
 * else is board-qualified, so the same three markets' columns — ADP, Bid, Value
 * — exist in whichever mode that market is lit, which is what lets a sort survive
 * a reader toggling the other board on.
 *
 * **A column hidden by a container tier is still a column of this mode**, which
 * is the one thing not to "fix" here: the Bid column is seated from `@md` with
 * one market lit and its pair from `@lg` with two, so on a narrow panel a reader
 * can hold a sort on a column they cannot see. That is right — the ordering stays
 * the one they chose, and widening the panel shows them the column it is on. What
 * {@link resolveAdpSort} guards is a column that has no *data* on screen, not one
 * the width has folded away.
 */
export function adpSortColumns(
  both: boolean,
  soleBoard: AdpBoardType,
): AdpSortColumn[] {
  const shared: AdpSortColumn[] = ["rank", "name", "position"];
  if (both) {
    return [
      ...shared,
      "adp_redraft",
      "adp_dynasty",
      "value_redraft",
      "value_dynasty",
      "auction_redraft",
      "auction_dynasty",
    ];
  }
  return [
    ...shared,
    `adp_${soleBoard}`,
    "taken",
    `auction_${soleBoard}`,
    `value_${soleBoard}`,
  ];
}

/**
 * The sort to actually apply, which is the reader's unless the column it names
 * has left the screen.
 *
 * Toggling a board off takes its two columns with it, and a list still ordered
 * on one of them is a list in an order nothing on screen explains — worse than a
 * reset, because there is no heading lit to say what happened. Falling back to
 * the board's own order is the one ordering that is always legible.
 *
 * It is resolved at render rather than written back on the toggle, so that
 * turning a board off and on again returns the reader to the sort they chose
 * rather than silently discarding it.
 */
export function resolveAdpSort(
  sort: AdpSort,
  both: boolean,
  soleBoard: AdpBoardType,
): AdpSort {
  return adpSortColumns(both, soleBoard).includes(sort.column)
    ? sort
    : DEFAULT_ADP_SORT;
}

/** Whether a sort reads the value curve, and so moves under the slider. */
export function isValueSort(sort: AdpSort): boolean {
  return sort.column === "value_redraft" || sort.column === "value_dynasty";
}

/** What a comparison needs beyond the row itself. */
export type AdpSortContext = {
  /**
   * Which market the single-board columns read. Unused in both-boards mode,
   * where every board-specific column names its own.
   */
  soleBoard: AdpBoardType;
  /** The board's league rules — the pool the value curve is anchored to. */
  rules: LeagueFilters;
  /** The curve being previewed, so a value sort agrees with the cells. */
  steepness: number;
};

/**
 * What one row sorts as in one column: a number, a string, or null for a cell
 * with no answer in it.
 *
 * Null is deliberately a third case rather than an extreme number. `-Infinity`
 * would sink a row in one direction and float it in the other, which is exactly
 * the behaviour the em-dash rule above exists to prevent.
 */
function sortKey(
  entry: AdpBoardEntry,
  column: AdpSortColumn,
  ctx: AdpSortContext,
): number | string | null {
  const value = (adp: number | undefined, discount = 1): number | null =>
    adp === undefined ? null : previewAdpValue(adp, ctx.rules, ctx.steepness) * discount;

  if (entry.kind === "pick") {
    const pick = entry.pick;
    switch (column) {
      case "name":
        return pick.label;
      // The column a player draws his position in carries the pick's *round*,
      // which is what a list of picks is scanned on — so that is what it sorts
      // by, as the token on screen. Ordinals compare as text, which is the same
      // order as the number for the one-digit rounds KTC prices; a board that
      // ever reaches a tenth round would want the number instead.
      case "position":
        return `${pick.round}`;
      case "adp_redraft":
        return pick.redraft?.adp ?? null;
      case "adp_dynasty":
        return pick.dynasty?.adp ?? null;
      // A pick was taken in none of these drafts — it was never on the board —
      // so it has no share to sort on, which is the same em dash the cell draws.
      // The auction columns are the same answer for the same reason: what an
      // auction sells is players, so a rookie pick was never a lot in one.
      case "taken":
      case "auction_redraft":
      case "auction_dynasty":
        return null;
      case "value_redraft":
        return value(pick.redraft?.adp, pick.redraft?.discount);
      case "value_dynasty":
        return value(pick.dynasty?.adp, pick.dynasty?.discount);
      default:
        return null;
    }
  }

  const player = entry.player;
  switch (column) {
    case "name":
      return player.name;
    case "position":
      return player.position;
    case "adp_redraft":
      return player.redraft?.adp ?? null;
    case "adp_dynasty":
      return player.dynasty?.adp ?? null;
    // The sample rather than the share: the denominator is one number for the
    // whole column, so the two orderings are identical and this needs no draft
    // count threaded through to be right.
    case "taken":
      return player[ctx.soleBoard]?.picks ?? null;
    // The share the cell draws, not the sample behind it: unlike Taken, the
    // denominator here is *per player* — a row bought in two auctions and one
    // bought in fifty are averaging different things — so the two orderings are
    // genuinely different and only the displayed one is the column's question.
    case "auction_redraft":
      return player.auction.redraft?.share ?? null;
    case "auction_dynasty":
      return player.auction.dynasty?.share ?? null;
    case "value_redraft":
      return value(player.redraft?.adp);
    case "value_dynasty":
      return value(player.dynasty?.adp);
    default:
      return null;
  }
}

/** One column's comparison: nulls last either way, then the column's own order. */
function compareKeys(
  a: number | string | null,
  b: number | string | null,
  direction: AdpSortDirection,
): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  const rank =
    typeof a === "string" && typeof b === "string"
      ? a.localeCompare(b)
      : Number(a) - Number(b);
  if (!Number.isFinite(rank)) return 0;
  return direction === "asc" ? rank : -rank;
}

/**
 * The board's rows in the reader's order.
 *
 * The natural order is returned as-is rather than run through the comparator —
 * it is what the input already is, and re-sorting it would be a thousand
 * comparisons to arrive back where it started. Reversed, it is a copy: the
 * caller's array is a memo other things read.
 *
 * Every other column ties back to that natural order by index, which is what
 * makes a sort *total* — a column of em dashes, or a whole board on one bid
 * share, still comes back in a fixed order rather than whatever the engine's
 * sort happens to do that render.
 */
export function sortAdpEntries(
  entries: readonly AdpBoardEntry[],
  sort: AdpSort,
  ctx: AdpSortContext,
): readonly AdpBoardEntry[] {
  if (sort.column === "rank") {
    return sort.direction === "asc" ? entries : [...entries].reverse();
  }

  // Keys are read once per row rather than per comparison: a value key runs the
  // curve, and a thousand-row board is ~10,000 comparisons.
  const keyed = entries.map((entry, index) => ({
    entry,
    index,
    key: sortKey(entry, sort.column, ctx),
  }));

  keyed.sort(
    (a, b) => compareKeys(a.key, b.key, sort.direction) || a.index - b.index,
  );
  return keyed.map((row) => row.entry);
}
