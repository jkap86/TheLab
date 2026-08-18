"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AdpBoardType } from "@/shared/manager";

import {
  type AdpControls,
  adpListIdentity,
  previewDraftTeams,
} from "../../adp-controls";
import { adpBoardEntries, adpPickRows, pickDiscountBoard } from "../../adp-picks";
import {
  type AdpSort,
  type AdpSortColumn,
  DEFAULT_ADP_SORT,
  isValueSort,
  nextAdpSort,
  resolveAdpSort,
  sortAdpEntries,
} from "../../adp-sort";
import type { LeagueScope } from "../../league-scope";
import type { AdpState } from "../../use-adp";
import { AdpBoardHeader } from "./adp-board-header";
import { AdpBoardRows } from "./adp-board-rows";
import {
  AdpBoardEmpty,
  AdpBoardError,
  AdpBoardNoRows,
} from "./adp-board-empty-state";
import { EMPTY_PICK_KTC, EMPTY_PLAYERS } from "./adp-drawer.constants.ts";
import { soleBoardOf } from "./adp-drawer.utils.ts";

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
  scope,
  classSeason,
  steepness,
  today,
}: {
  board: AdpState;
  controls: AdpControls;
  /**
   * The league rules' *answer* — which crawled leagues the board is narrowed to.
   *
   * Read for one thing only: whether the list in front of the reader has become
   * a different list. Two rule sets that leave the same leagues are one board, so
   * it is the resolved scope and not `controls.leagueRules` that belongs in
   * {@link adpListIdentity} — the same reason the cache key inlines the ids.
   */
  scope: LeagueScope;
  /**
   * The season the rookies on this board belong to — the active one, which is
   * the class `AdpPlayerPayload.rookie` names whatever season the board is cut
   * to. It is what the numbered pick rows are labelled with, and the line past
   * which a pick is a *future* pick and gets discounted.
   */
  classSeason: string;
  /** The curve being previewed, which is the committed one unless a drag is on. */
  steepness: number;
  /**
   * Today, `YYYY-MM-DD`, as the drawer resolved it — the same value the window
   * control reads. Only the list's identity uses it, and only so a relative
   * window resolves to the dates the board was actually fetched with.
   */
  today: string;
}) {
  const players = board.data?.players ?? EMPTY_PLAYERS;
  const pickKtc = board.data?.pick_ktc ?? EMPTY_PICK_KTC;

  // The picks the board lists — the current class numbered out of the size the
  // curve is previewed on, and the seasons past it a round at a time.
  //
  // **Memoised apart from the steepness**, which is the whole reason a pick row
  // carries an average and a discount rather than a value: the slider is dragged
  // a notch at a time and reorders nothing, so the rows it moves are the cells,
  // never this list. `adpPickRows` reads no curve at all.
  const teams = previewDraftTeams(controls.leagueRules);
  const superflex = pickDiscountBoard(controls.leagueRules);
  const picks = useMemo(
    () => adpPickRows({ players, ktcPicks: pickKtc, classSeason, teams, superflex }),
    [players, pickKtc, classSeason, teams, superflex],
  );
  const rows = useMemo(
    () => adpBoardEntries(players, picks, controls.boards),
    [players, picks, controls.boards],
  );
  const shownPlayers = useMemo(
    () => rows.reduce((n, row) => (row.kind === "player" ? n + 1 : n), 0),
    [rows],
  );

  const both = controls.boards === "both";
  const soleBoard: AdpBoardType = soleBoardOf(controls.boards);

  // What the reader has ordered the list on, defaulting to the board's own
  // merge. It lives here rather than on `AdpControls` because it is a fact about
  // *this list on screen*: that store is shared with the trades board and the
  // lineup checker, is seeded from a league, and drives four priced reads — none
  // of which has any business changing because somebody sorted a column. It
  // survives a filter change on purpose (a reader sorting by KTC and then
  // narrowing the population is still asking the same question) and dies with
  // the drawer, which unmounts on close.
  const [sort, setSort] = useState<AdpSort>(DEFAULT_ADP_SORT);
  // Resolved against what this mode actually draws, so toggling a board off
  // cannot leave the list ordered on a column that has left the screen — see
  // `resolveAdpSort` for why this is read at render rather than written back.
  const activeSort = resolveAdpSort(sort, both, soleBoard);
  const handleSort = useCallback(
    (column: AdpSortColumn) => setSort((current) => nextAdpSort(current, column)),
    [],
  );

  // Only a value sort reads the curve, so only a value sort re-sorts under the
  // slider — otherwise every one of the ~24 notches across a drag would re-key
  // and re-order a thousand rows for an ordering the curve cannot change.
  const sortSteepness = isValueSort(activeSort) ? steepness : 0;
  const sorted = useMemo(
    () =>
      sortAdpEntries(rows, activeSort, {
        soleBoard,
        rules: controls.leagueRules,
        steepness: sortSteepness,
      }),
    [rows, activeSort, soleBoard, controls.leagueRules, sortSteepness],
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
  const identity = useMemo(
    () => adpListIdentity(controls, scope, today),
    [controls, scope, today],
  );
  useEffect(() => {
    // `auto`, never smooth: this is not a gesture the reader made, and a glide
    // under a list that is being replaced is two motions fighting.
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    // A press on a heading is the same event as a filter press for this
    // purpose: the rows under the reader are about to be different rows, and
    // staying at row four hundred is exactly the failure the identity reset
    // above exists to prevent. `activeSort` is a fresh object only when a
    // heading is pressed, so this fires on the press and on nothing else.
  }, [identity, activeSort]);

  const {
    redraft_drafts,
    dynasty_drafts,
    redraft_auctions,
    dynasty_auctions,
    player_count,
  } = board.data ?? {
    redraft_drafts: null,
    dynasty_drafts: null,
    redraft_auctions: null,
    dynasty_auctions: null,
    player_count: null,
  };
  const soleDrafts = soleBoard === "dynasty" ? dynasty_drafts : redraft_drafts;
  // Read off the same board and deliberately not off the same field: the Bid
  // column averages the draft type this board never does, so its denominator is
  // its own count and quoting `soleDrafts` there would state a sample the number
  // was not taken over.
  const soleAuctions = soleBoard === "dynasty" ? dynasty_auctions : redraft_auctions;

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
            soleBoard={soleBoard}
            soleDrafts={soleDrafts}
            soleAuctions={soleAuctions}
            redraftDrafts={redraft_drafts}
            dynastyDrafts={dynasty_drafts}
            rules={controls.leagueRules}
            sort={activeSort}
            refreshing={board.stale}
            onSort={handleSort}
          />
          {/* `keepPreviousData` holds these rows through a filter change, so
              while `stale` they are the *previous* board's answer wearing the
              new filters' header. Dimming them — the trades board's own
              treatment of its held count — is what keeps that honest without
              the flash an emptied list would be; the rows stay readable and
              the scroll stays live, so nothing about the drawer stops
              responding. `aria-busy` says the same thing to a screen reader,
              and the "Updating" mark in the sticky head above says it in
              words. A background refetch of the *same* board never dims:
              `stale` is placeholder data only, never `loading`. */}
          <div
            aria-busy={board.stale || undefined}
            className={`transition-opacity duration-200 ${board.stale ? "opacity-40" : ""}`}
          >
            {sorted.length === 0 ? (
              <AdpBoardNoRows board={soleBoard} />
            ) : (
              <AdpBoardRows
                rows={sorted}
                scrollRef={scrollRef}
                both={both}
                soleBoard={soleBoard}
                soleDrafts={soleDrafts}
                soleAuctions={soleAuctions}
                redraftDrafts={redraft_drafts}
                dynastyDrafts={dynasty_drafts}
                rules={controls.leagueRules}
                steepness={steepness}
              />
            )}
            {player_count !== null && player_count > players.length && (
              <p className="px-1 pt-2 text-xs text-foreground/35">
                {/* Player rows, not every row: the picks in this list are derived
                    from the rookies already on it, so counting them would put the
                    numerator above a denominator that only ever counts players. */}
                Showing {shownPlayers.toLocaleString()} of{" "}
                {player_count.toLocaleString()} players matching these filters.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
