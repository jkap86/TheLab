"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { AdpPlayerPayload } from "@/shared/contract";
import type { ManagerLeague } from "@/shared/manager";

import type { ShareMetric, ShareMetricContext } from "../../share-metrics.ts";
import { ShareCard } from "./share-card";
import { shareWindowOptions } from "./share-window.ts";
import { useSharesScroll } from "./shares-scroll";

/** What this list needs of a row: something to name it, and what it expands to. */
export type ShareRow = {
  name: string;
  leagues: ManagerLeague[];
};

/** Everything a row of either kind is drawn from — see {@link ShareList}. */
type ShareListProps<T extends ShareRow> = {
  rows: T[];
  /** Leagues the shares are out of — see each view's own `league_count`. */
  leagueCount: number;
  rowKey: (row: T) => string;
  /** Leads the name: a position pill, an avatar — whatever identifies the row. */
  icon: (row: T) => React.ReactNode;
  /** A dim trailing detail on the name, where the row has one. */
  note?: (row: T) => string | null;
  /** The catalogue this list's columns pick from. */
  metrics: ShareMetric[];
  /** The metric key each of the four stat columns shows. */
  columns: string[];
  /**
   * This row's entry on the selected ADP board, for the player metrics. Omitted
   * by the leaguemates view, whose menu holds nothing that reads it.
   */
  adpFor?: (row: T) => AdpPlayerPayload | null;
  /**
   * Whether a row is one of the subjects narrowing the league list, and how to
   * toggle it — passed only by the shares sheet, where the list is a picker over
   * the leagues behind it. Both or neither: a row that draws as selectable and
   * doesn't toggle is the promise this app's raised/recessed grammar keeps.
   */
  isSelected?: (row: T) => boolean;
  onSelect?: (row: T) => void;
};

/**
 * A list of shares: one card a row, most-shared first, each expanding to the
 * leagues behind it.
 *
 * The shape both share views are. `player-shares` counts players and
 * `leaguemate-shares` counts people, and they are the same card with a different
 * thing in the first column — so the card, the stat columns and the expansion
 * live here rather than in each. They were copied between the two before this,
 * which is one width change away from the two lists disagreeing about how a share
 * reads, in whichever file didn't get edited.
 *
 * The metric each of the four stat columns shows is **the view's**, not this
 * list's and never a card's: per-card columns would make a list several hundred
 * rows long unreadable vertically, which is the axis it is scanned on. It moved
 * one level up because the heading rail naming those columns is pinned in the
 * manager header, which is above this list — one selection cannot be owned by
 * two places, so it is owned by the only place that can see both. Which metrics
 * are on offer is the caller's too, since a player has a board price and a
 * person does not.
 *
 * **It is windowed where it is seated in a scroll box and drawn whole where it
 * is not — one component, two seatings.** The shares *sheet* is a `<dialog>` with a
 * scroll well of its own, and a manager with a hundred-odd leagues rosters
 * several hundred distinct players, so opening the browse mounted several
 * hundred cards synchronously: four metric cells and two controls each, every one
 * of them a gradient, a shadow and — until this — its own `backdrop-filter`
 * layer, all inside a dialog that is itself `backdrop-blur-xl`. On a desktop that
 * is a slow frame. On mobile WebKit it is hundreds of independently composited
 * blur surfaces raised at once, which is the memory spike that had iOS discard
 * and reload the page. Windowed, the count stops mattering: the dozen-odd cards
 * on screen cost what a dozen cards cost whether the list behind them is fifty or
 * five hundred.
 *
 * The two tab lists sit in no box and are unchanged, deliberately. They scroll the
 * *document*, they are not inside a blurred dialog, and their rows carry no
 * expansion the reader can lose — so what windowing would buy them is smaller
 * than the `scrollMargin` machinery a pinned heading rail above a window
 * requires. What they *do* get is the same row surface, whose blur is now a
 * desktop-and-up decoration.
 */
export function ShareList<T extends ShareRow>(props: ShareListProps<T>) {
  // Which of the two seatings this is — see {@link SharesScrollProvider} for why
  // the box arrives this way and why its absence is a real answer.
  const scrollRef = useSharesScroll();
  return scrollRef ? (
    <WindowedShareRows {...props} scrollRef={scrollRef} />
  ) : (
    <PlainShareRows {...props} />
  );
}

/** Every row, mounted. What the two manager tabs draw. */
function PlainShareRows<T extends ShareRow>(props: ShareListProps<T>) {
  return (
    <ul className="flex w-full flex-col gap-4">
      {props.rows.map((row) => (
        <ShareCard key={props.rowKey(row)} {...cardProps(props, row)} />
      ))}
    </ul>
  );
}

