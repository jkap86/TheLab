"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { CONSOLE_HOUSING_INSET_SHELL } from "../console-chrome";
import { panelCap } from "../panel-cap";

/**
 * The expanded half of a card: an inner housing that caps itself to what the
 * viewport can show, and — where the card is one that parks — scrolls its card
 * under the rack first.
 *
 * **The problem it solves is a page, not a card.** A twelve-team browser is
 * most of a screen tall and the rack lists a hundred of them, so opening a card
 * three quarters of the way down used to leave the reader scrolling *through*
 * the thing they had just asked for — the league's name gone off the top (which
 * is what the sticky housing was already patching), the standings above the
 * fold and the picks below it. Parked and capped, an open card is one screen:
 * the plate names the league at the top, the two lists scroll inside their own
 * panes, and the page does not move under the press.
 *
 * **It is a component of its own so `league-card.tsx` stays hook-free**, which
 * is that file's own stated design and `LeagueSyncKey`'s precedent one tool
 * over. The card renders a housing; this is the housing, with the two
 * measurements it cannot take for itself.
 *
 * **It lives in `features/shared/ui` because a trade card mounts it too**, on
 * the line `CONSOLE_KEY`, `ManagerPlate`, `LeagueConfigWindow` and
 * `LeagueTeams` all moved on: a second reader, and a sibling feature may not
 * import from `features/manager`. Its own note used to say "consider moving it
 * once a second card mounts it", and one does.
 *
 * **Not every card parks, and `parked` is the whole of that difference.** A
 * manager card's frozen header is ~210px and pinning it under the rack is what
 * keeps the league's name on screen while a twelve-team table scrolls past; a
 * trade card's summary carries both hauls in full — measured 413px — and
 * freezing that covers the top half of the viewport with the history bay the
 * first thing underneath it. So a trade card neither scrolls itself into place
 * nor freezes, and its cap is a share of the viewport rather than what is left
 * under a header that is not there. See {@link panelCap}, which is where the
 * arithmetic for both lives and is tested.
 *
 * **The `<details>` is found by walking up rather than passed in**, and that is
 * what keeps the card declarative: there is no ref to thread through the
 * summary, no state to lift, and the disclosure stays exactly the native
 * element it was. `toggle` fires on the element itself and does not bubble, but
 * the listener is on the ancestor we walked to, which is the element it fires
 * on.
 *
 * **The measurements are taken after layout, never guessed.** The header's
 * height changes with the settings strip's wrap, the league's name, and the
 * width; and a `100dvh` estimate is wrong on a phone the moment the URL bar
 * moves. So the cap is read from the summary's own box on the frame after the
 * open, and again whenever that box changes size — a `ResizeObserver` rather
 * than a resize listener, because the summary changes height for reasons the
 * window does not (the settings strip re-wrapping when a lens re-renders it).
 *
 * An un-parked card measures nothing but the viewport, and it still observes
 * the summary — a card whose header reflows has not changed its cap, but the
 * observer costs nothing and keeps one code path for both arms.
 */

/** `--card-freeze-top` in px, or the token's own value where it cannot be read. */
function freezeTopOf(el: Element): number {
  const raw = getComputedStyle(el).getPropertyValue("--card-freeze-top").trim();
  const px = raw.endsWith("rem")
    ? Number.parseFloat(raw) * 16
    : Number.parseFloat(raw);
  return Number.isFinite(px) ? px : 87;
}

