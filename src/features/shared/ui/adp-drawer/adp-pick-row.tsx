import { memo } from "react";

import type { AdpBoardType } from "@/shared/manager";

import { previewAdpValue } from "../../adp-controls";
import type { LeagueFilters } from "../../league-filters";
import type { AdpPickRow as AdpPick, AdpPickStats } from "../../adp-picks";
import { ordinal } from "../../format";
import { AdpCell, KtcCell, ValueCell } from "./adp-board-cells";
import { BOARD_ROW_CLASS, ADP_ROW_HEIGHT } from "./adp-drawer.constants.ts";
import {
  PICK_TAKEN_TITLE,
  ktcPickTitle,
  pickCellTitle,
  pickValueTitle,
} from "./adp-drawer.utils.ts";

/**
 * One draft pick's row, in the same list and the same grid as the players.
 *
 * **In the list rather than beside it**, because a pick's number *is* a player's
 * number: it reads the average of the rookie its rung takes, so it belongs
 * exactly where that rookie sits and nowhere else. A separate table would have
 * to invent a second ordering for a column that already has one.
 *
 * What it draws differently is only what a pick genuinely differs in. The
 * position pill carries the **round** rather than a position, since a pick has
 * none and the round is the fact a reader scans a column of picks for. The Taken
 * column is an em dash with a hover saying why — a pick was taken in none of
 * these drafts, which is not a gap in the data. And the value carries the
 * future-season discount the ADP beside it deliberately does not, so the two
 * columns can disagree by design; both hovers say so.
 *
 * Memoised on the same terms as the player row: primitives and the row's own
 * object, no callbacks, and an `offset` rather than a style object.
 */
export const AdpPickBoardRow = memo(function AdpPickBoardRow({
  pick,
  rank,
  count,
  offset,
  both,
  soleBoard,
  rules,
  steepness,
}: {
  pick: AdpPick;
  /** The row's place in the display's order. */
  rank: number;
  /** How long the whole list is — only a windowful of rows is in the DOM. */
  count: number;
  /** Where this row sits down the list, in px from the list's own top. */
  offset: number;
  both: boolean;
  soleBoard: AdpBoardType;
  /** The board's league rules — what the value cell's pool is anchored to. */
  rules: LeagueFilters;
  steepness: number;
}) {
  const sole = pick[soleBoard];

  const value = (stats: AdpPickStats | null) =>
    stats === null
      ? null
      : Math.round(previewAdpValue(stats.adp, rules, steepness) * stats.discount);

  return (
    <li
      aria-setsize={count}
      aria-posinset={rank}
      className={BOARD_ROW_CLASS(both)}
      style={{ height: ADP_ROW_HEIGHT, transform: `translateY(${offset}px)` }}
    >
      <span className="text-right text-xs tabular-nums text-foreground/35">
        {rank}
      </span>
      <span className="truncate">
        {pick.label}
        {/* Whose place this is, but only where there is one answer to give: with
            both markets up the two ladders name two different rookies, and each
            ADP cell's own hover says which. */}
        {!both && sole && (
          <span className="ml-1.5 text-xs text-foreground/35">{sole.player}</span>
        )}
      </span>
      {/* The position column, carrying the round — a pick has no position, and
          `–` there would waste the one column a list of picks is scanned on. */}
      <span className="inline-flex w-8 shrink-0 items-center justify-center rounded bg-active/15 px-1 py-0.5 text-[0.65rem] font-bold text-active/85">
        {ordinal(pick.round)}
      </span>
      {both ? (
        <>
          <AdpCell adp={pick.redraft?.adp ?? null} title={cellTitle(pick.redraft, "redraft")} />
          <AdpCell adp={pick.dynasty?.adp ?? null} title={cellTitle(pick.dynasty, "dynasty")} />
          <ValueCell
            value={value(pick.redraft)}
            title={pick.redraft ? pickValueTitle(rules, pick, pick.redraft) : undefined}
            collapsible
          />
          <ValueCell
            value={value(pick.dynasty)}
            title={pick.dynasty ? pickValueTitle(rules, pick, pick.dynasty) : undefined}
            collapsible
          />
        </>
      ) : (
        <>
          <AdpCell adp={sole?.adp ?? null} title={cellTitle(sole, soleBoard)} />
          <span
            className="text-right text-xs tabular-nums text-foreground/25"
            title={PICK_TAKEN_TITLE}
          >
            —
          </span>
          <ValueCell
            value={value(sole)}
            title={sole ? pickValueTitle(rules, pick, sole) : undefined}
          />
        </>
      )}
      {/* KTC's own price for the pick, not this board's reading of one. The ADP
          cells beside it are the *rung* — the rookie the pick returns, averaged
          out of the drafts on screen — which is this app's arithmetic; a column
          headed KTC has to carry KTC's number or it is putting one under the
          other's name. See `AdpPickRow.ktc`. */}
      <KtcCell
        value={pick.ktc?.sf ?? null}
        title={ktcPickTitle(pick.label, pick.ktcExact)}
      />
      <KtcCell
        value={pick.ktc?.oneqb ?? null}
        title={ktcPickTitle(pick.label, pick.ktcExact)}
      />
    </li>
  );
});

/** The rung and the discount behind a number, or nothing where there is none. */
function cellTitle(
  stats: AdpPickStats | null,
  board: AdpBoardType,
): string | undefined {
  return stats ? pickCellTitle(stats, board) : undefined;
}
