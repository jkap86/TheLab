"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";

import type {
  KtcBoardChoice,
  LineupColumn,
  ManagerLeague,
  TradeValueBasis,
} from "@/shared/contract";
import { BubblingFlask, type ActiveCard } from "@/features/shared";

import type { TradesData } from "../trades-data";
import { TradeCard } from "./trade-card";
import { ValueLensProvider, type ValueLensChoice } from "./value-lens-context";

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
 *
 * **And it is not rendered at all while a card is parked**, which is this
 * list's own half of the active-card change. Parked, every row but the open one
 * is `display: none` and the page does not scroll — so the sentinel would be a
 * node with no box, two viewports up a list nobody can move, and whether it
 * counted as intersecting would be the browser's business rather than the
 * reader's. `hasMore` is untouched: the *server* still says there is more, and
 * the walk picks up exactly where it was the moment the card closes.
 */
export function TradesList({
  data,
  card,
  listRef,
  leaguesById,
  basis,
  board,
  teamsColumn,
  season,
  username,
  summaryFolded,
  onToggleReadings,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
  onRetry,
}: {
  data: TradesData;
  /**
   * Which card is open, and the press that opens one — see `useActiveCard`.
   * The three fields a card reads off it are stable for every row but the two
   * that moved, which is what keeps `TradeCard`'s `memo` worth having.
   */
  card: ActiveCard;
  /** The list itself: while a card is parked it is the shell. */
  listRef: RefObject<HTMLUListElement | null>;
  leaguesById: Map<string, ManagerLeague>;
  /**
   * The reader's value basis and KeepTradeCut market, read from the store once
   * (in `TradesHome`) rather than inside each card: `TradeCard` is `memo`'d
   * over a list that can run to hundreds of rows, and a hook inside it would
   * subscribe every one of them to the same two values. They reach the cards
   * through `ValueLensProvider` below rather than as card props, so a flip
   * re-renders the side columns that print a figure and not every card whole —
   * see `value-lens-context` for why that is not the subscription this avoids.
   */
  basis: TradeValueBasis;
  board: KtcBoardChoice;
  /**
   * What the standings pane inside an open card reads — passed down on `basis`
   * and `board`'s own rule, and separate from `board` because the two answer
   * different questions: that one prices the *assets* printed on every card,
   * this one prices the league behind one card's disclosure. See `TradeCard`.
   */
  teamsColumn: LineupColumn;
  /**
   * The season and the reader's own account, passed straight through to every
   * card: an opened card solves and rewinds the league it names, and both of
   * those decide which boards answer. Props rather than hooks inside the card,
   * on `basis` and `board`'s own rule one line up — see `TradeCard`.
   */
  season: string;
  username: string | null;
  /**
   * Whether an open card's two hauls are folded away, and the press that
   * brings them back.
   *
   * Composed at the page rather than here, and per card: `isOpen(id) &&
   * !readingsShown` is false for every row but the one that is open, so a
   * reader flipping the preference re-renders that card and nothing else. Read
   * as itself it would be one boolean changing on every loaded row — the
   * subscription `basis` and `board` are threaded to avoid, arrived at from
   * the other direction. See `useSummaryReadings`.
   */
  summaryFolded: (id: string) => boolean;
  /** The `Assets` key's press — a module-level function, so the memo holds. */
  onToggleReadings: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  /** A later page failed. The cards above it stay exactly as they are. */
  loadMoreError: string | null;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);

  // Memoised on the two fields, never rebuilt per render: the provider's value
  // is compared by identity, and a fresh object on every appended page would
  // re-render every consumer on the board to change nothing.
  const lens = useMemo<ValueLensChoice>(() => ({ basis, board }), [basis, board]);

  useEffect(() => {
    if (!sentinel || !hasMore) return;
    const node = sentinel;

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
  }, [hasMore, onLoadMore, sentinel]);

  return (
    <>
      {/* **The list is the parked shell.** `shellProps` is a measured height,
          the plate's overhang as padding and a scroller that engages only where
          the panel hit its floor — which on this board is the one card that
          reaches it, its summary carrying both hauls in full. Off it the object
          is `{}` and this is the list it always was.

          `[overflow-anchor:none]` is `leagues-home.tsx`'s finding: opening a
          card grows content above the viewport's anchor and the browser
          compensates by moving `scrollTop`, which lands the park somewhere
          arbitrary and reads as its having missed. */}
      <ul
        ref={listRef}
        {...card.shellProps}
        className="space-y-[1.875rem] [overflow-anchor:none]"
      >
        <ValueLensProvider value={lens}>
          {data.entries.map(({ trade, view }) => (
            <TradeCard
              key={trade.transaction_id}
              trade={trade}
              league={leaguesById.get(trade.league_id) ?? null}
              view={view}
              teamsColumn={teamsColumn}
              season={season}
              username={username}
              open={card.isOpen(trade.transaction_id)}
              lit={card.isLit(trade.transaction_id)}
              onToggle={card.toggle}
              summaryFolded={summaryFolded(trade.transaction_id)}
              onToggleReadings={onToggleReadings}
            />
          ))}
        </ValueLensProvider>
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
      {card.parked ? null : loadMoreError ? (
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
          // **The sentinel renders whenever there is more**, exactly as it did:
          // the observer needs a node to watch, and gating the *div* on
          // `loadingMore` would leave nothing to trip the next page. Only the
          // note inside it is conditional, which is what it always was — the
          // flask simply replaces the empty string beside the words.
          <div ref={setSentinel} className="pt-8">
            {/* **The live region is rendered whether or not it says anything**,
                which is what it always was — an empty `<p>` that gained its
                text. A region added to the document in the same frame as its
                content is unreliably announced, so the box stays and the
                contents swap. It has no height while empty. */}
            <div
              role="status"
              aria-live="polite"
              className="flex items-center justify-center gap-3"
            >
              {loadingMore ? (
                <>
                  {/* Decoration: the copy beside it is the announcement, and a
                      named flask would be the same news read twice. 32px is not
                      one of the three sizes the design names, so it takes the
                      well's bubble set by size band rather than a set of its
                      own — see `BubblingFlask`, where the floor that decides
                      it is. */}
                  <BubblingFlask size={32} label={null} />
                  <p className="m-0 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
                    Loading more trades
                    <span
                      className="lab-anim"
                      style={{ animation: "fl-ellipsis 1.4s ease-in-out infinite" }}
                    >
                      …
                    </span>
                  </p>
                </>
              ) : null}
            </div>
          </div>
        )
      )}
    </>
  );
}