/**
 * The rows near the reader, inside a spacer as tall as the whole list.
 *
 * It is a component of its own rather than a branch inside {@link ShareList},
 * and that is a scroll cost rather than tidiness — the same split the ADP board
 * makes for the same reason. The virtualizer notifies React on
 * `[isScrolling, startIndex, endIndex]`, so whatever holds it re-renders every
 * time the window crosses a card boundary; down here that notification reaches
 * the cards and nothing above them.
 */
function WindowedShareRows<T extends ShareRow>({
  scrollRef,
  ...props
}: ShareListProps<T> & { scrollRef: RefObject<HTMLElement | null> }) {
  const { rows, rowKey } = props;
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  /**
   * Which rows are open, held above the window rather than in the cards.
   *
   * A card that scrolls out of a windowed list unmounts, so its own `useState`
   * would drop the disclosure a reader left open — and the virtualizer would go
   * on believing the row is as tall as it was when it was expanded, laying the
   * remounted collapsed card out in an expanded card's slot until the remeasure
   * lands. Keyed by the row's domain id for the reason the virtualizer's own
   * cache is: a search that reshuffles the list must not move a disclosure onto
   * whoever now sits at that index.
   */
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggleOpen = useCallback((key: string, next: boolean) => {
    setOpen((prev) => {
      const changed = new Set(prev);
      if (next) changed.add(key);
      else changed.delete(key);
      return changed;
    });
  }, []);

  // How much of the scroll box sits above the list — the well's own padding. The
  // virtualizer measures rows from the *list's* top while the offset it compares
  // them against is the box's `scrollTop`, so without this the window it computes
  // is that far behind the visible one.
  //
  // A plain effect rather than a layout one, which is safe here rather than
  // sloppy: `getTotalSize()` and each row's `start - scrollMargin` are both
  // invariant to this number, so a late measurement moves nothing on screen — it
  // only sharpens which rows count as visible, and the overscan covers the gap
  // meanwhile. It also keeps this renderable on a server, where a layout effect
  // is a warning and nothing else.
  //
  // The observer watches the **scroll box**, whose box changes with the sheet and
  // never with the list inside it — so it fires when the well can actually
  // resize, and not once per card the list gains.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const el = listRef.current;
      const outer = scrollRef.current;
      if (!el || !outer) return;
      const next =
        el.getBoundingClientRect().top -
        outer.getBoundingClientRect().top +
        outer.scrollTop;
      // `ResizeObserver` fires once on `observe`, so this runs twice on mount;
      // an unguarded set is a render loop.
      setScrollMargin((prev) => (prev === next ? prev : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [scrollRef]);

  const virtualizer = useVirtualizer({
    ...shareWindowOptions(rows, rowKey),
    getScrollElement: () => scrollRef.current,
    scrollMargin,
  });

  return (
    // As tall as the whole list, so the scrollbar describes the browse rather
    // than the window. `relative` is what the cards are positioned against.
    <ul
      ref={listRef}
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index];
        if (!row) return null;
        const key = rowKey(row);
        return (
          <ShareCard
            key={item.key}
            {...cardProps(props, row)}
            expanded={open.has(key)}
            onExpandedChange={(next) => toggleOpen(key, next)}
            seat={{
              // `measureElement` is what makes a card's real height — collapsed
              // or expanded into a dozen leagues — the number the rows below it
              // are placed on. It observes the element it is given, so a card
              // opening is a resize the list answers by moving what follows it,
              // rather than by overlapping or leaving a hole.
              ref: virtualizer.measureElement,
              index: item.index,
              offset: item.start - scrollMargin,
              count: rows.length,
            }}
          />
        );
      })}
    </ul>
  );
}

/** The half of a card's props that says nothing about where it sits. */
function cardProps<T extends ShareRow>(props: ShareListProps<T>, row: T) {
  const ctx: ShareMetricContext = {
    leagues: row.leagues,
    leagueCount: props.leagueCount,
    adp: props.adpFor?.(row) ?? null,
  };
  return {
    name: row.name,
    icon: props.icon(row),
    note: props.note?.(row) ?? null,
    leagues: row.leagues,
    metrics: props.metrics,
    ctx,
    columns: props.columns,
    selected: props.isSelected?.(row) ?? false,
    onSelect: props.onSelect && (() => props.onSelect?.(row)),
  };
}
