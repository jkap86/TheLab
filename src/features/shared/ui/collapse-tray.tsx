"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";

/**
 * A collapsible shell whose open height is **measured**.
 *
 * It came out of `player-filters.tsx`, where the players drawer's four facets
 * ride in one, when the leaguemate panel's expanded row became a second reader
 * — the line `CONSOLE_KEY` and `ManagerPlate` moved on. What is here is the
 * mechanism; the two callers keep their own surfaces and their own layout,
 * which is what the two class props are for.
 *
 * **The open height is measured, not a `0fr`→`1fr` grid row.** Chrome's `fr`
 * interpolation stalls whenever the subtree is written to in the same frame,
 * which leaves the tray frozen open with nothing on screen saying why — and a
 * `max-height` guess either clips a wrapped row of chips or eases against a
 * number nothing on screen matches. The inner wrapper is unconstrained (the
 * shell above it does the clipping) so its `offsetHeight` is the natural
 * content height, and a `ResizeObserver` on it is what keeps that true when a
 * chip row wraps or the panel is resized under an open tray.
 *
 * **The transition list is identical in both states.** Rewriting `transition`
 * in the same frame as the animated property cancels the transition, which is
 * why the closed state carries opacity and a margin and nothing else — and why
 * focus is taken out of the collapsed tray with `inert` rather than with a
 * `visibility` that would have to be delayed.
 *
 * **`inert` is what takes the collapsed controls out of the tab order.**
 * `pointer-events: none` stops the mouse and nothing else; without it a
 * keyboard reader tabs out of the control above into an invisible panel.
 *
 * `min-h-0` is kept for the reason it is on every list tray in this folder:
 * `min-height: auto` is a content-based floor that would pin a collapsed flex
 * item at its open height the moment this is laid out in a column.
 */
export function CollapseTray({
  id,
  open,
  className = "",
  closedClassName = "",
  children,
}: {
  id?: string;
  open: boolean;
  /** The shell's own layout, in both states — a basis, a margin, a width. */
  className?: string;
  /**
   * What the shell carries **only while shut**, beside the opacity and the
   * pointer guard below. The players drawer cancels its row's gap with a
   * negative margin here; a tray inside a list row wants nothing.
   */
  closedClassName?: string;
  children: ReactNode;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const tray = trayRef.current;
    if (!shell || !tray) return;
    const apply = () => {
      shell.style.height = open ? `${tray.offsetHeight}px` : "0px";
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(tray);
    return () => observer.disconnect();
  }, [open]);

  return (
    <div
      ref={shellRef}
      // `lab-anim` is the app's marker for anything decorative that moves, so
      // reduced motion opens the tray at once rather than not at all.
      className={`lab-anim min-h-0 shrink-0 overflow-hidden [transition:height_260ms_cubic-bezier(0.2,0.9,0.3,1),opacity_200ms_ease,margin-top_260ms_cubic-bezier(0.2,0.9,0.3,1)] ${className} ${
        open ? "opacity-100" : `pointer-events-none opacity-0 ${closedClassName}`
      }`}
    >
      <div ref={trayRef} id={id} inert={!open}>
        {children}
      </div>
    </div>
  );
}
