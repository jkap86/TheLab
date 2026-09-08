"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

import {
  COLLAPSE_EASE,
  COLLAPSE_MS,
  measureFreezeTop,
  panelFit,
  panelRoom,
  parkedShell,
  prefersReducedMotion,
  type PanelFit,
} from "./panel-cap";

/**
 * Sizing an open card's expanded half into the parked shell, and collapsing it
 * again when the card closes.
 *
 * **A hook rather than a component**, which is what lets the two shapes of
 * expanded half share one measurement: `/manager` and `/trades` mount
 * {@link ExpandedPanel}, which is an inner housing with its own inset, and
 * `/lineupchecker` mounts a `CONSOLE_HOUSING_INSET` block with a different one.
 * A component would have had to take a `className` for the difference, and two
 * base `p-*` utilities of the same specificity are settled by Tailwind's emit
 * order rather than the class attribute — the trap `CONSOLE_CARD_SHELL` and
 * `CONSOLE_KEY_PILL` are both split to keep a part out of. So the caller keeps
 * its own chrome and this keeps the arithmetic.
 *
 * **The room is measured off the shell, not computed from a chain of
 * constants.** While a card is parked the list is a box of known height with
 * the card inside it, so what is left under the panel's own top edge is one
 * subtraction of two rects — and being a subtraction of two rects it is
 * scroll-invariant, which the arithmetic form is not once the shell has to
 * scroll. The arithmetic is still here and is still exercised: it is what
 * answers during the ~340ms between a press and the park, when there is no
 * shell yet, and it is the same number, so the panel does not resize as the
 * list stands down around it.
 *
 * **The measurements are taken after layout, never guessed.** The header's
 * height changes with the settings strip's wrap, the league's name and the
 * width, and a `100dvh` estimate is wrong on a phone the moment the URL bar
 * moves. So the cap is read on the frame after the open, and again whenever
 * that box changes size — a `ResizeObserver` on the summary, **and** a `resize`
 * listener beside it, because they are two events: the summary changes height
 * for reasons the window does not (a strip re-wrapping when a lens re-renders
 * it), and the window changes for reasons the summary does not. A window
 * dragged taller — or a phone's URL bar retracting — moves `innerHeight`
 * without moving the summary's box by a pixel, and the observer never fires.
 *
 * **React is the only writer of the panel's style**, which is the constraint
 * the collapse is arranged around: an inline value written from an event
 * handler is the same channel the render writes through, so a transition
 * declared on it races the next re-render. Every phase below is a render, the
 * transition is declared in the same style object as the value it carries, and
 * nothing outside this hook touches the box.
 */

/**
 * How the panel is being sized this frame.
 *
 * There is no intermediate "freeze" render, and **that is a correction rather
 * than a simplification.** A CSS transition needs its from-value to have been
 * painted, so collapsing with one meant rendering the panel frozen at its own
 * measured height, waiting a frame for that to land, and only then setting
 * zero — three renders, the last of them gated on a `requestAnimationFrame`.
 * Driven, the collapse began **330ms** after the press: rAF runs at whatever
 * rate the main thread allows, which under a headless renderer was ~11fps and
 * on a busy page is no better, and the 260ms timer that ends the close does not
 * wait for it. So the card sat still and then vanished.
 *
 * The collapse is a {@link Animation} instead, which is what the handoff asks
 * for and what the prototype does: keyframes carry their own from-value, so
 * nothing has to be painted first and the whole thing starts in the layout
 * effect of the render that begins it. It also keeps the rule that made the
 * transition attractive — React stays the only writer of the panel's `style`,
 * and an animation runs in its own cascade origin above that style, so a
 * re-render mid-collapse cannot clobber it.
 */
type Phase = "shut" | "open" | "collapse";

