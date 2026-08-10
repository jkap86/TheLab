"use client";

import { useId, useState } from "react";

import type { ManagerLeague } from "@/shared/manager";

import type { ShareMetric, ShareMetricContext } from "../../share-metrics.ts";
import { Chevron } from "../chevron";
import { LIST_ROW_HOVER, LIST_ROW_SURFACE, RowSheen } from "../list-row";
import { MetricColumns } from "../metric-column";
import { SharedLeagueRow } from "./shared-league-row";

/**
 * Where a card sits when the list around it is windowed.
 *
 * A share card *is* its `<li>` — the border, the gradient and the rounded
 * corners are on that element — so a virtualized list has nowhere to put a
 * positioning wrapper without either nesting a `<li>` inside a `<div>` inside
 * the `<ul>` (invalid) or moving the surface off the list item (which costs the
 * list its semantics). The card takes the seat instead: the same `<li>`, told
 * where it goes and handed to the measurer.
 *
 * **The offset is `top`, not a transform**, and that is the one detail that
 * cannot be swapped for the other spelling. {@link LIST_ROW_HOVER} lifts a row
 * with `-translate-y-0.5`; an inline `transform` outranks any class, so
 * positioning that way would silently delete the hover lift on every share card.
 * Nothing is lost by using `top`: a windowed row's offset is fixed for as long
 * as it is mounted, so it is written once and never animated.
 */
export type ShareCardSeat = {
  /** The virtualizer's measurer — see `ShareList`, which passes it through. */
  ref: (node: HTMLLIElement | null) => void;
  /** Which row this is, for `measureElement`'s own `data-index` lookup. */
  index: number;
  /** Where the card starts inside the list's spacer, in px. */
  offset: number;
  /** How long the list really is — only a window of it is in the DOM. */
  count: number;
};

/**
 * One share in the players or leaguemates list: the same glassy card a league
 * wears, with the player or person where the league name goes and the leagues
 * behind the share where the standings panel goes.
 *
 * These two views were a dense table of a count and a percentage — which answers
 * how much exposure and nothing about its shape — while the leagues beside them
 * had four pickable stat columns. They are cards for that reason: the columns are
 * the point, and a row 28 pixels tall has nowhere to put them. Which metric each
 * slot holds is {@link ShareList}'s, so the columns line up down the page.
 *
 * The whole row is the expand target and the stat columns are numbers, exactly as
 * on a league card — the pickers that aim them live in the heading rail above the
 * list, since the selection is the list's.
 *
 * **`onSelect` splits that one target in two, and only the sheet passes it.** In
 * the shares sheet a row is something you *pick* — it narrows the league list
 * behind the glass — so the press a reader spends nine times out of ten has to be
 * the pick, and the expansion moves onto the chevron, which is the mark that
 * already means "there is more under this". On the tabs, where there is nothing
 * to pick, the row stays one button and the chevron stays inside it: two
 * behaviours would be worth avoiding, but a card that quietly did nothing on the
 * press its own mark advertises would be worse.
 */
