"use client";

import { useMemo } from "react";

import {
  type LeagueFilters,
  activeFilterCount,
  matchesFilters,
  scoringKeyOptions,
} from "../../league-filters";
import type { ManagerLeague } from "@/shared/manager";

// The seat table and the placeholder that stands in for this key live in
// `../league-filters-seat`, not in this folder: it is behind a `dynamic()` at
// both its call sites, so a fallback declared in here would drag the dialog back
// into the static graph and split nothing. See that file's own note.
import type { SeatName } from "../league-filters-seat";

import { FiltersDialogFooter } from "./filters-dialog-footer.tsx";
import { FiltersDialogHeader } from "./filters-dialog-header.tsx";
import { FiltersTrigger } from "./filters-trigger.tsx";
import { MatchRail } from "./match-rail.tsx";
import { RuleBays } from "./rule-bays.tsx";
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
}: {
  filters: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
  /** The unfiltered list, which the per-option counts are taken over. */
  leagues: readonly ManagerLeague[];
  /**
   * What the trigger says. `Filters` on the manager tabs, where these are the
   * page's only filters and the leagues are what the page is *about*; `Leagues`
   * on the trades board, where the trade ledge beside it is the control called
   * Filters and two parts wearing that word would be two answers to the same
   * question. The dialog behind it is identical either way — what varies is only
   * which of two filter sets a reader is being pointed at.
   */
  label?: string;
  /**
   * How the trigger is mounted, which is the only thing that varies about its
   * *shape* — see {@link SEATS}.
   */
  seat?: SeatName;
}) {
  const {
    dialogRef,
    panelRef,
    troughRef,
    draft,
    setDraft,
    openGroup,
    toggleGroup,
    closeGroup,
    open,
    close,
    apply,
    reset,
    onBackdropClick,
    onCancel,
  } = useLeagueFiltersModal(filters, onChange);

  // The scoring vocabulary is whatever these leagues actually pay for, so it is
  // derived from the list rather than listed — see `scoringKeyOptions`.
  const scoringKeys = useMemo(() => scoringKeyOptions(leagues), [leagues]);

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
        aria-labelledby="league-filters-title"
        onClick={onBackdropClick}
        onCancel={onCancel}
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

          <FiltersDialogHeader onClose={close} />

          {/*
            The controls scroll and the footer — where Apply is — stays put below
            them. On a laptop nothing needs to scroll at all, which is the point
            of the two-column bay; on a phone the whole grid collapses to one
            column and this is what keeps Apply reachable.
          */}
          <div className="max-h-[min(72vh,36rem)] overflow-y-auto p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
              <div className="flex min-w-0 flex-col gap-4">
                <SegmentTrough
                  troughRef={troughRef}
                  draft={draft}
                  onChange={setDraft}
                  leagues={leagues}
                  openGroup={openGroup}
                  onToggle={toggleGroup}
                  onClose={closeGroup}
                />

                <RuleBays
                  draft={draft}
                  onChange={setDraft}
                  leagues={leagues}
                  scoringKeys={scoringKeys}
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
            onReset={reset}
            onApply={apply}
          />
        </div>
      </dialog>
    </>
  );
}
