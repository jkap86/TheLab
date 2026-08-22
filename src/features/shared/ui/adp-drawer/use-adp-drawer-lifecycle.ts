"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

import { ADP_DRAWER_EXIT_MS } from "./adp-drawer.constants.ts";
import {
  TABBABLE_SELECTOR,
  deferFocusRestore,
  drawerKeydownHandler,
  lockScroll,
  releaseFocusRestore,
  resumeFocusRestore,
  tabbableStops,
} from "./adp-drawer.focus.ts";
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
};

/**
 * Everything about the drawer being on screen, in one place: the beat it stays
 * mounted for its exit, the page's scroll lock, and the modal's keyboard
 * contract — the focus move on open, Escape, Tab held inside the dialog, and
 * focus handed back to the opener once the exit has played.
 *
 * **The handback keys on `onScreen`, not on `open`, and the two are not the same
 * moment.** See the two slots below.
 *
 * **It reads the open bay but does not own it.** Escape closes the innermost
 * thing that is up, so the key listener has to know whether a bay is floating
 * over the board — but *which* bay is a fact about the drawer's controls, so it
 * lives in the component and arrives here as a thunk and a closer. Both go
 * through refs for the same reason `onClose` does: callers pass fresh arrows, and
 * an effect that re-ran on one would call `panel.focus()` again and take focus off
 * the lookback field being typed into.
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
  bayOpen,
  onCloseBay,
}: {
  open: boolean;
  onClose: () => void;
  /** A bay is floating over the board, so Escape means the bay. */
  bayOpen: boolean;
  onCloseBay: () => void;
}): AdpDrawerLifecycle {
  const panelRef = useRef<HTMLDivElement>(null);

  // The drawer is on its way out: closed as far as everything else is
  // concerned, still mounted so `drawer-out-right` has something to play on.
  const [closing, setClosing] = useState(false);

  // Adjusted during render against the previous `open` rather than in an effect
  // — the pattern `useFilteredTrades` and `ColumnsEditor` use, and the cascading
  // render the lint rule objects to.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
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

  // The bay's two halves, on the same terms and for the same reason. The flag is
  // a ref rather than a dependency because the listener has to answer for the
  // bay open *at press time* — re-attaching it on every bay toggle would move
  // focus back to the panel each time, which is the bug the ref above documents.
  const latestBayOpen = useRef(bayOpen);
  const latestCloseBay = useRef(onCloseBay);
  useEffect(() => {
    latestBayOpen.current = bayOpen;
    latestCloseBay.current = onCloseBay;
  }, [bayOpen, onCloseBay]);

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

  // Where focus goes when the drawer closes, in two slots. Captured on open
  // rather than passed in, because the drawer is rendered by a layout and
  // pressed from the app bar — the two are far enough apart that threading a ref
  // between them would be a prop on every caller for a fact the platform already
  // has.
  //
  // **Two slots, because the drawer stops being open a beat before it stops
  // being on screen.** `opener` holds the trigger while the drawer is up;
  // `pendingRestore` holds it through the exit, once the handback is owed and
  // before it may be paid. Restoring on `open` alone put the reader on the page
  // behind while a panel still carrying `role="dialog"` and `aria-modal="true"`
  // was mid-slide and fully visible — background focus under a live modal, which
  // is the one state the trap exists to make impossible. Between them the
  // trigger survives any number of interrupted exits — the reopen takes it back
  // out of `pendingRestore` rather than discarding it, since by then focus is
  // inside the drawer and there is nothing better to capture. The three moves
  // between the slots are `adp-drawer.focus`'s, and tested there.
  const opener = useRef<HTMLElement | null>(null);
  const pendingRestore = useRef<HTMLElement | null>(null);

  // The modal's whole keyboard contract, in one listener on `open`: Escape (the
  // innermost thing first), Tab held inside the dialog, and the focus move on
  // arrival. It keys on `open` alone — a drawer playing its exit answers no
  // keys, which is the same line `closing` draws for pointer events — and the
  // two callbacks it needs are read through refs above so a fresh arrow from the
  // caller cannot re-run it and steal focus mid-keystroke.
  //
  // What it no longer does is *restore* focus: its cleanup only records that the
  // handback is owed. Paying it here would land the reader on the page behind
  // while the panel is still up and still `aria-modal`.
  useEffect(() => {
    if (!open) return;

    // **A handback still owed is asked about first, and answering it is what
    // decides whether the active element is captured at all.** A pending target
    // means this is a reopen during the exit: the drawer is on screen, so the
    // reader is inside the *closing* dialog and `document.activeElement` is one
    // of its own chips or keys — an element that unmounts with the drawer.
    // Capturing it would overwrite the trigger that actually opened the drawer
    // with a node the eventual handback can only refuse for being disconnected,
    // leaving the reader on `<body>`. So the pending target is promoted back to
    // the opener instead, and it stays the restoration target however many exits
    // are interrupted. Nothing is focused here either way — the reader is inside
    // the dialog again, which is the background flash the slots exist to prevent.
    if (!resumeFocusRestore(opener, pendingRestore)) {
      // Nothing was owed, so the drawer is opening fresh from a fully closed
      // state and whatever holds focus really is the trigger that opened it.
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    // Every dependency is a thunk, so the stops are re-read per press: the
    // board's rows arrive and change under the reader, and a list captured when
    // the listener was attached would hold the new ones outside the trap. See
    // {@link drawerKeydownHandler}.
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
      bayOpen: () => latestBayOpen.current,
      closeBay: () => latestCloseBay.current(),
      closeDrawer: () => latestClose.current(),
    });

    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      // Closing, or unmounted while open. Either way the focused element is
      // inside a dialog that is going, so the handback becomes *owed* here — and
      // is paid by one of the two effects below, neither of which can run while
      // the panel is still on screen. This is the whole of the fix: the dialog
      // keeps the focus for the beat it keeps `aria-modal`.
      deferFocusRestore(opener, pendingRestore);
    };
  }, [open]);

  // The handback itself, on the transition the reader can actually see: the
  // panel has finished its exit and is no longer rendered, so there is nothing
  // left for focus to be trapped inside and the trigger can have it back.
  // Keyed on `onScreen`, so a reopen mid-exit — which never lets it reach false
  // — simply never fires, and the cancel above has already emptied the slot.
  useEffect(() => {
    if (onScreen) return;
    releaseFocusRestore(pendingRestore);
  }, [onScreen]);

  // The one case the effect above cannot see: unmounted while still on screen,
  // where `onScreen` never transitions because the component is gone. The
  // focused element goes with it and the browser drops the reader on `<body>`,
  // so the handback is owed exactly as it is on an ordinary close. Declared
  // last, so its cleanup runs after the `open` effect's has filled the slot;
  // spending the slot empties it, so an ordinary close cannot pay twice.
  useEffect(
    () => () => {
      releaseFocusRestore(pendingRestore);
    },
    [],
  );

  return { onScreen, closing, panelRef };
}
