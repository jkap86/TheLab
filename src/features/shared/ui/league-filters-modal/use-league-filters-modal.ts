"use client";

import {
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from "react";

import { closeDialog, openDialog } from "../../dialog-open.ts";
import { DEFAULT_LEAGUE_FILTERS, type LeagueFilters } from "../../league-filters";
import { isBackdropPress } from "./league-filters-modal.utils.ts";

/**
 * Everything the dialog *is* over time: the draft being edited, and the two
 * gestures the platform doesn't wire up for you.
 *
 * **It used to owe four more, and they left with the segment popovers.** While
 * the fixed filters were collapsed rows whose options floated over the panel,
 * this hook held which row was open, dismissed it on a press outside the trough,
 * and preventDefaulted the dialog's own `cancel` so Escape closed the innermost
 * thing that was up rather than taking both at once — plus a focus return for
 * the row that had just vanished. Drawn as rails, nothing floats, so Escape is
 * the platform's again and all four are owed by nothing.
 *
 * **It also used to carry a second draft, for the caller's fourth segment row**,
 * and that left with the ADP board: the row is still seated in the panel's
 * trough, but the host that owns it now draws the panel inline and writes the
 * rules and the row into one stored object — see {@link ExtraSegment}, which is
 * where the argument for why that must be one write lives. Nothing that opens
 * the *dialog* has ever had one, so what is left here is the filters alone.
 *
 * **The calls are unreachable without a document; the decisions behind them are
 * not**, which is the same line `use-adp-drawer-lifecycle` draws. The focus move
 * onto the panel needs a real dialog element and is covered by the manual
 * checklist. Both of the things that could be wrong independently of the DOM are
 * elsewhere and tested there: whether a completed press was on the backdrop is
 * `league-filters-modal.utils`, and what opening a `<dialog>` does when the
 * platform refuses is `dialog-open`.
 */
export function useLeagueFiltersModal(
  filters: LeagueFilters,
  onChange: (filters: LeagueFilters) => void,
) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(filters);

  // Seeding on open rather than syncing the applied filters into the draft with
  // an effect: while the dialog is up it holds the focus and the page behind it
  // is inert, so nothing can move the selection under it — the only moment the
  // two can disagree is the moment it opens.
  const open = useCallback(() => {
    setDraft(filters);
    // **`showModal` on a dialog that is already open throws**, where `close` on
    // one already closed is a spec'd no-op — so this is the one of the pair that
    // needs asking first. A modal makes everything outside it inert, so the
    // trigger cannot ordinarily be pressed twice; what this covers is the paths
    // that don't go through the trigger at all — a caller opening it
    // programmatically, or a re-entrant press on an engine that delivers one.
    // An `InvalidStateError` here would take down the render that asked.
    //
    // Which is exactly what {@link openDialog} answers, and asking it rather
    // than the element is what covers the *other* two throws as well: a dialog
    // detached between the press and this call, and an engine with no
    // `showModal` at all. Its last resort is the `open` attribute — the same
    // panel without the top layer, which beats a dialog nobody can open.
    const outcome = openDialog(dialogRef.current);
    // Nothing on screen is nothing to focus. Every other outcome — including
    // `already-open`, which is what the re-entrant press above arrives as —
    // leaves the panel up and takes the focus exactly as it always did.
    if (outcome === "detached" || outcome === "failed") return;
    // `showModal` autofocuses the first focusable descendant, which here is the
    // close button — so the dialog opened with an X wearing a focus ring, which
    // reads as a pressed or selected control rather than as the way out (and on
    // iOS the ring is a blue square around a round button). The panel takes the
    // focus instead: the trap and Escape still belong to the dialog, and the
    // first Tab still lands on the close button. Same shape as `AdpDrawer`.
    panelRef.current?.focus();
  }, [filters]);

  // Closing discards the draft on exactly the terms Escape does, since the draft
  // is reseeded on open. `closeDialog` rather than the element's own method for
  // the symmetry alone — `close` on a dialog with no `open` attribute is a spec'd
  // no-op, so unlike its counterpart above this one was never a throw waiting to
  // happen; what the helper adds is the fallback for an engine that shut the
  // panel through the attribute in the first place.
  const close = useCallback(() => closeDialog(dialogRef.current), []);

  const apply = useCallback(() => {
    onChange(draft);
    closeDialog(dialogRef.current);
  }, [draft, onChange]);

  const reset = useCallback(() => setDraft(DEFAULT_LEAGUE_FILTERS), []);

  // Where a press outside the panel began. The backdrop is the dialog's own
  // pseudo-element, so such a press lands on the `<dialog>` box itself — but so
  // does the *click* ending a text selection that started inside the panel and
  // ran past its edge, since a click fires on the common ancestor of its two
  // ends. Recording the near end is what tells those apart; see
  // {@link isBackdropPress}.
  const pressedTarget = useRef<EventTarget | null>(null);

  const onBackdropPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDialogElement>) => {
      pressedTarget.current = event.target;
    },
    [],
  );

  const onBackdropClick = useCallback((event: MouseEvent<HTMLDialogElement>) => {
    // Cleared whichever way this goes, so a click with no pointer press before
    // it — Enter or Space on a control inside — can never inherit an earlier
    // gesture's answer.
    const began = pressedTarget.current;
    pressedTarget.current = null;
    if (isBackdropPress(dialogRef.current, began, event.target))
      closeDialog(dialogRef.current);
  }, []);

  return {
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
  };
}
