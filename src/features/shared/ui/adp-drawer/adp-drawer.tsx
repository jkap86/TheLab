"use client";

import { useId, useMemo, useRef, useState } from "react";

import type { ManagerLeague } from "@/shared/manager";

import { type AdpControls, seasonOptions, todayIso } from "../../adp-controls";
import { useReturnFocus } from "../../use-return-focus";
import type { AdpState } from "../../use-adp";
import type { AdpDensityState } from "../../use-adp-density";
import { AdpBoard } from "./adp-board";
import { AdpDrawerFooter } from "./adp-drawer-footer";
import { AdpDrawerHeader } from "./adp-drawer-header";
import { AdpFilterBar } from "./adp-filter-bar";
import { AdpRangeControl } from "./adp-range-control";
import { SteepnessSlider } from "./adp-steepness-slider";
import {
  ADP_DRAWER_ENTER_MS,
  ADP_DRAWER_EXIT_MS,
  EMPTY_LEAGUES,
  FIXED_FILTERS,
} from "./adp-drawer.constants.ts";
import type { FilterSpec } from "./adp-drawer.types.ts";
import { leagueSizeFilter, withSeason } from "./adp-drawer.utils.ts";
import { useAdpDrawerLifecycle } from "./use-adp-drawer-lifecycle.ts";

/**
 * The ADP board: which crawled drafts the average is taken over, and the board
 * those settings produce.
 *
 * A right-hand drawer rather than a bar on the page, because the settings are
 * set once and read rarely while the page under them is what a visitor came for.
 * The controls are pinned at the top and only the board scrolls, which is the
 * whole point of the shape: changing a filter and watching the ADP move is one
 * glance, where a stacked panel puts the board below the fold on a laptop. That
 * is also why the filters are chips rather than eight labelled selects — the
 * pinned block has to stay short enough to leave the board room.
 *
 * The board is fetched by the caller and passed in, gated on `open`, so a closed
 * drawer costs nothing.
 *
 * This file is the composition root and holds only what the whole drawer shares:
 * the lifecycle (through {@link useAdpDrawerLifecycle}), the curve being
 * previewed, and the two derived lists — the seasons on offer and the filter
 * table — that more than one section reads. Everything with markup of its own
 * lives beside it in this folder.
 */
