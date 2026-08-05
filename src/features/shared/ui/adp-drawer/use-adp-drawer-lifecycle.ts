"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

import { ADP_DRAWER_EXIT_MS } from "./adp-drawer.constants.ts";
import {
  TABBABLE_SELECTOR,
  drawerKeydownHandler,
  lockScroll,
  restoreFocus,
  tabbableStops,
} from "./adp-drawer.focus.ts";
import type { AdpDrawerPanel } from "./adp-drawer.types.ts";

export type AdpDrawerLifecycle = {
  /** The drawer is rendered: open, or still playing its exit. */
  onScreen: boolean;
  /** On its way out — what the exit animations and the CSS rules key off. */
  closing: boolean;
  /**
   * The dialog element: focused once on open, and the boundary the focus trap
   * holds Tab inside — so it must be the element carrying `role="dialog"`, not
   * the overlay around it.
   */
  panelRef: RefObject<HTMLDivElement | null>;
  /** Which floating panel is up, if any. */
  openPanel: AdpDrawerPanel | null;
  togglePanel: (which: AdpDrawerPanel) => void;
  closePanel: () => void;
};

/**
 * Everything about the drawer being on screen, in one place: the beat it stays
 * mounted for its exit, the page's scroll lock, the modal's keyboard contract —
 * the focus move on open, Escape, Tab held inside the dialog, and focus handed
 * back to the opener on the way out — and which of its floating panels is up.
 *
 * The panel selection is here rather than in the component because **Escape
 * closes the innermost thing that is up**, so the key handler has to know
 * whether a panel is open before it can decide whether the drawer is what a
 * keypress means.
 *
 * What it does *not* hold is any of the deciding: which keys mean what, where
 * Tab goes next, whether an opener may be focused again and what the scroll lock
 * restores are all in `adp-drawer.focus`, which is free of the DOM and tested.
 * What is left here is the wiring — listeners, timers, and reading
 * `document.activeElement` — which is the part a test without a browser could
 * never reach anyway.
 */
export function useAdpDrawerLifecycle({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): AdpDrawerLifecycle {
  const panelRef = useRef<HTMLDivElement>(null);

  const [openPanel, setOpenPanel] = useState<AdpDrawerPanel | null>(null);
  const togglePanel = (which: AdpDrawerPanel) =>
    setOpenPanel((current) => (current === which ? null : which));
  const closePanel = () => setOpenPanel(null);

  // The drawer is on its way out: closed as far as everything else is
  // concerned, still mounted so `adp-drawer-out` has something to play on.
  const [closing, setClosing] = useState(false);

  // A drawer reopened is a drawer at rest: the window's panel floats over the
  // board, so one left hanging open covers the thing the drawer was opened to
  // show. Adjusted during render against the previous `open` rather than in an
  // effect — the pattern `useFilteredTrades` and `ColumnsEditor` use, and the
  // cascading render the lint rule objects to.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (openPanel !== null) setOpenPanel(null);
    // Reopening cancels an exit still in flight, so a second press lands on the
    // panel sliding back in rather than on one finishing its way off screen.
    setClosing(!open);
  }

  // Retire it once the exit has played. Keyed on `closing` alone, so reopening
  // — which clears the flag above — tears the timer down with it.
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), ADP_DRAWER_EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  // Read by the Escape handler below, which depends on `open` alone.
  const latestPanel = useRef(openPanel);
  useEffect(() => {
    latestPanel.current = openPanel;
  }, [openPanel]);

  // Held in a ref so the effect below can depend on `open` alone. Callers pass a
  // fresh arrow every render, so depending on `onClose` re-ran the whole effect
  // on every keystroke — which meant `panel.focus()` fired again and took focus
  // off whatever was being used. That was survivable while the drawer held only
  // selects (each change already ends the interaction); it is not survivable for
  // the steepness slider or the lookback counter's fields, which are nudged and
  // typed into one keystroke at a time.
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  }, [onClose]);

  // The page behind stops scrolling while the drawer is on screen — a
  // full-height panel over a scrolling page reads as a rendering bug. It holds
  // through the exit as well as the open state: released a beat early, the
  // scrollbar comes back and the page jumps sideways under a panel that is
  // still sliding off it. `lockScroll` hands back the undo carrying the value it
  // replaced, so an unmount mid-exit cannot leave the page locked.
  const onScreen = open || closing;
  useEffect(() => {
    if (!onScreen) return;
    return lockScroll(document.body);
  }, [onScreen]);

  // Where focus goes when the drawer closes. Captured on open rather than passed
  // in, because the drawer is rendered by a layout and pressed from the app bar
  // — the two are far enough apart that threading a ref between them would be a
  // prop on every caller for a fact the platform already has.
  const opener = useRef<HTMLElement | null>(null);

  // The modal's whole keyboard contract, in one listener on `open`: Escape (the
  // innermost thing first), Tab held inside the dialog, and focus handed back on
  // the way out. It keys on `open` alone — a drawer playing its exit is not a
  // dialog any more, which is the same line `closing` draws for pointer events —
  // and the two callbacks it needs are read through refs above so a fresh arrow
  // from the caller cannot re-run it and steal focus mid-keystroke.
  useEffect(() => {
    if (!open) return;

    opener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Every dependency is a thunk, so the stops are re-read per press: opening
    // the filter tray or the lookback panel adds controls the reader must be
    // able to Tab into, and a list captured when the listener was attached
    // would hold them outside it. See {@link drawerKeydownHandler}.
    const onKey = drawerKeydownHandler<HTMLElement>({
      stops: () => {
        const container = panelRef.current;
        return container
          ? tabbableStops(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR))
          : [];
      },
      activeElement: () =>
        document.activeElement instanceof HTMLElement ? document.activeElement : null,
      focusContainer: () => panelRef.current?.focus(),
      panelOpen: () => latestPanel.current !== null,
      closePanel: () => setOpenPanel(null),
      closeDrawer: () => latestClose.current(),
    });

    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      // Closing, or unmounted while open. Either way the focused element is
      // inside a dialog that is going, so it goes back where it came from —
      // unless the opener is gone or disabled, which `restoreFocus` judges. A
      // drawer reopened before this settles is no exception to worry about: the
      // setup above runs straight after and focuses the panel, so the reopened
      // drawer wins the last word.
      const target = opener.current;
      opener.current = null;
      restoreFocus(target);
    };
  }, [open]);

  return { onScreen, closing, panelRef, openPanel, togglePanel, closePanel };
}
