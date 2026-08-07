import { useEffect, useRef } from "react";

/**
 * The custom property {@link usePinnedHeight} writes, registered at `0px` in
 * `globals.css` so the `calc()`s reading it stay valid on a page that draws no
 * plate at all — and so a page that unmounts one falls back rather than holding
 * the last height it saw.
 */
export const PINNED_HEIGHT_VAR = "--manager-header-h";

/**
 * Publishes the pinned header's own height, for the one thing that has to pin
 * directly beneath it.
 *
 * **This is the measurement the header's `columns` note says it avoids, and the
 * exception is narrow rather than a reversal.** Anything that belongs *with* the
 * plate rides inside it — the subject rail and the heading billet are `columns`
 * for exactly that reason, and a sibling offset by a measured height would be
 * machinery bought for nothing. What forced this is a part that cannot ride
 * inside: an expanded league card is the list's own row, pinned under the plate
 * and capped at what is left of the screen. It used to unpin the plate instead,
 * which is what made the offset a constant — the card sat under the app bar,
 * whose height is a variable in `globals.css`. With the plate holding the top
 * through an open card, that offset is the plate's height, and the plate's
 * height is whatever its scope line and filter row wrap to.
 *
 * It goes on the document root beside `--site-header-h` rather than on a shared
 * ancestor, because the reader is not one: the card is several levels down a
 * list that is a sibling of this header, so the nearest element both can see is
 * the page shell — which would have to be told about a header it does not
 * render. One property, one writer, and the cleanup restores the registered `0`
 * so a page that unmounts its plate does not leave a stale offset behind for
 * the next one.
 *
 * A plain effect rather than a layout one: it would warn on the server render,
 * and there is nothing to be early for — the variable is read only by a card the
 * reader has pressed open, which cannot happen before the first effect has run.
 */
export function usePinnedHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;

    // `getBoundingClientRect` rather than `offsetHeight`, for the fractional
    // pixel: the plate's height is content-driven, so rounding it down leaves a
    // hairline of the list showing above a card that is supposed to be flush
    // against it. Margins are deliberately outside the number — the card pins
    // against the plate's border box, which is where the paint stops.
    const publish = () =>
      root.style.setProperty(PINNED_HEIGHT_VAR, `${el.getBoundingClientRect().height}px`);

    publish();
    // Observed rather than measured once: the plate grows and shrinks under a
    // reader's hand — the sync-state line arrives and leaves, the scope line
    // takes a second row when a filter is added, and the whole filter row
    // rewraps on a resize. A stale height is an open card overlapping the plate
    // or floating a gap below it, which is the failure this exists to prevent.
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(PINNED_HEIGHT_VAR);
    };
  }, []);

  return ref;
}
