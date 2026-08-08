"use client";

import { useId, useMemo } from "react";

import {
  type LeagueFilters,
  activeFilterCount,
  matchesFilters,
  scoringKeyOptions,
  seasonOptions,
  settingKeyOptions,
} from "../../league-filters";
import type { ManagerLeague } from "@/shared/manager";

// The seat table and the placeholder that stands in for this key live in
// `../league-filters-seat`, not in this folder: it is behind a `dynamic()` at
// both its call sites, so a fallback declared in here would drag the dialog back
// into the static graph and split nothing. See that file's own note.
import type { SeatName } from "../league-filters-seat";

import type {
  ExtraSegment,
  LeagueFilterRow,
} from "./league-filters-modal.types.ts";

import { FiltersDialogFooter } from "./filters-dialog-footer.tsx";
import { FiltersDialogHeader } from "./filters-dialog-header.tsx";
import { FiltersTrigger } from "./filters-trigger.tsx";
import { MatchRail } from "./match-rail.tsx";
import { RuleBays } from "./rule-bays.tsx";
import { SeasonBand } from "./season-band.tsx";
import { SegmentTrough } from "./segment-trough.tsx";
import { useLeagueFiltersModal } from "./use-league-filters-modal.ts";

/**
 * The league filters, behind a modal.
 *
 * They used to be a second zone of the header card — two rows of segment
 * buttons, permanently on screen above every view. Moving them into a dialog
 * buys the header the space the record readout now occupies, and costs the one
 * thing an always-visible bar gave for free: knowing what's selected without
 * opening anything. That is bought back twice — the trigger wears the count of
 * active filters, and the header names the selection in words beside the
 * numbers it scopes (`filterSummary`).
 *
 * **The panel is a bay layout with a readout rail.** The three fixed segments
 * are facts about a league and compress into one trough at the top; the two rule
 * lists — what a lineup starts, what a scoring page pays — sit side by side
 * underneath as equal bays. Stacked, as they were, the rules fell below a 60vh
 * scroll box and the feature read as missing: the segments alone filled the
 * panel, so a reader who wanted "superflex leagues that pay a TE bonus" had to
 * scroll past everything they *didn't* want to find the control that asks it.
 *
 * The rail on the right is the other half of that. The match count used to be a
 * line of footer text next to Apply; it is the number the whole dialog exists to
 * move, so it is a readout with a meter, the active selection as chips that
 * strike themselves out, and a note on what the survivors actually are. It is
 * beside the controls rather than under them because it changes while you edit
 * — a number you have to scroll to is a number you check once.
 *
 * A native `<dialog>` rather than a hand-rolled overlay: the focus trap, the
 * inert background, Esc-to-close and the backdrop are all the platform's, and
 * the two behaviours it doesn't give — closing on a backdrop *click*, and
 * discarding an unapplied edit — are `useLeagueFiltersModal`'s handlers.
 *
 * The selection is edited as a draft and committed on Apply, because the counts
 * beside every option and rule are only readable if the list behind the dialog
 * isn't moving while you read them.
 *
 * **This file is the composition root and nothing else.** It was one 994-line
 * module holding the trigger, the dialog's lifecycle, three kinds of control and
 * the readout — six audiences for one import, and the reason the panel's own
 * layout was hard to see. What is left here is the shell, the two derived
 * values every section reads, and the wiring; each section owns its own note on
 * why it is shaped the way it is.
 */
