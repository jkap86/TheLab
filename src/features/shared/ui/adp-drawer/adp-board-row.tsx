import { memo } from "react";

import type { AdpBoardStats, AdpBoardType } from "@/shared/manager";
import type { AdpPlayerPayload } from "@/shared/contract";

import { previewExpectedAdpValue } from "../../adp-controls";
import type { LeagueFilters } from "../../league-filters";
import { PositionBadge } from "../position-badge";
import { AdpCell, ValueCell } from "./adp-board-cells";
import { BOARD_ROW_CLASS, ADP_ROW_HEIGHT } from "./adp-drawer.constants.ts";
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
  rules,
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
  /** The board's league rules — what the value cell's pool is anchored to. */
  rules: LeagueFilters;
  steepness: number;
}) {
  // In single-board mode every kept row carries this board's entry
  // (`adpBoardRows` filters on it); the local is what lets the cells below read
  // it without re-asserting that.
  const sole = player[soleBoard];

  // The expectation over the drafts behind the average rather than the curve
  // read at that average — the number the cards this previews are summed from,
  // so a drawer showing `v(mean)` over cards summed from `E[v]` would be the
  // two-answers-to-one-question the board and the cards share a curve to stop.
  const value = (entry: AdpBoardStats | null) =>
    entry === null ? null : previewExpectedAdpValue(entry, rules, steepness);

  return (
    <li
      aria-setsize={count}
      aria-posinset={rank}
      className={BOARD_ROW_CLASS(both)}
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
          <AdpCell
            adp={player.redraft?.adp ?? null}
            title={playerAdpTitle(player.redraft, "redraft", redraftDrafts)}
          />
          <AdpCell
            adp={player.dynasty?.adp ?? null}
            title={playerAdpTitle(player.dynasty, "dynasty", dynastyDrafts)}
          />
          <ValueCell value={value(player.redraft)} collapsible />
          <ValueCell value={value(player.dynasty)} collapsible />
        </>
      ) : (
        <>
          <AdpCell adp={sole?.adp ?? null} title={playerAdpTitle(sole, soleBoard, soleDrafts)} />
          {/* Of the drafts on this board, not of every draft crawled — which is
              what makes it readable beside the ADP. */}
          <span className="text-right text-xs tabular-nums text-foreground/40">
            {takenShare(sole, soleDrafts)}
          </span>
          <ValueCell value={value(sole)} />
        </>
      )}
    </li>
  );
});

/** The spread and the sample behind an average, or nothing where there is none. */
function playerAdpTitle(
  entry: AdpBoardStats | null,
  board: AdpBoardType,
  drafts: number | null,
): string | undefined {
  return entry ? adpCellTitle(entry, board, drafts) : undefined;
}
