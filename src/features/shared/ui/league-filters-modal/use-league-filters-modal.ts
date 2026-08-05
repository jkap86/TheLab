"use client";

import {
  type MouseEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { DEFAULT_LEAGUE_FILTERS, type LeagueFilters } from "../../league-filters";
import type { SegmentKey } from "./league-filters-modal.types.ts";

/**
 * Everything the dialog *is* over time: the draft being edited, which segment
 * row is floating, and the four gestures the platform doesn't wire up for you.
 *
 * It is one hook rather than state in the composition root because the pieces
 * are not independent — Escape has to close the innermost thing that is up, so
 * the key handler has to know whether a row is open, and opening the dialog has
 * to reseed the draft *and* drop any row left floating from last time. Split
 * across the sections that render them, those two facts would be read in three
 * places and written in one.
 *
 * **Nothing here is reachable without a document**, which is the same line
 * `use-adp-drawer-lifecycle` draws: `showModal`, the focus move, the outside
 * press and `cancel` all need a real dialog element, so the folder's tests cover
 * what the sections *render* and what their handlers *do*, and this module is
 * covered by the four behaviours being documented rather than asserted.
 */
export function useLeagueFiltersModal(
  filters: LeagueFilters,
  onChange: (filters: LeagueFilters) => void,
) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const troughRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(filters);

  /**
   * Which segment row has its options open, if any — one at a time.
   *
   * The options float over the panel rather than expanding into it: pushing the
   * rule bays down as a row opens is what made them hard to find in the first
   * place, so a row that opens must not move the thing underneath it.
   */
  const [openGroup, setOpenGroup] = useState<SegmentKey | null>(null);
  const closeGroup = useCallback(() => setOpenGroup(null), []);
  const toggleGroup = useCallback(
    (key: SegmentKey) => setOpenGroup((current) => (current === key ? null : key)),
    [],
  );

  // Seeding on open rather than syncing the applied filters into the draft with
  // an effect: while the dialog is up it holds the focus and the page behind it
  // is inert, so nothing can move the selection under it — the only moment the
  // two can disagree is the moment it opens.
  const open = useCallback(() => {
    setDraft(filters);
    setOpenGroup(null);
    dialogRef.current?.showModal();
    // `showModal` autofocuses the first focusable descendant, which here is the
    // close button — so the dialog opened with an X wearing a focus ring, which
    // reads as a pressed or selected control rather than as the way out (and on
    // iOS the ring is a blue square around a round button). The panel takes the
    // focus instead: the trap and Escape still belong to the dialog, and the
    // first Tab still lands on the close button. Same shape as `AdpDrawer`.
    panelRef.current?.focus();
  }, [filters]);

  // Closing discards the draft on exactly the terms Escape does, since the draft
  // is reseeded on open.
  const close = useCallback(() => dialogRef.current?.close(), []);

  // A press anywhere outside the trough dismisses an open row. Pointer-down
  // rather than click, so dragging out of the popover doesn't leave it up, and
  // on the dialog itself rather than the document — the page behind is inert.
  useEffect(() => {
    if (!openGroup) return;
    const dismiss = (event: PointerEvent) => {
      if (!troughRef.current?.contains(event.target as Node)) setOpenGroup(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [openGroup]);

  const apply = useCallback(() => {
    onChange(draft);
    dialogRef.current?.close();
  }, [draft, onChange]);

  const reset = useCallback(() => setDraft(DEFAULT_LEAGUE_FILTERS), []);

  // The backdrop is the dialog's own pseudo-element, so a click that lands on
  // the dialog box itself (padding-free, panel-sized) is a click outside the
  // panel — the gesture the platform doesn't wire up for you.
  const onBackdropClick = useCallback((event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) dialogRef.current?.close();
  }, []);

  // Escape closes the innermost thing that is up: an open segment row first, the
  // dialog only once nothing is floating over it. The platform fires `cancel`
  // before it closes, which is the one hook for that.
  const onCancel = useCallback(
    (event: SyntheticEvent<HTMLDialogElement>) => {
      if (!openGroup) return;
      event.preventDefault();
      setOpenGroup(null);
    },
    [openGroup],
  );

  return {
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
  };
}
