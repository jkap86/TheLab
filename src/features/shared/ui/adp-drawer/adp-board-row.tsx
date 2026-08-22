import { memo } from "react";

import type {
  AdpAuctionStats,
  AdpBoardStats,
  AdpBoardType,
} from "@/shared/manager";
import type { AdpPlayerPayload } from "@/shared/contract";

import { previewAdpValue } from "../../adp-controls";
import type { LeagueFilters } from "../../league-filters";
import { PositionBadge } from "../position-badge";
import { AdpCell, AuctionCell, ValueCell } from "./adp-board-cells";
import { BOARD_ROW_CLASS, adpRowHeight } from "./adp-drawer.constants.ts";
import {
  type AdpBoardCounts,
  adpCellTitle,
  auctionCellTitle,
  auctionShare,
  takenShare,
} from "./adp-drawer.utils.ts";

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
 * than left to the content for the reason {@link adpRowHeight} documents: the
 * offsets are multiples of that constant, so the element has to be exactly it.
 */
export const AdpBoardRow = memo(function AdpBoardRow({
  player,
  rank,
  count,
  offset,
  both,
  soleBoard,
  counts,
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
  /**
   * The denominators this row's hovers state, per market — the drafts an ADP
   * was averaged over and the auctions a bid was, which are two populations.
   * One object rather than four props because the memo compares by identity and
   * the caller holds it in a `useMemo`.
   */
  counts: AdpBoardCounts;
  /** The board's league rules — what the value cell's pool is anchored to. */
  rules: LeagueFilters;
  steepness: number;
}) {
  // In single-board mode every kept row carries this board's entry
  // (`adpBoardRows` filters on it); the local is what lets the cells below read
  // it without re-asserting that.
  const sole = player[soleBoard];
  // The auction reading is *not* filtered on — a player the crawled auctions
  // never bought is a normal row with an em dash in one column, not a row the
  // board should drop.
  const soleBid = player.auction[soleBoard];

  const value = (entry: AdpBoardStats | null) =>
    entry === null ? null : previewAdpValue(entry.adp, rules, steepness);

  return (
    <li
      aria-setsize={count}
      aria-posinset={rank}
      className={BOARD_ROW_CLASS(both)}
      // Positioned by transform rather than `top`, so scrolling past a row
      // doesn't dirty layout for the rows that didn't move.
      style={{ height: adpRowHeight(), transform: `translateY(${offset}px)` }}
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
          {/* The share still rides on these hovers as well as on its own cells:
              the Bid pair is seated at `@lg`, so below that tier the ADP cell is
              where the reading is stated — the same call the Taken share makes. */}
          <AdpCell
            adp={player.redraft?.adp ?? null}
            title={playerAdpTitle(
              player.redraft,
              "redraft",
              counts.redraft.drafts,
              player.auction.redraft,
            )}
          />
          <AdpCell
            adp={player.dynasty?.adp ?? null}
            title={playerAdpTitle(
              player.dynasty,
              "dynasty",
              counts.dynasty.drafts,
              player.auction.dynasty,
            )}
          />
          <ValueCell value={value(player.redraft)} collapsible />
          <ValueCell value={value(player.dynasty)} collapsible />
          <AuctionCell
            label={auctionShare(player.auction.redraft)}
            title={bidTitle(player.auction.redraft, "redraft", counts)}
            paired
          />
          <AuctionCell
            label={auctionShare(player.auction.dynasty)}
            title={bidTitle(player.auction.dynasty, "dynasty", counts)}
            paired
          />
        </>
      ) : (
        <>
          <AdpCell
            adp={sole?.adp ?? null}
            title={playerAdpTitle(sole, soleBoard, counts[soleBoard].drafts, soleBid)}
          />
          {/* Of the drafts on this board, not of every draft crawled — which is
              what makes it readable beside the ADP. */}
          <span className="text-right text-xs tabular-nums text-foreground/40">
            {takenShare(sole, counts[soleBoard].drafts)}
          </span>
          <AuctionCell
            label={auctionShare(soleBid)}
            title={bidTitle(soleBid, soleBoard, counts)}
          />
          <ValueCell value={value(sole)} />
        </>
      )}
    </li>
  );
});

/**
 * The spread and the sample behind an average, or nothing where there is none.
 *
 * Gated on the *ADP* entry rather than on either half: with no average there is
 * no cell to hover, so an auction reading alone has nowhere to be said here —
 * the Bid column carries it instead.
 */
function playerAdpTitle(
  entry: AdpBoardStats | null,
  board: AdpBoardType,
  drafts: number | null,
  auction: AdpAuctionStats | null,
): string | undefined {
  return entry ? adpCellTitle(entry, board, drafts, auction) : undefined;
}

/**
 * A Bid cell's hover, or nothing where the crawled auctions never bought him.
 *
 * The em dash is left bare here rather than explained: on a *player* row it is a
 * gap in the sample and says so by being blank, where a pick row's blank is a
 * column that does not apply and needs the hover to say which.
 */
function bidTitle(
  stats: AdpAuctionStats | null,
  board: AdpBoardType,
  counts: AdpBoardCounts,
): string | undefined {
  return stats ? auctionCellTitle(stats, board, counts[board].auctions) : undefined;
}
