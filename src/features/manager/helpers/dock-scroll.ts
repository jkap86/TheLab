/**
 * Whether the floating Browse dock stands, read off the page's scroll.
 *
 * The dock leaves on the way down, and comes back on the way up **or when the
 * page comes to rest** — so what sends it away is scrolling rather than having
 * scrolled. That is the whole bargain for a control pinned over a page's own
 * content: it is in thumb reach at any depth, it is not sitting on the card a
 * reader is scrolling toward, and it is there again by the time they have
 * stopped to read one. See {@link DOCK_SETTLE_MS} for why the second half is
 * not optional here.
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

/**
 * How long the page has to be still before the dock comes back on its own.
 *
 * **The direction rule alone is the wrong shape for these two keys.** It takes
 * the dock away on the way down and returns it only on the way up, which is
 * the ordinary bargain for a control that is a shortcut — and these are the
 * page's two exits. A reader who has scrolled to the card they wanted and
 * stopped would have to scroll *back*, away from the thing they are reading,
 * to reach them; and that is worst at the foot of the list, where there is
 * nothing left to scroll up for and the dock is away precisely because the
 * reader arrived.
 *
 * So a reader who has stopped is a reader who wants the keys back. What the
 * direction rule still does is take them out from under a finger that is
 * moving down the page; this is what makes the hiding a property of
 * *scrolling* rather than of where the reader ended up.
 *
 * 700ms is silence rather than a pause: momentum keeps the events coming for
 * the length of a flick, so what has to elapse is a gap between gestures. It
 * is short enough that the return reads as a consequence of stopping. A reader
 * who genuinely rests longer than this between two flicks of one long scroll
 * sees the dock come back and go away again, which is one flicker and the
 * accepted cost — and the number is the one thing here only a real page can
 * settle.
 */
export const DOCK_SETTLE_MS = 700;

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

/**
 * Stand the dock up where the page has come to rest.
 *
 * Returns `prev` **by identity** where it already stands, so a settle that
 * fires on a dock that never left is a no-op rather than a re-render of a
 * hundred league cards.
 *
 * The baseline is deliberately **kept** rather than cleared. It is already the
 * position of the last event before the silence, which is exactly where the
 * next delta should be measured from — so keeping it means the reader's next
 * scroll is read as a direction rather than spent on a baseline the rule
 * already has. The null is for the page's *own* jumps and nothing else; see
 * {@link DockScroll.from}.
 */
export function dockRested(prev: DockScroll): DockScroll {
  return prev.docked ? prev : { from: prev.from, docked: true };
}
