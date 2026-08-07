import { memo } from "react";

import type { AdpBoardStats, AdpBoardType } from "@/shared/manager";
import type { AdpPlayerPayload } from "@/shared/contract";

import { ADP_PEAK, type AdpControls, previewAdpValue } from "../../adp-controls";
import { PositionBadge } from "../position-badge";
import {
  ADP_ROW_HEIGHT,
  BOARD_COLUMNS_BOTH,
  BOARD_COLUMNS_ONE,
} from "./adp-drawer.constants.ts";
import { adpCellTitle, takenShare } from "./adp-drawer.utils.ts";

/**
 * One player's row.
 *
 * Memoised, and every prop is a primitive or the row's own payload object for
 * that reason: the board can be a thousand rows, and the drawer above it
 * re-renders on things the rows have no stake in — a filter tray opening, the
 * window panel opening or closing, a draft count arriving. Nothing here takes a
 * callback, so there is no identity to keep stable and no `useCallback` to add;
 * what *does* move the rows is the steepness under a drag, which is the preview
 * the slider exists for.
 *
 * **The list is windowed, so a row places itself.** It takes an `offset` — a
 * number, not a style object, which is what keeps the memo above worth having:
 * the list rebuilds every windowed row's props on each scroll notification, and
 * a fresh `style` object would fail the shallow comparison for the two dozen
 * rows of which at most one has actually moved. The height is written on rather
 * than left to the content for the reason {@link ADP_ROW_HEIGHT} documents: the
 * offsets are multiples of that constant, so the element has to be exactly it.
 */
export const AdpBoardRow = memo(function AdpBoardRow({
  player,
  rank,
  count,
  offset,
  both,
  soleBoard,
  soleDrafts,
  redraftDrafts,
  dynastyDrafts,
  teams,
  steepness,
}: {
  player: AdpPlayerPayload;
  /** The row's place in the *display's* order, which is not the fetch's. */
  rank: number;
  /**
   * How long the whole list is. Only a windowful of rows is in the DOM, so
   * without this a screen reader would announce the board as being that long.
   */
  count: number;
  /** Where this row sits down the list, in px from the list's own top. */
  offset: number;
  both: boolean;
  soleBoard: AdpBoardType;
  soleDrafts: number | null;
  redraftDrafts: number | null;
  dynastyDrafts: number | null;
  teams: AdpControls["teams"];
  steepness: number;
}) {
  // In single-board mode every kept row carries this board's entry
  // (`adpBoardRows` filters on it); the local is what lets the cells below read
  // it without re-asserting that.
  const sole = player[soleBoard];

  return (
    <li
      aria-setsize={count}
      aria-posinset={rank}
      className={`absolute inset-x-0 top-0 grid ${both ? BOARD_COLUMNS_BOTH : BOARD_COLUMNS_ONE} items-center gap-2 border-t border-foreground/[0.04] px-1 py-1.5 text-sm`}
      // Positioned by transform rather than `top`, so scrolling past a row
      // doesn't dirty layout for the rows that didn't move.
      style={{ height: ADP_ROW_HEIGHT, transform: `translateY(${offset}px)` }}
    >
      <span className="text-right text-xs tabular-nums text-foreground/35">
        {rank}
      </span>
      <span className="truncate">
        {player.name}
        {player.team && (
          <span className="ml-1.5 text-xs text-foreground/35">{player.team}</span>
        )}
      </span>
      <PositionBadge position={player.position} />
      {both ? (
        <>
          <AdpCell entry={player.redraft} board="redraft" drafts={redraftDrafts} />
          <AdpCell entry={player.dynasty} board="dynasty" drafts={dynastyDrafts} />
          <ValueCell entry={player.redraft} teams={teams} steepness={steepness} collapsible />
          <ValueCell entry={player.dynasty} teams={teams} steepness={steepness} collapsible />
        </>
      ) : (
        <>
          <AdpCell entry={sole} board={soleBoard} drafts={soleDrafts} />
          {/* Of the drafts on this board, not of every draft crawled — which is
              what makes it readable beside the ADP. */}
          <span className="text-right text-xs tabular-nums text-foreground/40">
            {takenShare(sole, soleDrafts)}
          </span>
          <ValueCell entry={sole} teams={teams} steepness={steepness} />
        </>
      )}
    </li>
  );
});

/**
 * One board's average for one row. Null is an em dash, never a zero — the
 * board took this player in too few drafts to average, which is a different
 * answer from a bad pick. The hover carries what the Taken column says in
 * single-board mode, so nothing is lost when both boards are up and that
 * column has stepped aside.
 */
function AdpCell({
  entry,
  board,
  drafts,
}: {
  entry: AdpBoardStats | null;
  board: AdpBoardType;
  drafts: number | null;
}) {
  if (!entry) {
    return <span className="text-right text-xs text-foreground/25">—</span>;
  }
  return (
    <span
      className="text-right font-semibold tabular-nums"
      title={adpCellTitle(entry, board, drafts)}
    >
      {entry.adp.toFixed(1)}
    </span>
  );
}

/**
 * The draft-capital preview for one board's average. The rail under the number
 * is what makes the slider legible: the shape of the whole column bends as the
 * curve does, where a row of digits only moves for the reader checking one.
 * `collapsible` is the both-boards spelling, seated only from `@md` up — see
 * `BOARD_COLUMNS_BOTH` for the arithmetic.
 */
function ValueCell({
  entry,
  teams,
  steepness,
  collapsible = false,
}: {
  entry: AdpBoardStats | null;
  teams: AdpControls["teams"];
  steepness: number;
  collapsible?: boolean;
}) {
  const seat = collapsible ? "hidden @md:block" : "";
  if (!entry) {
    return <span className={`${seat} text-right text-xs text-foreground/25`}>—</span>;
  }
  const value = previewAdpValue(entry.adp, teams, steepness);
  return (
    <span className={`${seat} relative text-right text-xs tabular-nums text-active/80`}>
      {value.toLocaleString()}
      <span
        aria-hidden
        className="absolute inset-x-0 -bottom-0.5 h-px bg-active/45"
        style={{ transform: `scaleX(${value / ADP_PEAK})`, transformOrigin: "right" }}
      />
    </span>
  );
}
