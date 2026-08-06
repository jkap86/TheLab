"use client";

import dynamic from "next/dynamic";
import { useId, useState } from "react";

import { filterSummary } from "@/features/shared";
import type { LeagueFilters } from "@/features/shared";
import type { UserInfo } from "@/shared/contract";

import {
  DEFAULT_TRADE_FILTERS,
  activeTradeFilterCount,
  tradeCircleSummary,
  tradeFilterSummary,
} from "../filters";
import type { TradeFilters, TradeNames } from "../filters";

/**
 * The panel, loaded on demand.
 *
 * The ledge is closed on arrival and most readers leave it that way, so what is
 * split off is everything behind the press. The trigger and the summary are
 * static, because they are what a reader who never opens it still reads.
 *
 * It is a smaller split than it was — the three facet lists and the season-wide
 * aggregate behind them moved out to `./trade-search`, where the reader was
 * always trying to get to.
 *
 * `ssr: false` because there is nothing to prerender — a panel that only exists
 * after a press has no server-rendered state worth having, and rendering it
 * would put the markup back in the document the split is removing.
 */
const TradeFiltersPanel = dynamic(
  () => import("./trade-filters-panel").then((m) => m.TradeFiltersPanel),
  {
    ssr: false,
    // Holds the panel's top edge while the chunk lands, so the board below
    // doesn't step down twice — once for this and again for the real panel.
    loading: () => (
      <p className="mt-3 border-t border-foreground/10 pt-4 text-sm text-foreground/40">
        Loading filters…
      </p>
    ),
  },
);

/**
 * The trades page's filter ledge: one line, seated on the page, opening in
 * place.
 *
 * **It replaces a modal, and the line it opens on is what the page heading used
 * to cost.** `Trades` and the scope line under it — the season, "every crawled
 * league", and both filter summaries — were ~96px of a page whose whole subject
 * is the list underneath; the app bar already names the tool, so what the title
 * said was said twice. What could not be said twice is the selection, so it
 * lives here: the trigger wears the count and the line beside it spells the
 * whole scope out, which is the same sentence the deleted lede carried, now
 * beside the control that sets it.
 *
 * Three things are load-bearing about the shape:
 *
 * - **The summary row is the whole control when it is closed.** A reader who
 *   only wants to know what they are looking at never presses anything, and a
 *   reader who wants to clear it can do that from here too — `Clear` is on this
 *   row rather than in the panel, since undoing a narrowing shouldn't require
 *   opening the thing that made it.
 * - **The panel expands into the flow rather than floating.** That is the honest
 *   cost of this layout against a row of popovers, and it is why the whole ledge
 *   sits inside the page header the virtualizer observes: opening moves the list
 *   down, and the list has to be told.
 * - **It commits live.** See {@link TradeFiltersPanel} — there is no draft and no
 *   Apply, because the option counts are taken without the selection and cannot
 *   move under a press.
 *
 * The league filters and the value picker are handed in as `trailing` rather
 * than rendered here: they are the page's controls and neither is what this
 * component is about, but they belong on this row — one line of controls over
 * one board, rather than a filter ledge with a second bar of triggers above it.
 */
export function TradeFiltersLedge({
  filters,
  onChange,
  leagueFilters,
  season,
  account,
  names,
  trailing,
}: {
  filters: TradeFilters;
  onChange: (filters: TradeFilters) => void;
  /** Only to spell the scope out — this control does not edit them. */
  leagueFilters: LeagueFilters;
  season: string;
  /** The reader's stored account, or null — what the circle is drawn around. */
  account: UserInfo | null;
  /**
   * How to name what the bays hold. The summary reads the selection out rather
   * than counting it, which is what the sides bought — and this control holds no
   * ids of its own, so the page's own lookups come in.
   */
  names: TradeNames;
  /** The page's own controls, seated on the same row. */
  trailing?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const active = activeTradeFilterCount(filters);

  return (
    <div className="lab-trough mb-4 rounded-2xl p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-controls={panelId}
          className={`inline-flex shrink-0 items-center gap-2 rounded-full py-1.5 pl-3 pr-3.5 text-sm font-semibold ${
            active > 0 ? "lab-chip-on" : "lab-chip text-foreground/85"
          }`}
        >
          Filters
          {/* Only drawn when something is set, so it is always on the lit face —
              the dark-on-cyan spelling rather than the key's own cyan-on-dark. */}
          {active > 0 && (
            <span className="rounded-[5px] bg-[#04141a]/25 px-1.5 py-0.5 text-[11px] font-bold leading-none text-[#04141a]">
              {active}
            </span>
          )}
          <span aria-hidden="true" className="text-[8px] leading-none opacity-60">
            {open ? "▴" : "▾"}
          </span>
        </button>

        {/* The scope in words — the sentence the deleted lede carried, with the
            season leading it because a board pooling two of them is wrong at
            every row.

            **It takes a line of its own below `sm` rather than sharing this
            one.** Sharing, it was the part that gave way: a phone left it
            `202…`, which is the trigger's badge with none of its brevity and
            none of the sentence's meaning. A row of its own costs ~18px and is
            the one thing here that has to be *read* rather than pressed —
            everything else on this line is a control that states itself. From
            `sm` it goes back inline and takes the slack, so the triggers stay
            right-aligned. */}
        <p className="order-last min-w-0 basis-full truncate text-xs text-foreground/50 sm:order-none sm:basis-auto sm:flex-1">
          {/* The circle stands where the literal "every crawled league" used to:
              it names the population, and the two summaries after it are what
              cut that population down. */}
          {season} · {tradeCircleSummary(filters.circle)} ·{" "}
          {filterSummary(leagueFilters)} · {tradeFilterSummary(filters, names)}
        </p>

        {active > 0 && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_TRADE_FILTERS)}
            className="shrink-0 text-xs font-semibold text-foreground/45 transition-colors hover:text-foreground"
          >
            Clear
          </button>
        )}

        {trailing}
      </div>

      {/* Unmounted rather than hidden: the panel's query is gated on its own
          existence, so a closed ledge costs neither the markup nor the request. */}
      <div id={panelId}>
        {open && (
          <TradeFiltersPanel
            filters={filters}
            onChange={onChange}
            account={account}
          />
        )}
      </div>
    </div>
  );
}