export function ExpandedPanel({
  children,
  parked = true,
}: {
  children: ReactNode;
  /**
   * Whether the card scrolls itself under the rack and freezes its header
   * there. True for the two league cards, false for the trade card — see the
   * module note and {@link panelCap}, which is where the two shapes differ.
   */
  parked?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  // One tick per open, so the park below fires again on the next open even
  // where the cap it lands on is the same number as last time.
  const [park, setPark] = useState(0);

  /**
   * Re-read the cap from the card's current header.
   *
   * Called on the frame after an open and from the observer, so it must be
   * cheap and idempotent — it is two `getBoundingClientRect`s and a `setState`
   * React drops when the number has not moved.
   *
   * **The un-parked arm reads neither rect**, and taking them anyway would be
   * two forced layouts per resize for two numbers `panelCap` is about to
   * ignore.
   */
  const measure = useCallback(() => {
    const panel = ref.current;
    const card = panel?.parentElement;
    if (!panel || !card) return;
    if (!parked) {
      setCap(panelCap(window.innerHeight, { parked: false }));
      return;
    }
    const offset =
      panel.getBoundingClientRect().top - card.getBoundingClientRect().top;
    setCap(
      panelCap(window.innerHeight, {
        parked: true,
        panelOffset: offset,
        freezeTop: freezeTopOf(card),
      }),
    );
  }, [parked]);

  /**
   * **The park runs after the cap is committed, never in the same frame.**
   * Capping the panel shortens the document, and a page scrolled near its
   * bottom is re-clamped when that happens — so a park measured against the
   * uncapped layout lands short by however much the clamp took, which at 390
   * was a visible 3px off the frozen offset the housing then snaps to. Setting
   * both in one batch and scrolling from the effect after it means the rect the
   * park reads is the one the reader ends up with.
   */
  useEffect(() => {
    if (park === 0 || !parked) return;
    const card = ref.current?.parentElement;
    if (card instanceof HTMLDetailsElement && card.open) parkCard(card);
  }, [park, parked]);

  useEffect(() => {
    const panel = ref.current;
    const card = panel?.parentElement;
    if (!(card instanceof HTMLDetailsElement)) return;
    const summary = card.querySelector(":scope > summary");
    if (!summary) return;

    const observer = new ResizeObserver(() => {
      // Re-measure only. A header that re-wraps is not a reason to scroll the
      // page — the reader is looking at something, and moving it under them
      // because a strip reflowed is the one thing the park must never do.
      if (card.open) measure();
    });

    /**
     * **A window resize is the other half, and the observer cannot see it.**
     * Both arms of {@link panelCap} are functions of `window.innerHeight`, and
     * a window dragged *taller* — or a phone's URL bar retracting — changes
     * that without changing the summary's box by a pixel, so the observer never
     * fires and the panel keeps a cap measured against a viewport that is gone.
     * Measured: opening at 900 and resizing to 1200 held the panel at 630px
     * until it was closed and re-opened.
     *
     * The observer is still what this module's note argues for, and this does
     * not replace it: the summary changes height for reasons the window does
     * not (the settings strip re-wrapping when a lens re-renders it), and the
     * window changes for reasons the summary does not. They are two events.
     */
    const onResize = () => {
      if (card.open) measure();
    };

    const onToggle = () => {
      if (!card.open) {
        // Uncapped while shut, so a closed card's panel is never a box with a
        // stale height — and so the *next* open measures a header that has
        // already laid out at the current width rather than one from whenever
        // it was last open.
        setCap(null);
        observer.disconnect();
        return;
      }
      observer.observe(summary);
      // One frame, so the cap is read from a header that has laid out with the
      // panel in the flow rather than from the one that was there before it.
      requestAnimationFrame(() => {
        measure();
        setPark((n) => n + 1);
      });
    };

    card.addEventListener("toggle", onToggle);
    window.addEventListener("resize", onResize);
    if (card.open) onToggle();
    return () => {
      card.removeEventListener("toggle", onToggle);
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, [measure]);

  return (
    <div
      ref={ref}
      // `box-sizing: border-box` is what makes the cap mean what it says: the
      // housing's own padding and border are inside it rather than added to it,
      // which is Tailwind's default and is stated here because the number
      // depends on it.
      //
      // A column, so the rail holds its height, the browser takes the rest and
      // the two panes scroll their own lists — see `Pane`. `overflow-hidden`
      // comes with the housing and is what keeps a pane's own scroller inside
      // the 14px radius.
      className={`${CONSOLE_HOUSING_INSET_SHELL} mt-3.5 flex flex-col rounded-[0.875rem] p-1.5 sm:p-3 pointer-fine:[perspective:1400px]`}
      style={cap === null ? undefined : { maxHeight: cap }}
    >
      {children}
    </div>
  );
}

/**
 * Scroll the card's top edge to where its own frozen housing will sit.
 *
 * **The target is `--card-freeze-top` and not a number of this module's own**,
 * which is what makes the park land exactly on the sticky offset the summary is
 * about to take: park anywhere else and the housing visibly slides the
 * difference as the reader's first scroll engages the freeze.
 *
 * **The scroller is resolved on every open, never cached.** A ref captured once
 * goes stale the moment the tree re-renders, and writing `scrollTop` on a
 * detached node silently no-ops — so the walk starts from the card that was
 * actually opened. On this page it finds nothing and falls through to the
 * document, which *is* the rack here: the leagues list scrolls with the page.
 * The walk is kept for the case it is written for, since a scrolling ancestor
 * is one layout change away and a park measured against the wrong box is a
 * scroll to somewhere arbitrary.
 *
 * It never scrolls **down** to a card that is already fully above its offset —
 * `Math.max(0, …)` on the document and the container's own floor — because the
 * one thing worse than not parking is dragging the page away from something the
 * reader can already see.
 */
function parkCard(card: HTMLElement) {
  const top = freezeTopOf(card);
  const scroller = scrollingAncestor(card);

  if (!scroller) {
    const delta = card.getBoundingClientRect().top - top;
    window.scrollTo({
      top: Math.max(0, window.scrollY + delta),
      behavior: "smooth",
    });
    return;
  }

  const delta =
    card.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTo({
    top: Math.max(0, scroller.scrollTop + delta - 14),
    behavior: "smooth",
  });
}

/** The nearest ancestor that actually scrolls, or null for the document. */
function scrollingAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const overflow = getComputedStyle(node).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
