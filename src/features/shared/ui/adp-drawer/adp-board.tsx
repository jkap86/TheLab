"use client";

import { useEffect, useMemo, useRef } from "react";

import type { AdpBoardType } from "@/shared/manager";

import {
  type AdpControls,
  adpBoardRows,
  adpListIdentity,
  shownAdpBoards,
} from "../../adp-controls";
import type { AdpState } from "../../use-adp";
import { AdpBoardHeader } from "./adp-board-header";
import { AdpBoardRows } from "./adp-board-rows";
import {
  AdpBoardEmpty,
  AdpBoardError,
  AdpBoardNoRows,
} from "./adp-board-empty-state";
import { EMPTY_PLAYERS } from "./adp-drawer.constants.ts";
import { soleBoardOf, withBoardToggle } from "./adp-drawer.utils.ts";

/**
 * The list itself — the one part of the drawer that scrolls.
 *
 * It owns the display's own ordering rather than taking rows from above,
 * because the ordering is a fact about what is *drawn*: the fetch's order is
 * fair to both markets and therefore right for neither column alone, so
 * `adpBoardRows` re-sorts for the boards on screen and {@link AdpBoardRows}
 * renumbers as it renders.
 *
 * **Its scroll box is bounded rather than merely scrollable, and that is half of
 * why this list used to feel stuck.** The box was `flex-1` with no `min-h-0`,
 * and a flex child's automatic minimum is its own content — so with a thousand
 * rows inside it never shrank into the drawer, its `overflow-y-auto` had nothing
 * left to scroll, the rows ran past the bottom of the panel taking the footer
 * with them, and the wheel reached a page whose scroll the drawer had already
 * locked. The other half is the windowing one level down; neither fixes it
 * alone, since bounded but unwindowed is a thousand rows behind every frame and
 * windowed but unbounded is a spacer nobody can scroll.
 */
export function AdpBoard({
  board,
  controls,
  steepness,
  today,
  onChange,
}: {
  board: AdpState;
  controls: AdpControls;
  /** The curve being previewed, which is the committed one unless a drag is on. */
  steepness: number;
  /**
   * Today, `YYYY-MM-DD`, as the drawer resolved it — the same value the window
   * control reads. Only the list's identity uses it, and only so a relative
   * window resolves to the dates the board was actually fetched with.
   */
  today: string;
  onChange: (controls: AdpControls) => void;
}) {
  const players = board.data?.players ?? EMPTY_PLAYERS;
  const rows = useMemo(
    () => adpBoardRows(players, controls.boards),
    [players, controls.boards],
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // Back to the top whenever the board becomes a *different board*. The query is
  // held with `keepPreviousData`, which is what keeps the old rows on screen
  // through the fetch — and is exactly what leaves a reader four hundred rows
  // deep in a list about to be seventy-five rows long in a different order.
  // Resetting on the press rather than on the arrival is the point: a beat of
  // the old board's first rows is the honest thing to show, where a preserved
  // offset lands the reader among players nobody asked for.
  //
  // Keyed on a string, deliberately — `controls` is a fresh object on every
  // change including the ones that must *not* reset, and `adpListIdentity` is
  // where that distinction is drawn and tested. The steepness is the one it
  // keeps out: it is dragged a notch at a time while the reader watches one
  // player's value bend, and it reorders nothing.
  const identity = useMemo(() => adpListIdentity(controls, today), [controls, today]);
  useEffect(() => {
    // `auto`, never smooth: this is not a gesture the reader made, and a glide
    // under a list that is being replaced is two motions fighting.
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [identity]);

  const { redraft_drafts, dynasty_drafts, player_count } = board.data ?? {
    redraft_drafts: null,
    dynasty_drafts: null,
    player_count: null,
  };
  const shown = shownAdpBoards(controls.boards);
  const both = controls.boards === "both";
  const soleBoard: AdpBoardType = soleBoardOf(controls.boards);
  const soleDrafts = soleBoard === "dynasty" ? dynasty_drafts : redraft_drafts;

  return (
    // `min-h-0` is the load-bearing one — see the note above.
    // `overscroll-contain` keeps a flick at either end from chaining into the
    // page behind the drawer, the same rule the league panel's scroll boxes and
    // the subject rail's results keep. The stable gutter keeps the columns from
    // stepping sideways as a filter takes the list either side of the height
    // that needs a scrollbar.
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 [scrollbar-gutter:stable]"
    >
      {board.error ? (
        <AdpBoardError message={board.error} />
      ) : players.length === 0 ? (
        <AdpBoardEmpty loading={board.loading} />
      ) : (
        <>
          {/* Sticky, and a sibling *before* the windowed list rather than part
              of it: inside the spacer it would be positioned along with the
              rows and stop sticking, and a column of bare numbers three hundred
              rows down is what it is there to name. */}
          <AdpBoardHeader
            both={both}
            shown={shown}
            soleBoard={soleBoard}
            soleDrafts={soleDrafts}
            redraftDrafts={redraft_drafts}
            dynastyDrafts={dynasty_drafts}
            teams={controls.teams}
            onToggleBoard={(next) => onChange(withBoardToggle(controls, next))}
          />
          {rows.length === 0 ? (
            <AdpBoardNoRows board={soleBoard} />
          ) : (
            <AdpBoardRows
              rows={rows}
              scrollRef={scrollRef}
              both={both}
              soleBoard={soleBoard}
              soleDrafts={soleDrafts}
              redraftDrafts={redraft_drafts}
              dynastyDrafts={dynasty_drafts}
              teams={controls.teams}
              steepness={steepness}
            />
          )}
          {player_count !== null && player_count > players.length && (
            <p className="px-1 pt-2 text-xs text-foreground/35">
              Showing {rows.length.toLocaleString()} of{" "}
              {player_count.toLocaleString()} players matching these filters.
            </p>
          )}
        </>
      )}
    </div>
  );
}
