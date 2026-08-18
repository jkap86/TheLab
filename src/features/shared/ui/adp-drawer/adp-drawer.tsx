"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import type { ManagerLeague } from "@/shared/manager";

import { type AdpControls, seasonOptions } from "../../adp-controls";
import { useTodayIso } from "../../use-today-iso.ts";
import type { LeagueScope } from "../../league-scope";
import { useReturnFocus } from "../../use-return-focus";
import type { AdpState } from "../../use-adp";
import type { AdpDensityState } from "../../use-adp-density";
import { AdpBay } from "./adp-bay";
import { AdpBayRail } from "./adp-bay-rail";
import { AdpBoard } from "./adp-board";
import { AdpDrawerFooter } from "./adp-drawer-footer";
import { AdpDrawerHeader } from "./adp-drawer-header";
import { AdpLeagueFilters } from "./adp-league-filters";
import { AdpRangeControl } from "./adp-range-control";
import { SteepnessSlider } from "./adp-steepness-slider";
import {
  ADP_DRAWER_ENTER_MS,
  ADP_DRAWER_EXIT_MS,
  EMPTY_LEAGUES,
} from "./adp-drawer.constants.ts";
import { type AdpBayId, withSeason } from "./adp-drawer.utils.ts";
import { useAdpDrawerLifecycle } from "./use-adp-drawer-lifecycle.ts";

/**
 * The pinned block's sections, memo'd at the use site rather than at their
 * exports — the render test calls those as plain functions, which `memo`'s
 * wrapper object is not.
 *
 * What the memo is for: the steepness preview (`dragging` below) is this
 * component's own state, so every notch of a drag re-renders the composition
 * root — and the curve only reaches the slider and the board's value cells.
 * Without these, each of the ~24 notches across the slider's travel also
 * rebuilt the rolling draft count, the window channel's bars and the filter
 * tray — none of which a curve can change. Their props are stable through a
 * drag by construction: the store's `controls` hasn't moved, and every handler
 * this file creates is a `useCallback` below.
 *
 * The rail is on that list for a second reason: it is on screen in every state,
 * so it re-renders on every notch of a drag whose value only its own Curve key
 * reads — and that key reads it through `controls`, which does not move until
 * the handle is let go.
 */
const PinnedHeader = memo(AdpDrawerHeader);
const PinnedRail = memo(AdpBayRail);
const PinnedRange = memo(AdpRangeControl);
const PinnedLeagueFilters = memo(AdpLeagueFilters);
const PinnedFooter = memo(AdpDrawerFooter);

