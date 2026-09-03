"use client";

import { useEffect, useRef } from "react";

import type { ManagerLeague } from "@/shared/contract";

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
 * **The sentinel sits two viewports early** (`rootMargin`), so the next page is
 * usually in hand before the reader reaches the end of this one — a spinner at
 * the bottom of a list is the failure this avoids, not a feature to add.
 */
export function TradesList({
  data,
  leaguesById,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  data: TradesData;
  leaguesById: Map<string, ManagerLeague>;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
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
      <ul className="space-y-6">
        {data.trades.map((trade) => (
          <TradeCard
            key={trade.transaction_id}
            trade={trade}
            league={leaguesById.get(trade.league_id) ?? null}
            data={data}
          />
        ))}
      </ul>

      {/* Rendered whenever there is more, so the observer has something to
          watch; the note under it only appears while a page is actually in
          flight. */}
      {hasMore && (
        <div ref={sentinel} className="pt-8 text-center">
          <p
            aria-live="polite"
            className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60"
          >
            {loadingMore ? "Loading more trades…" : ""}
          </p>
        </div>
      )}
    </>
  );
}
