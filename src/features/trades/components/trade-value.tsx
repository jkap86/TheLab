"use client";

import { useEffect, useId, useRef, useState } from "react";

import { useReturnFocus } from "@/features/shared";
import type { MetricCell } from "@/features/shared/metric-cell";

import type { TradeMetric, TradeSideContext } from "../trade-metrics";

/**
 * The value column a trade card carries beside each side's haul, and the control
 * that aims it.
 *
 * It is the league cards' pickable stat column at the trades page's own grain —
 * one side of one trade — and the two halves sit where the manager tool's do:
 * **the selection is list-wide, so the control is above the list and never on a
 * card**. Forty thousand cards each holding a menu would be the per-card reading
 * of a list-wide choice in its most literal form, and here it is worse than on
 * the league cards, because a trade card already carries two sides.
 *
 * What it deliberately isn't is the manager tool's heading rail. That rail works
 * because every card puts its four numbers at the same x, so a heading can name
 * the column under it; a trade card's value belongs to a *side*, and the sides
 * stack or split by width and count. So the number wears its own label
 * ({@link TradeValueTag}) and the picker is a chip in the header, next to the
 * two filter triggers it reads as a sibling of.
 */

/**
 * One side's value, labelled in place.
 *
 * The label rides with the number rather than sitting in a rail above the list,
 * for the reason above — nothing on this page holds a column of these at a fixed
 * x. It costs four characters per side and buys a number that says what it is on
 * a card read in isolation, which is how a windowed list of forty thousand is
 * always read.
 *
 * **The number is on the display face and cut into its readout** — the page's
 * subject used to be the quietest type on the card, set in the body face at a
 * smaller size than the manager's name beside it and the league's above it.
 * Engraved rather than lit because there are two of these per card times the
 * couple of dozen cards in the window; see `.lab-engraved` for that arithmetic.
 */
export function TradeValueTag({
  metric,
  ctx,
}: {
  metric: TradeMetric;
  ctx: TradeSideContext;
}) {
  const cell: MetricCell = metric.cell(ctx);
  // Every trade metric is a `value` cell — there is nothing on this page to rank
  // a side against — but the vocabulary is shared with catalogues that do, so
  // the other shapes are read through the same field rather than assumed away.
  const text = cell.kind === "value" ? cell.text : null;

  return (
    <span
      title={cell.title}
      className="flex shrink-0 items-baseline gap-1 tabular-nums"
    >
      <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-foreground/35">
        {metric.label}
      </span>
      {text ? (
        <span className="lab-engraved font-display text-xs font-bold tracking-[0.02em] text-foreground/90">
          {text}
        </span>
      ) : (
        // The em dash the whole catalogue rests on: unpriced is not zero. It is
        // left flat on purpose — an absence cut into the plate would be given
        // more presence than the numbers that are actually there.
        <span className="text-xs font-bold text-foreground/25">—</span>
      )}
    </span>
  );
}

/**
 * Which metric that column shows, chosen once for the whole list.
 *
 * A chip rather than a labelled select, so it sits in the header's row of
 * controls as a peer of the two filter triggers — the same `.lab-chip` face, and
 * for the same reason: it is pressable, so it is raised. It carries the current
 * metric's name rather than only the word "Value", since a picker that hides its
 * own selection makes the number below it unattributable.
 */
export function TradeValuePicker({
  metrics,
  metricKey,
  onChange,
  onReset,
}: {
  metrics: readonly TradeMetric[];
  metricKey: string;
  onChange: (key: string) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const active = metrics.find((metric) => metric.key === metricKey) ?? metrics[0];
  // Escape closes the menu from a document listener, which unmounts whatever a
  // keyboard reader had landed on inside it.
  useReturnFocus(open, trigger);

  // One menu, dismissed by a press outside it or by Escape — the same three
  // behaviours every floating control in the app keeps.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="lab-chip inline-flex items-center gap-2 rounded-full py-1.5 pl-3 pr-3.5 text-sm font-semibold text-foreground/85"
      >
        <span className="text-[0.6875rem] uppercase tracking-wide text-foreground/45">
          Value
        </span>
        {active.label}
        <span aria-hidden="true" className="text-[0.5rem] leading-none">
          ▾
        </span>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Trade value column"
          className="absolute right-0 top-full z-30 mt-1.5 min-w-[10rem] rounded-lg border border-foreground/15 bg-[var(--background)] p-1 shadow-[0_18px_44px_-14px_rgba(0,0,0,0.9)]"
        >
          {metrics.map((metric) => {
            const selected = metric.key === active.key;
            return (
              <button
                key={metric.key}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onChange(metric.key);
                  setOpen(false);
                }}
                className={`flex w-full items-center rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  selected
                    ? "bg-active/15 text-active"
                    : "text-foreground/75 hover:bg-foreground/10 hover:text-foreground"
                }`}
              >
                <span className="truncate">{metric.label}</span>
              </button>
            );
          })}

          {/* The stored selection outlives the session, so the way back is part
              of the control rather than something to remember — the rule
              `usePersistedColumns` exists to keep. Below the list, since it is
              not a metric to be picked by accident. */}
          <span aria-hidden="true" className="my-1 block h-px bg-foreground/10" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onReset();
              setOpen(false);
            }}
            className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-foreground/45 transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            Reset column
          </button>
        </div>
      )}
    </div>
  );
}