/** `useLayoutEffect` on the client, `useEffect` where there is no layout. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function usePanelCap<T extends HTMLElement>(
  /** Whether the card's disclosure is open — the panel is in the flow. */
  open: boolean,
  /** Whether it is closing: open for as long as the collapse takes. */
  closing: boolean,
): { ref: RefObject<T | null>; style: CSSProperties | undefined } {
  const ref = useRef<T | null>(null);
  const [fit, setFit] = useState<PanelFit | null>(null);
  /**
   * The box the panel last stood at while open, which is where the collapse
   * starts from.
   *
   * **Recorded while open rather than read when the close begins**, because by
   * then it is too late: the collapse is a render, so the layout effect that
   * runs the animation sees a panel React has already set to zero. A ref rather
   * than state for the same reason it is not a measurement — nothing renders
   * differently for it.
   */
  const openBox = useRef<{ height: number; marginTop: number } | null>(null);

  /**
   * Re-read the room from the shell the card is standing in.
   *
   * Cheap and idempotent — three rects and a `setState` React drops when the
   * number has not moved — because it runs from the observer as well as from
   * the open.
   */
  const measure = useCallback(() => {
    const panel = ref.current;
    const card = panel?.parentElement;
    if (!panel || !card) return;

    // The header's height *and* the panel's margin above it, as one distance:
    // read separately, the margin is a second number to keep in step with a
    // stylesheet, and getting it wrong overhangs the fold by exactly it.
    const offset =
      panel.getBoundingClientRect().top - card.getBoundingClientRect().top;

    openBox.current = {
      height: Math.round(panel.getBoundingClientRect().height),
      marginTop: Number.parseFloat(getComputedStyle(panel).marginTop) || 0,
    };

    const shell = panel.closest("[data-card-shell]");
    if (shell instanceof HTMLElement) {
      // `clientHeight` is the shell's content box, so it carries the plate's
      // overhang as padding — which is why that padding is subtracted here
      // rather than the constant: the shell is the one that set it, and this
      // reads back what it actually did.
      const pad = Number.parseFloat(getComputedStyle(shell).paddingTop) || 0;
      setFit(panelFit(Math.round(shell.clientHeight - pad - offset)));
      return;
    }

    // No shell yet: the press has happened and the list has not stood down.
    // The same number, predicted, so the panel does not resize under the park.
    const { height } = parkedShell(window.innerHeight, measureFreezeTop());
    setFit(panelFit(panelRoom(height, offset)));
  }, []);

  // Measure while open, and stop measuring while shut — so a closed card's
  // panel is never a box with a stale height, and the *next* open reads a
  // header that has laid out at the current width rather than one from whenever
  // it was last open.
  useEffect(() => {
    const panel = ref.current;
    if (!open || !panel) {
      setFit(null);
      return;
    }

    const summary = panel.parentElement?.querySelector(":scope > summary");
    // **The list as well as the header, and the list is the one that is easy to
    // forget.** A press opens the panel against a page that is still scrolling;
    // ~340ms later the list becomes the parked shell and its height changes from
    // the whole document's to the viewport's, which is exactly the box `measure`
    // reads its room out of. Nothing else fires then — the summary has not moved
    // and neither has the window — so without this the panel would keep the cap
    // it *predicted* before the park. The two agree by construction, which is
    // why this is a guard rather than a fix; it is here so that they cannot stop
    // agreeing silently.
    const list = panel.closest("ul");
    const observer = new ResizeObserver(() => {
      // Re-measure only. A header that re-wraps is not a reason to move the
      // page — the reader is looking at something.
      measure();
    });
    if (summary) observer.observe(summary);
    if (list) observer.observe(list);
    window.addEventListener("resize", measure);

    // One frame, so the cap is read from a header that has laid out with the
    // panel in the flow rather than from the one that was there before it.
    const frame = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, measure]);

  /**
   * Run the collapse, from the box the panel was standing at.
   *
   * A **layout effect**, so it starts in the same frame the close does rather
   * than a paint later — and cancelled on cleanup, so a card re-opened inside
   * the 260ms is not left with an animation still driving it to zero.
   */
  useIsomorphicLayoutEffect(() => {
    if (!closing) return;
    const panel = ref.current;
    const box = openBox.current;
    if (!panel || !box) return;
    const animation = panel.animate(
      [
        {
          maxHeight: `${box.height}px`,
          marginTop: `${box.marginTop}px`,
          opacity: 1,
        },
        { maxHeight: "0px", marginTop: "0px", opacity: 0 },
      ],
      {
        duration: prefersReducedMotion() ? 0 : COLLAPSE_MS,
        easing: COLLAPSE_EASE,
      },
    );
    return () => animation.cancel();
  }, [closing]);

  const phase: Phase = !open ? "shut" : closing ? "collapse" : "open";

  return { ref, style: styleFor(phase, fit) };
}

function styleFor(phase: Phase, fit: PanelFit | null): CSSProperties | undefined {
  if (phase === "shut") return undefined;
  if (phase === "open") {
    if (fit === null) return undefined;
    return {
      // The panel takes what the card's column has left, clamped. `flex-basis:
      // auto` and not `0%`: a basis of zero makes the box's hypothetical size
      // nothing, and a card whose panel has not measured yet would open at a
      // height flex invented rather than at its content's.
      flex: "1 1 auto",
      maxHeight: fit.cap,
      // Only where the room is under the floor — see `panelFit`.
      minHeight: fit.minHeight || undefined,
    };
  }
  // **Flex comes out of the equation first**, in the same style the collapse's
  // end state is: left a shrinkable item with a floor, the box would snap to
  // whatever room flex has the moment the floor lifts. Frozen at `0 0 auto` the
  // used height is the animation's and nothing else's.
  //
  // These are the values the panel *ends* at, and the animation above plays
  // over them — so when it finishes there is nothing to hand back to and no
  // fill to hold.
  return { flex: "0 0 auto", minHeight: 0, maxHeight: 0, marginTop: 0, opacity: 0 };
}
