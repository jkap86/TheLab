"use client";

import {
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { DEFAULT_LEAGUE_FILTERS, type LeagueFilters } from "../../league-filters";
import type { ExtraSegment } from "./league-filters-modal.types.ts";
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
 * **The calls are unreachable without a document; the decisions behind them are
 * not**, which is the same line `use-adp-drawer-lifecycle` draws. `showModal`,
 * the focus move onto the panel and the `close` that three paths share all need
 * a real dialog element and are covered by the manual checklist. What is left to
 * be wrong independently of the DOM — whether a completed press was on the
 * backdrop — is in `league-filters-modal.utils` and tested there.
 */
export function useLeagueFiltersModal(
  filters: LeagueFilters,
  onChange: (filters: LeagueFilters) => void,
  /** The caller's own fourth row, drafted alongside — see {@link ExtraSegment}. */
  extra?: ExtraSegment,
) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
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

  // Seeding on open rather than syncing the applied filters into the draft with
  // an effect: while the dialog is up it holds the focus and the page behind it
  // is inert, so nothing can move the selection under it — the only moment the
  // two can disagree is the moment it opens.
  const open = useCallback(() => {
    setDraft(filters);
    setExtraDraft(extraRef.current?.value ?? "");
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

  return {
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
  };
}
