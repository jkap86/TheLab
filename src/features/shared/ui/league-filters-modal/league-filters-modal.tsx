"use client";

import { useId } from "react";

import { type LeagueFilters, activeFilterCount } from "../../league-filters";
import type { ManagerLeague } from "@/shared/manager";

// The seat table and the placeholder that stands in for this key live in
// `../league-filters-seat`, not in this folder: it is behind a `dynamic()` at
// both its call sites, so a fallback declared in here would drag the dialog back
// into the static graph and split nothing. See that file's own note.
import type { SeatName } from "../league-filters-seat";

import type { LeagueFilterRow } from "./league-filters-modal.types.ts";

import { FiltersDialogHeader } from "./filters-dialog-header.tsx";
import { FiltersTrigger } from "./filters-trigger.tsx";
import { LeagueFiltersPanel } from "./league-filters-panel.tsx";
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
 * A native `<dialog>` rather than a hand-rolled overlay: the focus trap, the
 * inert background, Esc-to-close and the backdrop are all the platform's, and
 * the two behaviours it doesn't give — closing on a backdrop *click*, and
 * discarding an unapplied edit — are `useLeagueFiltersModal`'s handlers.
 *
 * **This file is the trigger, the dialog and nothing else.** The controls it
 * frames are {@link LeagueFiltersPanel}, which came out of here the moment the
 * ADP drawer's Leagues bay wanted the same filters *without* a second modal over
 * the board they narrow. What is left is the modality: opening, the way out, and
 * the box those two live in. Every question about what the filters say — why the
 * fixed rows are a trough, why the rules are lists, why the readout is beside the
 * controls — is answered in that file and in the sections under it.
 */
export function LeagueFiltersModal({
  filters,
  onChange,
  leagues,
  label = "Filters",
  seat = "free",
  omit,
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
}) {
  const {
    dialogRef,
    panelRef,
    draft,
    setDraft,
    open,
    close,
    apply,
    reset,
    onBackdropPointerDown,
    onBackdropClick,
  } = useLeagueFiltersModal(filters, onChange);

  /**
   * The dialog's own ids.
   *
   * Generated rather than written out, because **two of these are on the page at
   * once**: the manager Leagues tab renders one in the header plate's corner and
   * the shares sheet opened from its rail renders a second. With a literal id
   * both dialogs pointed their `aria-labelledby` at whichever heading came first
   * in the document.
   */
  const titleId = useId();
  const hintId = useId();

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
        // The rule the whole panel encodes, stated on arrival — the same line
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
          // The height is bounded here rather than on the scroll box inside,
          // which is what lets the panel own one `min-h-0` chain: header and
          // footer take what they need and the controls between them scroll.
          // Bounding the *box* rather than the box's contents is also the only
          // spelling that can't overrun a short screen — the old `72vh` cap on
          // the scroll box alone was 72vh **plus** a header and a footer.
          className="filters-dialog-panel relative flex max-h-[min(88vh,44rem)] flex-col overflow-hidden outline-none rounded-2xl border border-active/20 bg-gradient-to-b from-[#14242f] to-[#0a1520] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.95),0_0_60px_-20px_rgba(0,255,229,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]"
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

          <LeagueFiltersPanel
            draft={draft}
            onChange={setDraft}
            leagues={leagues}
            omit={omit}
            hintId={hintId}
            onReset={reset}
            onApply={apply}
          />
        </div>
      </dialog>
    </>
  );
}
