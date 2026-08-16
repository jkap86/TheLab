"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { AdpBoardType } from "@/shared/manager";

import type { LeagueFilters } from "../../league-filters";
import type { AdpBoardEntry } from "../../adp-picks";
import { AdpBoardRow } from "./adp-board-row";
import { AdpPickBoardRow } from "./adp-pick-row";
import {
  ADP_BOARD_INITIAL_RECT,
  adpRowHeight,
  ADP_ROW_OVERSCAN,
} from "./adp-drawer.constants.ts";

/**
 * The list, windowed: a spacer as tall as the whole board holding only the rows
 * near the reader.
 *
 * **This is what makes a thousand-row board a list rather than a stall.**
 * `/api/adp` answers up to `limit=1000`, and every one of those rows was a
 * six-column grid mounted at once — tens of thousands of nodes, laid out and
 * repainted, behind a panel whose whole premise is that changing a filter and
 * watching the board move is one glance.
 *
 * It is a component of its own rather than part of {@link AdpBoard}, and that is
 * a scroll cost rather than tidiness. The virtualizer notifies React on
 * `[isScrolling, startIndex, endIndex]`, so whatever holds it re-renders every
 * time the window crosses a row boundary — at 33px a row, many times a second
 * under a flick. Held one level up, each of those renders also rebuilt the board
 * head: two keys, seven headings and the three hover strings behind them, none
 * of which a scroll can change. Down here the notification reaches the rows and
 * nothing else.
 *
 * The rows themselves are `memo`'d and every prop they take is a primitive or
 * the row's own payload object, so a notification that leaves the window's
 * contents unchanged re-renders none of them.
 */
export function AdpBoardRows({
  rows,
  scrollRef,
  both,
  soleBoard,
  soleDrafts,
  redraftDrafts,
  dynastyDrafts,
  rules,
  steepness,
}: {
  /**
   * The display's own ordering, which is what the ranks below count down —
   * players and the picks that stand on them, interleaved by `adpBoardEntries`.
   */
  rows: readonly AdpBoardEntry[];
  /**
   * The board's scroll box, which belongs to {@link AdpBoard} — it is the one
   * element that is there whether or not there are rows to draw, and it is what
   * the reset on a filter change scrolls.
   */
  scrollRef: RefObject<HTMLDivElement | null>;
  both: boolean;
  soleBoard: AdpBoardType;
  soleDrafts: number | null;
  redraftDrafts: number | null;
  dynastyDrafts: number | null;
  /** The board's league rules, threaded to the rows' value cells. */
  rules: LeagueFilters;
  steepness: number;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // How much of the scroll box sits above the list — its own top padding plus
  // the sticky board head. The virtualizer measures rows from the *list's* top
  // while the offset it compares them against is the box's `scrollTop`, so
  // without this the window it computes is that far behind the visible one.
  //
  // A plain effect rather than a layout one, which is safe here rather than
  // sloppy: `getTotalSize()` and each row's `start - scrollMargin` are both
  // invariant to this number, so a late measurement moves nothing on screen —
  // it only sharpens which rows count as visible, and the overscan covers the
  // gap meanwhile. It also keeps this renderable on a server, where a layout
  // effect is a warning and nothing else.
  //
  // The observer watches the **scroll box**, whose box changes with the drawer
  // and never with the list inside it — so it fires when the head can actually
  // rewrap, and not once per row the list gains. Mounting covers the rest: this
  // component is rendered only when there are rows, so a board that goes empty
  // and comes back measures again on the way in.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;

    const measure = () => {
      const el = listRef.current;
      const outer = scrollRef.current;
      if (!el || !outer) return;
      const next =
        el.getBoundingClientRect().top -
        outer.getBoundingClientRect().top +
        outer.scrollTop;
      // `ResizeObserver` fires once on `observe`, so this runs twice on mount;
      // an unguarded set is a render loop.
      setScrollMargin((prev) => (prev === next ? prev : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [scrollRef]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    // Fixed, never measured — a row cannot be another height (see
    // `adpRowHeight`), so measuring would buy nothing and cost a
    // `getBoundingClientRect` per row per pass.
    estimateSize: () => adpRowHeight(),
    // Keyed by the row's subject rather than the index, so nothing the
    // virtualizer holds about a row survives a filter change that reshuffles
    // the board. A pick's key is prefixed, so it cannot collide with the player
    // id a player row is keyed by.
    getItemKey: (index) => rows[index].key,
    overscan: ADP_ROW_OVERSCAN,
    scrollMargin,
    initialRect: ADP_BOARD_INITIAL_RECT,
  });

  return (
    // As tall as the whole list, so the scrollbar describes the board rather
    // than the window. `relative` is what the rows are positioned against — and
    // it opens no stacking context of its own, so the head above goes on
    // painting over them on its `z-10`.
    <ul ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index];
        // The shared props first, so the two kinds of row cannot drift on the
        // things that place them: a pick sits in the same grid at the same
        // height as the player it stands on, or the offsets stop being true.
        const seat = {
          rank: item.index + 1,
          count: rows.length,
          offset: item.start - scrollMargin,
          both,
          soleBoard,
          rules,
          steepness,
        };
        return row.kind === "pick" ? (
          <AdpPickBoardRow key={row.key} pick={row.pick} {...seat} />
        ) : (
          <AdpBoardRow
            key={row.key}
            player={row.player}
            {...seat}
            soleDrafts={soleDrafts}
            redraftDrafts={redraftDrafts}
            dynastyDrafts={dynastyDrafts}
          />
        );
      })}
    </ul>
  );
}