export function AdpDrawer({
  open,
  onClose,
  controls,
  onChange,
  onReset,
  defaultSeason,
  leagues,
  seedLeagues = EMPTY_LEAGUES,
  board,
  density,
}: {
  open: boolean;
  onClose: () => void;
  controls: AdpControls;
  onChange: (controls: AdpControls) => void;
  /** Back to the default board — held by the store, which owns what "default" is. */
  onReset: () => void;
  /** The season a board opens on; decides which relative presets can mean anything. */
  defaultSeason: string;
  /**
   * The population the **size filter's** options are read off — the sizes that
   * actually occur, so a chosen size always matches something.
   */
  leagues: readonly ManagerLeague[];
  /**
   * Leagues offered to "Match a league…", which seeds the board's settings from
   * one of them. **Only leagues the reader plays in belong here**, which is why
   * it is separate from `leagues` above rather than the same list twice.
   *
   * The manager tabs pass their manager's leagues; the trades board passes
   * nothing, and the control is not drawn there. It reads as a list that is
   * merely longer and is a different control: seeding is a *shortcut* — you pick
   * the league by name because you know it and know its settings — and the
   * trades board's population is every crawled league in the season, alphabetised
   * strangers you cannot recognise, let alone have an opinion about the settings
   * of. Every other filter in this drawer describes the market and works there
   * unchanged; this one describes the reader, and there is no reader on that page.
   */
  seedLeagues?: readonly ManagerLeague[];
  /** The board these controls produce; `data` is null until the first load lands. */
  board: AdpState;
  /** Crawled drafts per month and season, for the window control's density. */
  density: AdpDensityState;
}) {
  const { onScreen, closing, panelRef, openPanel, togglePanel } =
    useAdpDrawerLifecycle({ open, onClose });

  // The footer's premise line, as the dialog's description: a board priced on an
  // assumed pool is exactly the caveat a reader should hear on arrival rather
  // than have to find at the bottom of a panel that scrolls.
  const premiseId = useId();

  // The filter tray's id and its trigger. They live here rather than in
  // `AdpFilterBar` because *this* is where the tray is closed from — Escape goes
  // through the lifecycle hook's document listener — so this is where the focus
  // has to be put back; and because keeping that section a pure function of its
  // props is what lets `adp-drawer.render.test` call it directly.
  const filterTrayId = useId();
  const filterTrigger = useRef<HTMLButtonElement>(null);
  useReturnFocus(openPanel === "filters", filterTrigger);

  // The curve the slider is *currently* sitting on, while it is being dragged.
  // The preview below has to re-price on every notch — watching the board bend
  // is the whole reason the curve is a slider — but the committed value re-fetches
  // every league's team value on the Leagues tab behind this drawer, so the store
  // only moves when the handle is let go. Null means nothing is being dragged.
  const [dragging, setDragging] = useState<number | null>(null);
  const steepness = dragging ?? controls.steepness;

  // The seasons on offer and the density behind the window are both slices of
  // the one density read. Memoised on the rows so the panel's own domain memo
  // isn't invalidated by a fresh array every render.
  const seasons = useMemo(
    () => seasonOptions(density.months, controls.season, defaultSeason),
    [density.months, controls.season, defaultSeason],
  );
  // The size filter is the one whose options are data, so the table is completed
  // here rather than at module scope. Memoised because the filter bar walks it on
  // every render to decide what is narrowing the board.
  const filters = useMemo<readonly FilterSpec[]>(
    () => [...FIXED_FILTERS, leagueSizeFilter(leagues)],
    [leagues],
  );

  const seasonMonths = useMemo(
    () =>
      controls.season === "all"
        ? density.months
        : density.months.filter((m) => m.season === controls.season),
    [density.months, controls.season],
  );

  if (!onScreen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="Close ADP board"
        // A pointer target and nothing else. It is a sibling of the dialog
        // rather than a child, so a tab stop here is a stop *outside* the modal
        // — and it says nothing the header's own close key and Escape don't.
        tabIndex={-1}
        onClick={onClose}
        // The marker class is what the reduced-motion block and the
        // pointer-events rule address; `data-closing` is the state those rules
        // read, absent rather than `false` since CSS matches on presence.
        data-closing={closing ? "" : undefined}
        className="adp-drawer-scrim absolute inset-0 bg-[rgb(4,10,16)]/70 backdrop-blur-[1px]"
        style={{
          animation: closing
            ? `adp-scrim-out ${ADP_DRAWER_EXIT_MS}ms ease-in forwards`
            : `adp-scrim-in ${ADP_DRAWER_ENTER_MS}ms ease-out`,
        }}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="ADP board"
        aria-describedby={premiseId}
        tabIndex={-1}
        data-closing={closing ? "" : undefined}
        // `@container`, so the board's value columns key off the panel's own
        // width rather than the viewport's — the panel is narrower than the
        // screen everywhere a laptop is involved. The panel carries no
        // `@`-variant of its own, which is what keeps that safe (an element is
        // never its own query container).
        className="adp-drawer-panel @container relative ml-auto flex h-full w-full max-w-[32rem] flex-col border-l border-active/20 bg-[rgb(12,23,33)] shadow-[-24px_0_60px_rgba(0,0,0,0.5)] outline-none"
        // `forwards` on the way out, so the panel holds off screen for the beat
        // between the animation ending and the unmount rather than snapping
        // back into view for a frame.
        style={{
          animation: closing
            ? `adp-drawer-out ${ADP_DRAWER_EXIT_MS}ms cubic-bezier(0.4, 0, 1, 1) forwards`
            // A gentler decelerate than the entrance curves elsewhere in the
            // app, because it is running over twice their duration: an
            // out-quint spends four fifths of its travel in the first third,
            // which at this length reads as a panel that snaps in and then
            // creeps the last few pixels rather than as a slower slide.
            : `adp-drawer-in ${ADP_DRAWER_ENTER_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
        }}
      >
        {/* Pinned: everything that changes the board stays on screen while the
            board itself scrolls under it.

            Three of its four parts are one line each, and every one of them got
            there the same way — by not spending height on a control reporting
            that nothing is set. The identity, the season and the draft count
            share a line, where a header stating a count the trigger already
            carried over a labelled row of season keys was two lines saying what
            fits on one. The filter row draws only the filters actually narrowing
            the board, since seven chips permanently reading "All" are seven
            controls' worth of height saying nothing.

            **The window is the deliberate exception, and it is the one part that
            takes real height.** It was a line too — a trigger and a row of
            presets, with the counter floating over the board on a press — and
            what that bought in pixels it spent on the instrument, which is the
            first thing the drawer is opened to set. It is expanded here for
            good, so the block is taller than the arithmetic above would leave
            it; the board below is what pays, and it scrolls. */}
        <div className="flex flex-col gap-2 border-b border-foreground/10 bg-foreground/[0.02] px-4 py-2">
          <AdpDrawerHeader
            seasons={seasons}
            season={controls.season}
            draftCount={board.data?.draft_count ?? null}
            // The window is dropped with the season, not carried across it —
            // see `withSeason`.
            onSeasonChange={(season) => onChange(withSeason(controls, season))}
            onClose={onClose}
          />

          <AdpRangeControl
            range={controls.range}
            season={controls.season}
            defaultSeason={defaultSeason}
            months={seasonMonths}
            density={density}
            today={todayIso()}
            onChange={(range) => onChange({ ...controls, range })}
          />

          <AdpFilterBar
            controls={controls}
            filters={filters}
            seedLeagues={seedLeagues}
            open={openPanel === "filters"}
            trayId={filterTrayId}
            triggerRef={filterTrigger}
            onToggle={() => togglePanel("filters")}
            onChange={onChange}
          />

          <SteepnessSlider
            value={steepness}
            onPreview={setDragging}
            onCommit={(next) => {
              setDragging(null);
              // A release that didn't move it is not a change: committing it
              // anyway would hand the store a fresh object and re-render the
              // tab behind for nothing.
              if (next !== controls.steepness) {
                onChange({ ...controls, steepness: next });
              }
            }}
          />
        </div>

        <AdpBoard
          board={board}
          controls={controls}
          steepness={steepness}
          onChange={onChange}
        />

        <AdpDrawerFooter
          teams={controls.teams}
          premiseId={premiseId}
          onReset={onReset}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
