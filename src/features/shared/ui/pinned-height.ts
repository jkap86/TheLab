import { useEffect, useRef } from "react";

/**
 * The custom property {@link usePinnedHeight} writes, registered at `0px` in
 * `globals.css` so the `calc()`s reading it stay valid on a page that pins no
 * heading rail at all — and so a page that unmounts one falls back rather than
 * holding the last height it saw.
 */
export const PINNED_HEIGHT_VAR = "--list-ledge-h";

/**
 * Publishes the pinned heading rail's own height, for the one thing that has to
 * pin directly beneath it.
 *
 * **It used to measure the manager plate, and what moved is which part holds the
 * top.** The plate, the subject rail and this rail were one pinned box, so the
 * offset a row had to clear was the whole of it; the plate and the filter row
 * scroll away now and the rail alone stays, so the offset is the rail. Nothing
 * else about the exception changed: anything that belongs *with* a pinned part
 * rides inside it, and what forced a measurement is a part that cannot — an
 * expanded league card is the list's own row, pinned under this rail and capped
 * at what is left of the screen.
 *
 * There is no constant to write it as, which is the whole reason it is measured:
 * below `sm` the rail takes a second line — the subject heading over the four
 * columns, the way the cards' own columns stack — so its height is whatever the
 * width being read makes it.
 *
 * It goes on the document root beside `--site-header-h` rather than on a shared
 * ancestor, because the reader is not one: the card is several levels down a
 * list that is a sibling of this rail, so the nearest element both can see is
 * the page shell — which would have to be told about a rail it does not render.
 * One property, one writer, and the cleanup restores the registered `0` so a
 * page that unmounts its rail does not leave a stale offset behind for the next
 * one.
 *
 * `enabled` is what keeps that promise of one writer: the shares sheet draws the
 * same rail inside a dialog, where it is not pinned and where publishing a
 * height would point an open league card at an offset belonging to a list on a
 * different surface. A flag rather than a conditional call, since a hook cannot
 * be one.
 *
 * A plain effect rather than a layout one: it would warn on the server render,
 * and there is nothing to be early for — the variable is read only by a card the
 * reader has pressed open, which cannot happen before the first effect has run.
 */
export function usePinnedHeight<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const root = document.documentElement;

    // `getBoundingClientRect` rather than `offsetHeight`, for the fractional
    // pixel: the rail's height is content-driven, so rounding it down leaves a
    // hairline of the list showing above a card that is supposed to be flush
    // against it. Margins are deliberately outside the number — the card pins
    // against the rail's border box, which is where the paint stops.
    const publish = () =>
      root.style.setProperty(PINNED_HEIGHT_VAR, `${el.getBoundingClientRect().height}px`);

    publish();
    // Observed rather than measured once: the rail grows and shrinks under a
    // reader's hand — it takes a second line below `sm`, so a resize across that
    // breakpoint changes it. A stale height is an open card overlapping the rail
    // or floating a gap below it, which is the failure this exists to prevent.
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(PINNED_HEIGHT_VAR);
    };
  }, [enabled]);

  return ref;
}
