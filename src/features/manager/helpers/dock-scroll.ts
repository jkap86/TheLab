/**
 * Whether the floating Browse dock stands, read off the page's scroll.
 *
 * The dock leaves on the way down and comes back on the way up, which is the
 * ordinary bargain for a control pinned over a page's own content: it is in
 * thumb reach at any depth, and it is not sitting on the card a reader is
 * scrolling toward.
 *
 * **It is a pure function rather than four lines inside the listener** for the
 * reason `seat-compare.ts` and `player-filters.ts` are: every one of the rules
 * below renders perfectly while being wrong. A flipped comparison is a dock
 * that hides on the way *up*, a threshold spent on the wrong side of the
 * branch is one that flickers through a flick, and a baseline updated where it
 * should not be is one that never leaves at all — none of which throws, and
 * none of which a render of a settled page would show.
 *
 * The caller holds one of these in a ref and only re-renders when `docked`
 * moves; see `browse-dock.tsx`.
 */
export type DockScroll = {
  /**
   * The position the next delta is measured from — or **null for "not read
   * yet"**, which is not the same as zero and is the whole of how the page's
   * own jumps are kept out of this.
   *
   * `useActiveCard` scrolls the window twice per card: to the top when it parks
   * one, and back to wherever leaves that card on the line it is standing on
   * when it closes. Both land as ordinary `scroll` events, and the second is a
   * large positive delta that is emphatically not the reader scrolling away —
   * read as one it would hide the dock every time a card was closed. So the
   * caller nulls this whenever the page is handed back, and the first event
   * after that sets the baseline and decides nothing.
   *
   * The cost is that where no jump follows, one genuine scroll is spent on the
   * baseline instead. It is at most one event, and the dock is standing at that
   * point by construction, so what it buys is a fraction of a gesture.
   */
  from: number | null;
  /** Whether the dock stands. */
  docked: boolean;
};

/**
 * The delta a scroll has to clear before it is read as a direction.
 *
 * Under it the baseline is deliberately **not** moved, so a slow drift still
 * accumulates into a decision rather than being filtered away one pixel at a
 * time. What it is for is the flick: momentum scrolling reverses by a few
 * pixels as it settles, and at no threshold the dock flickers out and back
 * under a finger that has stopped moving.
 */
export const DOCK_JITTER_PX = 6;

/**
 * Where the dock stands whatever the direction: the top of the page.
 *
 * A reader at the head of the list has not chosen to send the dock away, and a
 * short page that cannot scroll past this never hides it at all — which is the
 * honest state for a page with nothing to scroll through.
 */
export const DOCK_FLOOR_PX = 24;

/** The resting state: standing, with no baseline read yet. */
export const DOCK_AT_REST: DockScroll = { from: null, docked: true };

/**
 * Fold one scroll position in.
 *
 * Returns `prev` **by identity** where nothing moved, so the caller can skip
 * the re-render without comparing fields — which on this page is a hundred
 * league cards per render rather than a wasted diff.
 */
export function dockScroll(prev: DockScroll, y: number): DockScroll {
  if (prev.from === null) return { from: y, docked: prev.docked };

  const dy = y - prev.from;
  if (Math.abs(dy) < DOCK_JITTER_PX) return prev;

  const docked = dy < 0 || y < DOCK_FLOOR_PX;
  if (docked === prev.docked && y === prev.from) return prev;
  return { from: y, docked };
}
