"use client";

import { createContext, useContext, type ReactNode, type RefObject } from "react";

/**
 * The box a shares list scrolls inside, where it has one.
 *
 * **A context and not a prop, and the reason is a seam rather than a
 * preference.** The scroller belongs to {@link SharesSheet} — the well below the
 * columns bar, which is there whether or not there are rows to draw — and the
 * list is the caller's, handed back through a render prop. So the element has to
 * cross from a parent to a grandchild past a function boundary, and the two
 * other ways of doing that are both worse: threading it as an argument of that
 * render prop is passing a ref *into a call during render*, which React's own
 * lint rule rejects (a ref read while rendering is a value React has not
 * promised is current), and finding it from below with a `querySelector` is a
 * child reaching for a fact its parent is holding, which answers differently the
 * first time one of these lists is drawn anywhere else.
 *
 * **Absent means "draw the whole list", which is a real answer and not a
 * fallback.** The two manager tabs render the same lists against the document's
 * own scrolling, with a pinned heading rail above them; there is no box, so there
 * is no window, and {@link ShareList} draws every row exactly as it did before.
 */
const SharesScroll = createContext<RefObject<HTMLElement | null> | null>(null);

/** Seat a list inside `value`, so what it draws is a window onto that box. */
export function SharesScrollProvider({
  value,
  children,
}: {
  value: RefObject<HTMLElement | null>;
  // Optional so a caller may pass the subtree as `createElement`'s third
  // argument, which is the spelling React's own lint rule asks for and the one
  // this component's tests use.
  children?: ReactNode;
}) {
  return <SharesScroll.Provider value={value}>{children}</SharesScroll.Provider>;
}

/** The box this list scrolls inside, or null where it scrolls the page. */
export function useSharesScroll(): RefObject<HTMLElement | null> | null {
  return useContext(SharesScroll);
}
