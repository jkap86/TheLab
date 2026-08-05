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

  // Escape closes, Tab stays inside, and the focus comes back where it started.
  //
  // The last two are what a hand-rolled `role="dialog"` owes that a native
  // `<dialog>` gives away: `aria-modal` tells a screen reader to ignore the page
  // behind, and does nothing at all about the Tab key — so without the trap a
  // reader tabbed off the end of the board straight into the league list under
  // an opaque panel, with no way to tell where they were. Restoring is the same
  // rule one step later: the panel is unmounted on close and the browser drops
  // focus on `<body>`, which on a pinned-header page is several dozen stops from
  // the trigger that opened this.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      // A native `<dialog>` shown with `showModal()` owns the focus and Escape
      // for as long as it is up, and it makes everything under it inert — so
      // both halves below would be fighting it: Escape would close this drawer
      // instead of the thing on top of it, and the trap would preventDefault a
      // Tab and then fail to move focus, because `focus()` on an inert element
      // does nothing. The drawer's own scrim makes this unreachable by pointer
      // and the trap makes it unreachable by keyboard; the guard is what keeps
      // that true if either ever stops holding.
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") {
        // Escape closes the innermost thing that is up. Without this the
        // window's floating panel and the whole drawer would go on one
        // keypress.
        if (latestPanel.current !== null) {
          setOpenPanel(null);
          return;
        }
        latestClose.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const stops = tabbableWithin(panel);
      if (stops.length === 0) {
        // Nothing to land on, so the panel itself keeps the focus rather than
        // letting the page behind take it.
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      // Wrapping at the ends, and hauling focus back in if it ever got out —
      // the drawer's scrim is a sibling rather than a child, so a stray
      // Shift+Tab used to land on it.
      if (!panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      // Guarded on `isConnected`, so an unmount that comes from navigating away
      // doesn't chase an element that is no longer on the page.
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  return { onScreen, closing, panelRef, openPanel, togglePanel, closePanel };
}

/**
 * Everything inside `root` a Tab would stop on, in document order.
 *
 * Read fresh on every keypress rather than cached: the drawer's contents change
 * as its floating panels open, the filter tray grows and shrinks, and the board
 * itself is a list that arrives after the panel does — a snapshot taken on open
 * would be wrong by the first press.
 *
 * `getClientRects()` is the visibility test rather than `offsetParent`, which is
 * null for a positioned element and would drop the floating panels this exists
 * to keep reachable. `disabled` is excluded by the selector; `[hidden]` and
 * `display: none` fall out of the rect check.
 */
function tabbableWithin(root: HTMLElement): HTMLElement[] {
  const selector =
    "a[href], button:not([disabled]), input:not([disabled]), " +
    "select:not([disabled]), textarea:not([disabled]), [tabindex]";
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (el) =>
      el.tabIndex >= 0 &&
      el.getAttribute("aria-hidden") !== "true" &&
      el.getClientRects().length > 0,
  );
}
