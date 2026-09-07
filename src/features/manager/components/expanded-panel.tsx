"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { CONSOLE_HOUSING_INSET_SHELL } from "@/features/shared";

/**
 * The expanded half of a league card: an inner housing that parks its card
 * under the rack and caps itself to whatever viewport is left.
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
 * **The `<details>` is found by walking up rather than passed in**, and that is
 * what keeps the card declarative: there is no ref to thread through the
 * summary, no state to lift, and the disclosure stays exactly the native
 * element it was. `toggle` fires on the element itself and does not bubble, but
 * the listener is on the ancestor we walked to, which is the element it fires
 * on.
 *
 * **Both numbers are measured after layout, never guessed.** The header's
 * height changes with the settings strip's wrap, the league's name, and the
 * width; and a `100dvh` estimate is wrong on a phone the moment the URL bar
 * moves. So the cap is read from the summary's own box on the frame after the
 * open, and again whenever that box changes size — a `ResizeObserver` rather
 * than a resize listener, because the summary changes height for reasons the
 * window does not (the settings strip re-wrapping when a lens re-renders it).
 */

/**
 * How much of the viewport is left for the panel, given a header of this
 * height parked at `--card-freeze-top`.
 *
 * Pure, and exported for the test: every term is a measurement the caller
 * takes, and the arithmetic between them is the thing that renders perfectly
 * while being wrong.
 *
 * The floor is what stops a short viewport — a phone in landscape, a desktop
 * window dragged small — from producing a panel too shallow to hold the rail
 * and a row of either list. Below it the panel is simply taller than the space
 * and the page scrolls to it, which is the behaviour this replaces and is the
 * right fallback: a capped panel that cannot show anything is worse than an
 * uncapped one.
 */
export function panelCap(
  viewport: number,
  /**
   * How far the panel's own top edge sits below the card's — the header's
   * height *and* the panel's margin above it, measured as one distance rather
   * than summed from two. A margin read separately is a second number to keep
   * in step with a stylesheet, and the symptom of getting it wrong is a panel
   * that overhangs the fold by exactly that margin.
   */
  panelOffset: number,
  freezeTop: number,
): number {
  // Breath under the panel, so the housing does not sit flush against the fold.
  const BREATH = 16;
  // **The floor is what the panel's own parts need, not a round number.** The
  // rail is ~72px with its margin, a pane's ledge ~62, and the roster pane's
  // two pinned bars 88 — so under about 320px the glass is shorter than the
  // bars standing on it and the drawer has nowhere to open. Below the floor the
  // panel is simply taller than the space and the page scrolls to it, which is
  // the behaviour this replaces and is the right thing to fall back to: a
  // capped panel that cannot show a row is worse than an uncapped one.
  const MIN = 320;
  return Math.max(MIN, viewport - freezeTop - panelOffset - BREATH);
}

/** `--card-freeze-top` in px, or the token's own value where it cannot be read. */
function freezeTopOf(el: Element): number {
  const raw = getComputedStyle(el).getPropertyValue("--card-freeze-top").trim();
  const px = raw.endsWith("rem")
    ? Number.parseFloat(raw) * 16
    : Number.parseFloat(raw);
  return Number.isFinite(px) ? px : 87;
}

export function ExpandedPanel({ children }: { children: ReactNode }) {
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
   */
  const measure = useCallback(() => {
    const panel = ref.current;
    const card = panel?.parentElement;
    if (!panel || !card) return;
    const offset =
      panel.getBoundingClientRect().top - card.getBoundingClientRect().top;
    setCap(panelCap(window.innerHeight, offset, freezeTopOf(card)));
  }, []);

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
    if (park === 0) return;
    const card = ref.current?.parentElement;
    if (card instanceof HTMLDetailsElement && card.open) parkCard(card);
  }, [park]);

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
    if (card.open) onToggle();
    return () => {
      card.removeEventListener("toggle", onToggle);
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