export function ShareCard({
  name,
  icon,
  note,
  leagues,
  metrics,
  ctx,
  columns,
  selected = false,
  onSelect,
  expanded: controlledExpanded,
  onExpandedChange,
  seat,
}: {
  name: string;
  /** Leads the name: a position pill, an avatar — whatever identifies the row. */
  icon: React.ReactNode;
  /** A dim trailing detail on the name — the NFL team on a player, nothing on a person. */
  note?: string | null;
  /** The leagues behind this share, listed when the card is expanded. */
  leagues: ManagerLeague[];
  /** The catalogue this card's columns pick from — players get the ADP metrics. */
  metrics: ShareMetric[];
  ctx: ShareMetricContext;
  columns: string[];
  /** Whether this row is one of the subjects narrowing the league list. */
  selected?: boolean;
  /** Toggle that selection. Omitted where the list is read rather than picked. */
  onSelect?: () => void;
  /**
   * Whether the leagues behind the share are listed, where the list owns that
   * rather than the card.
   *
   * **Uncontrolled by default, controlled only where the list is windowed**, and
   * the asymmetry is the honest one rather than an oversight. A card that scrolls
   * out of a windowed list unmounts, so state it held alone is state a reader
   * loses by scrolling past their own expanded row — and worse, the virtualizer
   * remembers that row's *expanded* height under its domain id, so scrolling back
   * lays out a collapsed card in an expanded card's slot until the remeasure
   * lands: a blank gap, then a jump. Held above the window, the card comes back
   * exactly as it was left. The unwindowed tabs keep the local state, because
   * lifting it there would re-render several hundred cards on every disclosure
   * to fix a problem those lists do not have.
   */
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  /** Where this card sits when the list is windowed — see {@link ShareCardSeat}. */
  seat?: ShareCardSeat;
}) {
  const [ownExpanded, setOwnExpanded] = useState(false);
  const expanded = controlledExpanded ?? ownExpanded;
  const toggleExpanded = () => {
    if (onExpandedChange) onExpandedChange(!expanded);
    else setOwnExpanded((v) => !v);
  };
  // What `aria-expanded` is about — see `LeagueCard`, which names its panel for
  // the same reason.
  const panelId = useId();

  return (
    <li
      ref={seat?.ref}
      // What `measureElement` reads to know which row it has just been handed.
      data-index={seat?.index}
      // The window's own count, not the DOM's: a couple of dozen cards exist at
      // a time, and without these a screen reader would announce the list as
      // being that long. Absent unwindowed, where the DOM *is* the list.
      aria-setsize={seat?.count}
      aria-posinset={seat ? seat.index + 1 : undefined}
      // `left`/`right` rather than `inset-inline`, which mobile WebKit is the
      // last engine to have learned and this is the browser the windowing is for.
      style={
        seat ? { position: "absolute", left: 0, right: 0, top: seat.offset } : undefined
      }
      className={`${LIST_ROW_SURFACE} ${LIST_ROW_HOVER} ${
        // A picked row is lit rather than merely ticked: it is the thing the
        // list behind the sheet is currently being narrowed by, and the accent
        // is what this app already spends on a control that is doing something.
        // The glow replaces the surface's own drop shadow rather than joining it
        // — one `box-shadow` wins — so the inset top highlight is restated here.
        selected
          ? "border-active/55 bg-active/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_28px_-12px_rgba(0,255,229,0.8)]"
          : ""
      }`}
    >
      <RowSheen lit={selected} />

      <div className="relative flex w-full flex-col items-stretch gap-3 px-4 py-3 pl-5 sm:flex-row sm:items-center sm:gap-4">
        {/* The name half is one box whether it holds one button or two, so the
            chevron stays beside the name when the card stacks below `sm` rather
            than taking a line of its own above it. */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {onSelect && (
            <button
              type="button"
              onClick={toggleExpanded}
              aria-expanded={expanded}
              aria-controls={expanded ? panelId : undefined}
              aria-label={`Show the leagues holding ${name}`}
              className="-my-1 -ml-1 shrink-0 rounded-lg p-1 transition-colors hover:bg-foreground/5"
            >
              <Chevron open={expanded} size="md" />
            </button>
          )}
          <button
            type="button"
            onClick={onSelect ?? toggleExpanded}
            {...(onSelect
              ? { "aria-pressed": selected }
              : {
                  "aria-expanded": expanded,
                  "aria-controls": expanded ? panelId : undefined,
                })}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left"
          >
            {!onSelect && <Chevron open={expanded} size="md" />}
            {icon}
            {/* The display face and the size step down with it, exactly as on a
                league card — the two lists are the same row wearing a different
                subject, and a player's name reading larger than a league's would
                say otherwise. */}
            {/* `h2` for the reason a league card's name is one: the manager
                plate's title is the page's only `h1`, so a 3 here skipped 2. */}
            <h2 className="min-w-0 flex-1 truncate font-display text-sm font-semibold tracking-tight">
              {name}
            </h2>
            {note && (
              <span className="shrink-0 text-xs tabular-nums text-foreground/40">
                {note}
              </span>
            )}
          </button>
        </div>

        {/* Numbers only, for the reason a league card carries none either: the
            pinned heading rail names these columns at every width, and repeating
            them on every row is what made a list-wide selection read as a
            per-row one. */}
        <MetricColumns metrics={metrics} ctx={ctx} columns={columns} />
      </div>

      {expanded && (
        <ul id={panelId} className="relative border-t border-foreground/10 px-4 py-3">
          {leagues.map((league) => (
            <SharedLeagueRow key={league.league_id} league={league} />
          ))}
        </ul>
      )}
    </li>
  );
}