/** What each bay's group is called, for a reader who tabs into one. */
const BAY_LABELS: Record<AdpBayId, string> = {
  leagues: "League filters",
  window: "Board window",
  curve: "Value curve",
};

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
  scope,
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
   * The crawled leagues the board's rules run over — every league with a draft
   * this board could average, off `/api/adp/leagues`.
   *
   * It is what the filters dialog counts its options over and what the caller
   * resolved the scope from, so the two describe one population. Empty until it
   * loads, or where nothing has asked for it: with no leagues in hand the rules
   * narrow nothing, which is the honest opening state rather than an empty board.
   *
   * It used to be whatever population the *size chip's* options were read off —
   * the manager's own leagues on one page and the season's traded ones on the
   * other, neither of which is the corpus this board averages.
   */
  leagues: readonly ManagerLeague[];
  /**
   * What the league rules resolved to over those leagues — the caller's, because
   * the caller is what fetches the board with it. The drawer reads it for one
   * thing: whether a filter change has made its list a *different* list.
   */
  scope: LeagueScope;
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
  // Which bay is floating over the board, or none.
  //
  // **None, on a cold drawer.** The window was pulled out of a collapse once
  // precisely because it is the board's population and the first thing the drawer
  // is opened for, so opening it by default is the obvious reading of that rule —
  // and it is the wrong one *here*, because the rule's actual complaint was that
  // a collapsed window was a row saying nothing. This one is not: its key carries
  // the board's own label and a picture of the density behind it, so the window
  // is summarised rather than hidden, and a reader who arrives to read the board
  // is not met by a panel over its first five rows. One line to reverse if that
  // turns out backwards in use.
  const [bay, setBay] = useState<AdpBayId | null>(null);
  const closeBay = useCallback(() => setBay(null), []);

  const { onScreen, closing, panelRef } = useAdpDrawerLifecycle({
    open,
    onClose,
    bayOpen: bay !== null,
    onCloseBay: closeBay,
  });

  // Escape unmounts the bay under whatever inside it had focus, and the browser
  // drops the reader on `<body>` — several dozen stops from where they were. The
  // rail hands this ref to whichever key is open, which is where focus belongs.
  const openKeyRef = useRef<HTMLButtonElement>(null);
  useReturnFocus(bay !== null, openKeyRef);

  // A press outside dismisses the bay — the second of the three behaviours a
  // `<dialog>` would have supplied, written by hand because a bay must not make
  // the board behind it inert. One ref and one `contains` covers both the rail
  // and the bay, since the bay hangs off the block rather than off the panel;
  // it is `pointerdown` rather than `click` so a press that starts on the board
  // has closed the bay before the board reacts to it, which is the same
  // arrangement the league-filters dialog's segment rows use.
  const blockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bay === null) return;
    const dismiss = (event: PointerEvent) => {
      if (!blockRef.current?.contains(event.target as Node)) setBay(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [bay]);

  // Resolved once for the whole drawer rather than at each call site: the window
  // control reads it to place its handles and the board reads it to know when it
  // has become a *different* board, and those two answering to different days
  // would be a list that resets for a window nobody moved.
  //
  // Watched rather than read once, for the reason every relative window here is
  // — a drawer open across midnight would otherwise go on describing yesterday's
  // board. See {@link useTodayIso}.
  const today = useTodayIso();

  // The footer's premise line, as the dialog's description: a board priced on an
  // assumed pool is exactly the caveat a reader should hear on arrival rather
  // than have to find at the bottom of a panel that scrolls.
  const premiseId = useId();
  const bayId = useId();

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
  const seasonMonths = useMemo(
    () =>
      controls.season === "all"
        ? density.months
        : density.months.filter((m) => m.season === controls.season),
    [density.months, controls.season],
  );

  // Stable across a steepness drag, which is what lets the memo'd sections
  // above skip: an inline arrow is a fresh prop per notch.
  const handleSeasonChange = useCallback(
    (season: string) => onChange(withSeason(controls, season)),
    [controls, onChange],
  );
  const handleRangeChange = useCallback(
    (range: AdpControls["range"]) => onChange({ ...controls, range }),
    [controls, onChange],
  );
  // A second press on the open key shuts it, which is the only way back to the
  // whole board — there is no other control for "no bay".
  const handleToggleBay = useCallback(
    (next: AdpBayId) => setBay((current) => (current === next ? null : next)),
    [],
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
        // `@container`, so the board's value and KTC columns key off the panel's
        // own width rather than the viewport's — the panel is narrower than the
        // screen everywhere a laptop is involved. The panel carries no
        // `@`-variant of its own, which is what keeps that safe (an element is
        // never its own query container).
        //
        // **36rem rather than the 32 it was, and the four extra rem are a
        // column budget rather than a preference.** The board's densest state is
        // nine columns — both markets' ADP, both their values, and KTC's two
        // boards — which is 412px of fixed track and gap; at 32rem that left the
        // name 60px, which is not a name. See `BOARD_COLUMNS_BOTH` for the
        // arithmetic. It is still `w-full` under that cap, so a phone is
        // unchanged and the two collapsible pairs simply aren't drawn there.
        className="adp-drawer-panel @container relative ml-auto flex h-full w-full max-w-[36rem] flex-col border-l border-active/20 bg-[rgb(12,23,33)] shadow-[-24px_0_60px_rgba(0,0,0,0.5)] outline-none"
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
        {/* Pinned: two lines, whatever is being set.

            It was four parts stacked — the identity line, the window
            instrument, the filter row and the curve — at 314px of a 660px panel,
            which left nine rows of board. Three of them are bays now, behind one
            rail of keys that state what they are set to, and the open one floats
            over the board instead of pushing it: **the block is ~94px in every
            state and the board is seventeen rows**, with nothing reflowing on any
            press.

            The window's collapse is the part of that worth arguing with, since
            it was deliberately pulled *out* of one. What made the old collapse
            wrong was that it was a trigger beside a row of presets, so the
            board's population read as already answered; its key here carries the
            board's own label and the density behind it, which is the fact the
            presets were hiding. See {@link AdpBayRail} for the coverage
            arithmetic that makes the float affordable — the window bay leaves
            twelve rows readable, three more than this block used to show with
            nothing open at all, and the Leagues bay covers the board on purpose
            because nothing under it moves until its Apply.

            `relative` is what the bay hangs off (`top-full` is this block's own
            bottom edge, so nothing is measured), and `z-20` is what puts it over
            the board rather than under it. */}
        <div
          ref={blockRef}
          className="relative z-20 flex flex-col gap-2 border-b border-foreground/10 bg-foreground/[0.02] px-4 py-2"
        >
          <PinnedHeader
            seasons={seasons}
            season={controls.season}
            draftCount={board.data?.draft_count ?? null}
            stale={board.stale}
            // The window is dropped with the season, not carried across it —
            // see `withSeason`.
            onSeasonChange={handleSeasonChange}
            onClose={onClose}
          />

          <PinnedRail
            controls={controls}
            months={seasonMonths}
            open={bay}
            bayId={bayId}
            openKeyRef={openKeyRef}
            onToggle={handleToggleBay}
          />

          {bay !== null && (
            <AdpBay id={bayId} bay={bay} label={BAY_LABELS[bay]}>
              {bay === "leagues" && (
                <PinnedLeagueFilters
                  controls={controls}
                  leagues={leagues}
                  seedLeagues={seedLeagues}
                  onChange={onChange}
                  // Apply shuts the bay, which is what the float is for: the
                  // board is underneath, and the press that commits a narrowing
                  // is the moment a reader wants to watch it move.
                  onApplied={closeBay}
                />
              )}
              {bay === "window" && (
                <PinnedRange
                  range={controls.range}
                  season={controls.season}
                  defaultSeason={defaultSeason}
                  months={seasonMonths}
                  density={density}
                  today={today}
                  onChange={handleRangeChange}
                />
              )}
              {bay === "curve" && (
                <SteepnessSlider
                  value={steepness}
                  onPreview={setDragging}
                  onCommit={(next) => {
                    setDragging(null);
                    // A release that didn't move it is not a change: committing
                    // it anyway would hand the store a fresh object and
                    // re-render the tab behind for nothing.
                    if (next !== controls.steepness) {
                      onChange({ ...controls, steepness: next });
                    }
                  }}
                />
              )}
            </AdpBay>
          )}
        </div>

        <AdpBoard
          board={board}
          controls={controls}
          scope={scope}
          // The active season, not `controls.season`: the rookie flag on these
          // rows names the class that is a rookie *now*, so that is the season
          // its picks are numbered under. A board cut to a past season holds
          // none of them and lists no picks, which is the honest answer there.
          classSeason={defaultSeason}
          steepness={steepness}
          today={today}
        />

        <PinnedFooter
          rules={controls.leagueRules}
          premiseId={premiseId}
          onReset={onReset}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
