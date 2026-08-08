"use client";

import {
  type MouseEvent,
  // Aliased, because the document listener further down takes the *DOM*
  // `PointerEvent` and React's synthetic one would shadow it — two types with
  // one name, where the compiler's complaint names neither.
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { DEFAULT_LEAGUE_FILTERS, type LeagueFilters } from "../../league-filters";
import type { ExtraSegment, SegmentKey } from "./league-filters-modal.types.ts";
import {
  escapeTarget,
  isBackdropPress,
  nextOpenGroup,
} from "./league-filters-modal.utils.ts";

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
 * **The calls are unreachable without a document; the decisions behind them are
 * not**, which is the same line `use-adp-drawer-lifecycle` draws. `showModal`,
 * the focus move onto the panel and the `close` that four paths share all need a
 * real dialog element and are covered by the manual checklist. What each of them
 * is *conditioned on* — which row a press toggles to, whether Escape means the
 * row or the dialog, and whether a completed press was on the backdrop — is in
 * `league-filters-modal.utils` and tested there, because those are the parts
 * that can be wrong while the DOM calls stay right.
 */
export function useLeagueFiltersModal(
  filters: LeagueFilters,
  onChange: (filters: LeagueFilters) => void,
  /** The caller's own fourth row, drafted alongside — see {@link ExtraSegment}. */
  extra?: ExtraSegment,
) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const troughRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(filters);

  // The extra row's draft, held beside the filters' rather than inside them: it
  // is not a `LeagueFilters` field and must not become one (see the type's own
  // note), but it is committed on the same press, so it is seeded on the same
  // open and reset by the same key.
  const [extraDraft, setExtraDraft] = useState(extra?.value ?? "");

  // Read through a ref so the three callbacks below can commit against whatever
  // the caller last passed without re-creating on every render of a parent that
  // rebuilds the object — the same reason `useAdpDrawerLifecycle` holds
  // `onClose` in one, written the same way: an effect rather than an assignment
  // during render, which the lint rule objects to and which would be read by a
  // render that was thrown away.
  const extraRef = useRef(extra);
  useEffect(() => {
    extraRef.current = extra;
  }, [extra]);

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
    (key: SegmentKey) => setOpenGroup((current) => nextOpenGroup(current, key)),
    [],
  );

  // Seeding on open rather than syncing the applied filters into the draft with
  // an effect: while the dialog is up it holds the focus and the page behind it
  // is inert, so nothing can move the selection under it — the only moment the
  // two can disagree is the moment it opens.
  const open = useCallback(() => {
    setDraft(filters);
    setExtraDraft(extraRef.current?.value ?? "");
    setOpenGroup(null);
    // **`showModal` on a dialog that is already open throws**, where `close` on
    // one already closed is a spec'd no-op — so this is the one of the pair that
    // needs asking first. A modal makes everything outside it inert, so the
    // trigger cannot ordinarily be pressed twice; what this covers is the paths
    // that don't go through the trigger at all — a caller opening it
    // programmatically, or a re-entrant press on an engine that delivers one.
    // An `InvalidStateError` here would take down the render that asked.
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // `showModal` autofocuses the first focusable descendant, which here is the
    // close button — so the dialog opened with an X wearing a focus ring, which
    // reads as a pressed or selected control rather than as the way out (and on
    // iOS the ring is a blue square around a round button). The panel takes the
    // focus instead: the trap and Escape still belong to the dialog, and the
    // first Tab still lands on the close button. Same shape as `AdpDrawer`.
    panelRef.current?.focus();
  }, [filters]);

  // Closing discards the draft on exactly the terms Escape does, since the draft
  // is reseeded on open. No `open` check to match the one in `open` above:
  // `close` on a dialog with no `open` attribute returns without doing anything,
  // so the asymmetry is the platform's rather than an oversight.
  const close = useCallback(() => dialogRef.current?.close(), []);

  // A press anywhere outside the trough dismisses an open row. Pointer-down
  // rather than click, so dragging out of the popover doesn't leave it up. The
  // listener is on the document because that is where a press on the dialog's
  // own backdrop is heard; the page *behind* is inert while a modal is up, so
  // the wide target costs nothing — there is nothing back there to hear.
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
    // After `onChange`, so a caller writing both into one store lands on the
    // filters' own update rather than on a stale copy of it.
    const own = extraRef.current;
    if (own && extraDraft !== own.value) own.onApply(extraDraft);
    dialogRef.current?.close();
  }, [draft, extraDraft, onChange]);

  const reset = useCallback(() => {
    setDraft(DEFAULT_LEAGUE_FILTERS);
    setExtraDraft(extraRef.current?.defaultValue ?? "");
  }, []);

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
      dialogRef.current?.close();
  }, []);

  // Escape closes the innermost thing that is up: an open segment row first, the
  // dialog only once nothing is floating over it. The platform fires `cancel`
  // before it closes, which is the one hook for that — and `cancel` is not
  // delegated by React, so the listener is on the element itself and this
  // `preventDefault` is the real one.
  const onCancel = useCallback(
    (event: SyntheticEvent<HTMLDialogElement>) => {
      if (escapeTarget(openGroup) === "dialog") return;
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
    extraDraft,
    setExtraDraft,
    openGroup,
    toggleGroup,
    closeGroup,
    open,
    close,
    apply,
    reset,
    onBackdropPointerDown,
    onBackdropClick,
    onCancel,
  };
}
