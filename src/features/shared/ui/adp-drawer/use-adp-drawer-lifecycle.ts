"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

import { ADP_DRAWER_EXIT_MS } from "./adp-drawer.constants.ts";
import type { AdpDrawerPanel } from "./adp-drawer.types.ts";

export type AdpDrawerLifecycle = {
  /** The drawer is rendered: open, or still playing its exit. */
  onScreen: boolean;
  /** On its way out — what the exit animations and the CSS rules key off. */
  closing: boolean;
  /** The dialog element, focused once on open. */
  panelRef: RefObject<HTMLDivElement | null>;
  /** Which floating panel is up, if any. */
  openPanel: AdpDrawerPanel | null;
  togglePanel: (which: AdpDrawerPanel) => void;
  closePanel: () => void;
};

/**
 * Everything about the drawer being on screen, in one place: the beat it stays
 * mounted for its exit, the page's scroll lock, the focus move on open, Escape,
 * and which of its floating panels is up.
 *
 * Those last two belong together and that is why the panel selection is here
 * rather than in the component: **Escape closes the innermost thing that is
 * up**, so the key handler has to know whether a panel is open before it can
 * decide whether the drawer is what a keypress means.
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
  // still sliding off it. The cleanup restores what was there, so an unmount
  // mid-exit cannot leave the page locked.
  const onScreen = open || closing;
  useEffect(() => {
    if (!onScreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [onScreen]);

  // Escape closes. Focus moves to the panel once, on open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape closes the innermost thing that is up. Without this the window's
      // floating panel and the whole drawer would go on one keypress.
      if (latestPanel.current !== null) {
        setOpenPanel(null);
        return;
      }
      latestClose.current();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return { onScreen, closing, panelRef, openPanel, togglePanel, closePanel };
}
