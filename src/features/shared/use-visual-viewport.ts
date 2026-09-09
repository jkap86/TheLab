"use client";

import { useEffect } from "react";

/**
 * Publishes the *visual* viewport's height as `--vvh` on `<html>`.
 *
 * The software keyboard shrinks the visual viewport and leaves the layout
 * viewport alone, and **no CSS unit sees the difference**: `vh` is the large
 * viewport and ignores the keyboard entirely, `dvh` tracks the URL bar and not
 * the keyboard. So a panel sized in either one stays full height behind a
 * keyboard covering half the screen, and a panel centred with `margin: auto`
 * stays centred in the layout viewport rather than moving up.
 *
 * That is what this exists to prevent, and the failure it prevents is the one
 * that reads as something else entirely: when a field in the obscured region
 * takes focus, iOS Safari scrolls the nearest scrollable ancestor to reveal it,
 * and where there is none — a modal `<dialog>` makes the page behind it inert,
 * and `use-active-card`'s park lock takes the last one on the routes that have
 * it — its fallback is to pan and scale the *visual* viewport instead. The
 * offset persists after blur, so it presents as "the page zoomed in and stuck".
 * It is not the under-16px auto-zoom, which `globals.css`'s `touch:` floor
 * already answers: on a device this is happening to, `visualViewport.scale` is
 * 1 and `visualViewport.offsetTop` is above zero.
 *
 * **Written as a variable rather than a resize prop** so the panels reading it
 * stay pure CSS and re-render nothing while the keyboard moves — this fires on
 * every frame of a keyboard animation, and a state update per frame would
 * reconcile a dialog's whole subtree through all of it.
 *
 * Every consumer keeps its existing unit as the fallback (`var(--vvh, 88vh)`),
 * which is what a browser with no `visualViewport` gets, and is why the desktop
 * rendering is unchanged rather than merely equivalent.
 */
export function useVisualViewportHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // Coalesced to a frame: `scroll` and `resize` both fire many times through
    // a keyboard animation, and the write is a style mutation on the document
    // element — the one place a write per event is a layout thrash on every
    // page at once.
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        document.documentElement.style.setProperty("--vvh", `${vv.height}px`);
      });
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      // Removed rather than left at its last value: a stale height outliving
      // the listener that maintains it would cap a dialog against a viewport
      // that has since changed, which is the same class of wrong answer with
      // no symptom.
      document.documentElement.style.removeProperty("--vvh");
    };
  }, []);
}
