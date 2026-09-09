"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Two glass scrollers, mirrored.
 *
 * The lineup checker's week view argues that its two lineups are read *across*
 * — index *N* is the same seat in both, so a reader comparing them wants the
 * two lists to move together — and per-pane scrollers are what would put them
 * out of step. Every row is one of two fixed heights and both panes take the
 * same one, so index *N* sits at the same offset in each and mirroring
 * `scrollTop` is sufficient; nothing has to be measured. The gametime panes are
 * the second reader, which is what brought it here.
 *
 * **The guard is the whole of it.** Writing to one scroller fires the other's
 * `scroll` event, which would write back, and the two would trade events for as
 * long as the reader kept scrolling. `held` is released on the next frame
 * rather than synchronously because the event is dispatched *after* the write.
 *
 * It re-attaches whenever `deps` change, because a caller that replaces one
 * pane replaces the element that is the scroller. The listeners are `passive`,
 * and nothing in the subtree may take `scroll-behavior: smooth` — a smooth
 * scroll animates over frames and would fight a mirror that writes on every
 * one.
 */
export function useLinkedScroll(
  deps: readonly unknown[],
): { left: RefObject<HTMLDivElement | null>; right: RefObject<HTMLDivElement | null> } {
  const left = useRef<HTMLDivElement | null>(null);
  const right = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const a = left.current;
    const b = right.current;
    if (!a || !b) return;

    let held = false;
    const mirror = (from: HTMLElement, to: HTMLElement) => () => {
      if (held) return;
      held = true;
      to.scrollTop = from.scrollTop;
      requestAnimationFrame(() => {
        held = false;
      });
    };
    const onLeft = mirror(a, b);
    const onRight = mirror(b, a);
    a.addEventListener("scroll", onLeft, { passive: true });
    b.addEventListener("scroll", onRight, { passive: true });
    return () => {
      a.removeEventListener("scroll", onLeft);
      b.removeEventListener("scroll", onRight);
    };
    // The caller names what replaces a scroller; the hook cannot know.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { left, right };
}
