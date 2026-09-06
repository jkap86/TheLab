"use client";

import { useEffect, useRef } from "react";

import type {
  KtcBoardChoice,
  ManagerLeague,
  TradeValueBasis,
} from "@/shared/contract";

import type { TradesData } from "../trades-data";
import { TradeCard } from "./trade-card";

/**
 * The board itself: every loaded trade, newest first, with the next page
 * fetched as the reader approaches the end.
 *
 * **No virtualizer**, which is where this parts company with TheLabX's list.
 * That board windows forty thousand rows; this one is fed by manager lookups,
 * so a deep scroll is hundreds of cards rather than thousands, and a windowing
 * dependency for that is a dependency this app does not have to take. The cost
 * is real and bounded: every loaded card stays in the DOM, which is why the
 * page size is a hundred rather than TheLabX's two hundred.
 *
 * The bound is worth stating, since it is what decides whether that stays true:
 * at a hundred a page a reader has to scroll through ten pages to reach a
 * thousand cards, and the sentinel only fires as they get there. The threshold
 * to revisit it at is a **DOM** one rather than a render one — the render cost
 * is fixed by the memoisation below — so it is the page size, not the fold,
 * that would change first. **Not added now**: it would have to preserve the
 * infinite-scroll sentinel and the card's own `<details>` expansion state, and
 * neither is worth the complexity against a board this size.
 *
 * **Each card is handed its own page's enrichment, not the board's.** That is
 * the whole of why appending a page is cheap: `data.entries` carries one
 * `view` per page, shared by that page's trades and never rebuilt, so a card's
 * props are fixed from its first render and `memo` holds for everything but the
 * cards that just arrived. Passing the folded object instead — which is a new
 * object on every page — meant every card on the board re-rendered on every
 * append, so the cost of loading page twenty was twenty pages of re-renders.
 * See `trades-data` for why a page's own maps are the right ones to read.
 *
 * **The sentinel sits two viewports early** (`rootMargin`), so the next page is
 * usually in hand before the reader reaches the end of this one — a spinner at
 * the bottom of a list is the failure this avoids, not a feature to add.
 */
export function TradesList({
  data,
  leaguesById,
  basis,
  board,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
  onRetry,
}: {
  data: TradesData;
  leaguesById: Map<string, ManagerLeague>;
  /**
   * The reader's value basis and KeepTradeCut market, passed down rather than
   * read from the store inside each card: `TradeCard` is `memo`'d over a list
   * that can run to hundreds of rows, and a hook inside it would subscribe
   * every one of them to the same two values.
   */
  basis: TradeValueBasis;
  board: KtcBoardChoice;
  hasMore: boolean;
  loadingMore: boolean;
  /** A later page failed. The cards above it stay exactly as they are. */
  loadMoreError: string | null;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      // Two viewports of lead time. The hook's own guards make a duplicate call
      // a no-op, so an observer that fires twice while a page is in flight
      // costs nothing.
      { rootMargin: "200% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  return (
    <>
      <ul className="space-y-[1.875rem]">
        {data.entries.map(({ trade, view }) => (
          <TradeCard
            key={trade.transaction_id}
            trade={trade}
            league={leaguesById.get(trade.league_id) ?? null}
            view={view}
            basis={basis}
            board={board}
          />
        ))}
      </ul>

      {/* A failed page, said where it happened and with the one control that
          answers it. **The cards above are untouched** — that is the whole
          point of the split, and it is why this is a line under the list rather
          than the page's own error state.

          The sentinel is not rendered while this is standing, which is what
          suspends the automatic walk: the observer would otherwise be watching
          a node two viewports up and retry against a failing route on every
          scroll. `hasMore` is still true, because the *server* still says there
          is more — see `useTrades`. */}
      {loadMoreError ? (
        <div className="pt-8 text-center">
          <p
            role="alert"
            className="m-0 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-error"
          >
            {loadMoreError}
          </p>
          <button
            type="button"
            onClick={onRetry}
            disabled={loadingMore}
            className="mt-3 rounded-full border border-foreground/10 bg-[image:var(--key-bg)] px-4 py-2 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout active:translate-y-0.5 disabled:opacity-50"
          >
            {loadingMore ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : (
        // Rendered whenever there is more, so the observer has something to
        // watch; the note under it only appears while a page is actually in
        // flight.
        hasMore && (
          <div ref={sentinel} className="pt-8 text-center">
            <p
              aria-live="polite"
              className="font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60"
            >
              {loadingMore ? "Loading more trades…" : ""}
            </p>
          </div>
        )
      )}
    </>
  );
}
