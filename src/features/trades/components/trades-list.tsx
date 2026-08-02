"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";

import type { ManagerLeague } from "@/shared/manager";

import type { TradeMetric } from "../trade-metrics";
import type { KtcValue, PlayerSummary, Trade, TradeManager } from "../types";
import { TradeCard } from "./trade-card";

/** The gap between cards, in px — `gap-3`, which absolute layout can't apply. */
const CARD_GAP = 12;

/**
 * A first guess at a card's height, replaced by a real measurement the moment
 * the card mounts. It only decides how far the scrollbar lies before the reader
 * has been there, so the cost of being wrong is a scrollbar that resettles as
 * you scroll — worse the further off it is, harmless when it is close.
 *
 * Sized for the common two-sided trade of a player or two, which is most of any
 * season, rather than for the average including the three-way monsters: guessing
 * high makes the bar shrink under the thumb on nearly every card, where guessing
 * a little low grows it on a few.
 */
const ESTIMATED_CARD_HEIGHT = 168;

/**
 * How many cards from the end the next page is asked for.
 *
 * Deep enough that an ordinary flick lands inside the buffer rather than on the
 * spinner, shallow enough that a reader who stops after two screens has not
 * pulled a third page they will never look at. A page is 200 cards, so this asks
 * at 90% of the way down.
 */
const PREFETCH_MARGIN = 20;

/**
 * The trades, windowed — only the cards near the viewport are in the DOM.
 *
 * **This is what lets the board be the whole season.** Rendering the real number
 * as ordinary elements is not an option: a busy season is ~48k cards, each with
 * a header, two or three side columns and a row per asset, which is a few
 * million nodes and a layout pass no phone finishes. Virtualising makes the count
 * irrelevant to everything but the scrollbar — the ~20 cards on screen cost what
 * 20 cards cost whether the list behind them is two thousand or fifty.
 *
 * It virtualises the **window**, not a scroll box of its own, and that is the
 * decision worth keeping. A fixed-height inner scroller would be easier to
 * measure and would take the page's own scrolling away from it: the pinned app
 * bar, the header scrolling off, the browser's own overscroll and find-in-page
 * all belong to the document, and a list that scrolls inside a box on a phone is
 * a scroll trap that captures the gesture meant for the page. So the document
 * scrolls, and `scrollMargin` tells the virtualizer how much page sits above the
 * list — measured rather than assumed, since the header above it wraps to a
 * different height at different widths and with different filter summaries.
 *
 * Heights are measured, not computed. A card is one line or six depending on how
 * many assets moved and how the sides stack at that width, so `estimateSize` is
 * only what the scrollbar believes before a card has been seen; `measureElement`
 * replaces it with the truth on mount and on resize. That is also why the gap
 * between cards is padding *inside* each measured item rather than a `gap` on a
 * flex parent — absolutely positioned children have no parent to space them, and
 * a gap the virtualizer doesn't know about is a drift that compounds down the
 * list.
 */
export function TradesList({
  trades,
  leaguesById,
  players,
  managers,
  metric,
  ktc,
  headerRef,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  trades: readonly Trade[];
  leaguesById: ReadonlyMap<string, ManagerLeague>;
  players: Record<string, PlayerSummary>;
  managers: Record<string, TradeManager>;
  /** The metric every card's value column shows — one selection for the list. */
  metric: TradeMetric;
  ktc: Record<string, KtcValue>;
  /**
   * Everything laid out above the list. Watched for size changes, because how
   * far down the page the list starts is exactly what `scrollMargin` is — see
   * the effect below for why it is this element and not the body.
   */
  headerRef: React.RefObject<HTMLElement | null>;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Where the list starts down the page, which is what translates a window
  // scroll offset into an index. A stale value offsets every card by however
  // much the header above moved, so it is re-read whenever that can happen.
  //
  // **Observing the header rather than `document.body`**, which is what this
  // used to do and is the wrong target twice over. The body's box grows and
  // shrinks with *this list's own* height — every measured card, every page
  // appended, every filter change — so the observer fired constantly, and each
  // firing did a `getBoundingClientRect` that forces a synchronous reflow. It
  // was self-triggering (which is why the `setState` below has to be guarded
  // against a loop at all) and none of that traffic could tell it anything: the
  // list moving down the page is caused by what is *above* it, and nothing else.
  // The header is that thing, so this now fires when the header actually
  // rewraps — a handful of times in a session instead of once per card measured.
  //
  // Deliberately not re-measured every render. This component re-renders on
  // every scroll frame, and `getBoundingClientRect` in a layout effect forces a
  // reflow — per frame, that is the whole cost virtualising was for.
  useLayoutEffect(() => {
    const measure = () => {
      const el = listRef.current;
      if (!el) return;
      const next = el.getBoundingClientRect().top + window.scrollY;
      // Still guarded: a header whose own height didn't change can still report
      // a resize, and an unguarded set is a render loop.
      setScrollMargin((prev) => (prev === next ? prev : next));
    };

    measure();
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    const header = headerRef.current;
    if (header) observer.observe(header);
    return () => {
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [headerRef]);

  const virtualizer = useWindowVirtualizer({
    count: trades.length,
    estimateSize: () => ESTIMATED_CARD_HEIGHT + CARD_GAP,
    // Keyed by the trade rather than the index, so measurements survive the list
    // growing underneath them. It grows at the *end* as pages arrive, but a
    // filter change reshuffles it entirely, and an index-keyed cache would hand
    // every card the height of whatever used to sit at its position.
    getItemKey: (index) => trades[index].transaction_id,
    overscan: 6,
    scrollMargin,
  });

  const items = virtualizer.getVirtualItems();

  // The scroll-driven half of pagination: when the window reaches within
  // `PREFETCH_MARGIN` cards of the end, ask for the next page. Reading the last
  // rendered index rather than hanging an IntersectionObserver off a sentinel
  // costs no extra DOM and no second observer, and the virtualizer has already
  // computed the number.
  //
  // The effect is the right place despite this component re-rendering per scroll
  // frame: `lastIndex` only changes when the window moves past a card boundary,
  // so the dependency array is what throttles it. `onLoadMore` no-ops while a
  // page is in flight, so a fast scroll asks repeatedly and fetches once.
  const lastIndex = items.length ? items[items.length - 1].index : -1;
  useEffect(() => {
    if (!hasMore || loadingMore) return;
    if (lastIndex >= trades.length - PREFETCH_MARGIN) onLoadMore();
  }, [lastIndex, trades.length, hasMore, loadingMore, onLoadMore]);

  return (
    <ul
      ref={listRef}
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {items.map((item) => {
        const trade = trades[item.index];
        return (
          <li
            key={item.key}
            // `measureElement` reads this to know which item it just measured.
            data-index={item.index}
            ref={virtualizer.measureElement}
            // The window's own count, not the DOM's: only a couple of dozen
            // cards exist at a time, and without these a screen reader would
            // announce the list as being that long.
            aria-setsize={trades.length}
            aria-posinset={item.index + 1}
            className="absolute left-0 top-0 w-full"
            style={{
              // Positioned by transform rather than `top` so scrolling doesn't
              // dirty layout for the cards that didn't move. The margin comes
              // back off because `start` is measured down the whole document
              // while this is positioned from the list's own top edge.
              transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              // The gap, carried inside the measured box — see above.
              paddingBottom: CARD_GAP,
            }}
          >
            <TradeCard
              trade={trade}
              league={leaguesById.get(trade.league_id) ?? null}
              players={players}
              managers={managers}
              metric={metric}
              ktc={ktc}
            />
          </li>
        );
      })}
    </ul>
  );
}