export function LeagueFiltersModal({
  filters,
  onChange,
  leagues,
  label = "Filters",
  seat = "free",
  omit,
  extra,
}: {
  filters: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
  /** The unfiltered list, which the per-option counts are taken over. */
  leagues: readonly ManagerLeague[];
  /**
   * What the trigger says. `Filters` on the manager tabs, where these are the
   * page's only filters and the leagues are what the page is *about*; `Leagues`
   * on the trades board, where the trade filters sit on the page beside it and
   * `Filters` would name one of two filter sets without saying which. The dialog
   * behind it is identical either way — what varies is only which of two filter
   * sets a reader is being pointed at.
   */
  label?: string;
  /**
   * How the trigger is mounted, which is the only thing that varies about its
   * *shape* — see {@link SEATS}.
   */
  seat?: SeatName;
  /**
   * Rows the caller already answers with a control of its own — see
   * {@link LeagueFilterRow}, which is where the argument for each of them is.
   *
   * It was `omitType`, a boolean, until the ADP board's season row made it two
   * of the same thing. Nothing about `LeagueFilters` changes either way: a row
   * is dropped, not a field, so the other callers keep both and the match rail
   * still names and clears a value that somehow arrived — which is what keeps
   * this from being a filter a reader cannot see or undo.
   */
  omit?: readonly LeagueFilterRow[];
  /**
   * A fourth segment row the caller owns — see {@link ExtraSegment}. The ADP
   * board seats its draft-kind chip here so that board's filters are one dialog
   * rather than a dialog and a chip beside it; nothing else passes one, and the
   * count on the trigger deliberately doesn't include it (the caller counts its
   * own).
   */
  extra?: ExtraSegment;
}) {
  const {
    dialogRef,
    panelRef,
    draft,
    setDraft,
    extraDraft,
    setExtraDraft,
    open,
    close,
    apply,
    reset,
    onBackdropPointerDown,
    onBackdropClick,
  } = useLeagueFiltersModal(filters, onChange, extra);

  /**
   * The dialog's own ids.
   *
   * Generated rather than written out, because **two of these are on the page at
   * once**: the manager Leagues tab renders one in the header plate's corner and
   * the shares sheet opened from its rail renders a second in its title bar. With
   * a literal id both dialogs pointed their `aria-labelledby` at whichever
   * heading came first in the document.
   */
  const titleId = useId();
  const hintId = useId();

  // The scoring vocabulary is whatever these leagues actually pay for, so it is
  // derived from the list rather than listed — see `scoringKeyOptions`.
  const scoringKeys = useMemo(() => scoringKeyOptions(leagues), [leagues]);

  // The settings vocabulary likewise: `teams` is always offered because it is
  // not in the blob at all, and everything else has to be stored by some league
  // on screen.
  const settingKeys = useMemo(() => settingKeyOptions(leagues), [leagues]);

  // And the seasons, which is the one menu that also decides whether its own
  // control is drawn at all — fewer than two is no choice to offer.
  const seasons = useMemo(() => seasonOptions(leagues), [leagues]);

  // The survivors, not just how many: the rail breaks them down, and the footer
  // counts them. One walk, so the two can't report different totals.
  const matched = useMemo(
    () => leagues.filter((league) => matchesFilters(league, draft)),
    [leagues, draft],
  );

  return (
    <>
      <FiltersTrigger
        label={label}
        seat={seat}
        active={activeFilterCount(filters)}
        onOpen={open}
      />

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        // The rule the whole dialog encodes, stated on arrival — the same line
        // the footer draws where the rail isn't beside the controls.
        aria-describedby={hintId}
        // Both ends of the press, because only the pair says whether it was a
        // press on the backdrop — see `isBackdropPress`.
        onPointerDown={onBackdropPointerDown}
        onClick={onBackdropClick}
        className="m-auto w-[min(1040px,calc(100vw-2rem))] bg-transparent p-0 text-foreground backdrop:bg-[rgba(4,10,16,0.72)] backdrop:backdrop-blur-sm"
      >
        <div
          ref={panelRef}
          tabIndex={-1}
          className="filters-dialog-panel relative overflow-hidden outline-none rounded-2xl border border-active/20 bg-gradient-to-b from-[#14242f] to-[#0a1520] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.95),0_0_60px_-20px_rgba(0,255,229,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]"
          style={{ animation: "dialog-rise 0.18s cubic-bezier(0.2,0.9,0.3,1)" }}
        >
          {/*
            The panel's specular rail. The header plate and the app bar both
            catch a cyan highlight along their lit edge; without it a panel this
            large reads as a flat sheet rather than as a milled face.
          */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-active/70 to-transparent"
          />

          <FiltersDialogHeader titleId={titleId} onClose={close} />

          {/*
            The controls scroll and the footer — where Apply is — stays put below
            them. On a laptop nothing needs to scroll at all, which is the point
            of the two-column bay; on a phone the whole grid collapses to one
            column and this is what keeps Apply reachable.
          */}
          <div className="max-h-[min(72vh,36rem)] overflow-y-auto p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
              <div className="flex min-w-0 flex-col gap-3">
                {!omit?.includes("season") && (
                  <SeasonBand
                    draft={draft}
                    onChange={setDraft}
                    leagues={leagues}
                    seasons={seasons}
                  />
                )}

                <SegmentTrough
                  draft={draft}
                  onChange={setDraft}
                  leagues={leagues}
                  omit={omit}
                  extra={extra}
                  extraDraft={extraDraft}
                  onExtraChange={setExtraDraft}
                />

                <RuleBays
                  draft={draft}
                  onChange={setDraft}
                  leagues={leagues}
                  scoringKeys={scoringKeys}
                  settingKeys={settingKeys}
                />
              </div>

              <MatchRail
                matched={matched}
                total={leagues.length}
                filters={draft}
                onChange={setDraft}
              />
            </div>
          </div>

          <FiltersDialogFooter
            matched={matched.length}
            total={leagues.length}
            hintId={hintId}
            onReset={reset}
            onApply={apply}
          />
        </div>
      </dialog>
    </>
  );
}
