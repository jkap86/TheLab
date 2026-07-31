"use client";

import { useEffect, useRef, useState } from "react";

import { metricPreview, type Metric, type MetricCell } from "../metric-cell";

/**
 * The cluster of stat columns across a card — the league cards' four rankings,
 * the share cards' four counts — and the one-menu-at-a-time behaviour behind
 * them.
 *
 * It owns which column's picker is open because that is a fact about the cluster
 * and not about either card: only one menu is up at a time, an outside click or
 * Escape closes it, and both were written out twice before this. What the *card*
 * still needs to know is whether a menu is up at all, so it can lift its stacking
 * order while the menu overhangs the card below — that goes back up through
 * `onOpenChange` rather than being solved here, since the element that has to be
 * raised is the card's own.
 *
 * Which metric each slot shows is held higher still, in the list, so every card
 * shows the same columns and they line up down the page.
 */
export function MetricColumns<C>({
  metrics,
  ctx,
  columns,
  onColumnChange,
  onOpenChange,
}: {
  metrics: Metric<C>[];
  ctx: C;
  /** The metric key each column shows, shared by every card in the list. */
  columns: string[];
  /** Point a column at another metric (applies to every card at once). */
  onColumnChange: (slot: number, key: string) => void;
  /** Told whether any of this card's menus is open. Must be a stable callback. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openSlot === null) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpenSlot(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenSlot(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openSlot]);

  useEffect(() => {
    onOpenChange?.(openSlot !== null);
  }, [openSlot, onOpenChange]);

  return (
    <div
      ref={ref}
      className="flex shrink-0 items-stretch divide-x divide-foreground/10"
    >
      {columns.map((key, slot) => (
        <MetricColumn
          key={slot}
          metrics={metrics}
          metricKey={key}
          ctx={ctx}
          open={openSlot === slot}
          onToggle={() =>
            setOpenSlot((current) => (current === slot ? null : slot))
          }
          onSelect={(metricKey) => {
            onColumnChange(slot, metricKey);
            setOpenSlot(null);
          }}
        />
      ))}
    </div>
  );
}

/**
 * One stat column on a card: the chosen metric, read off this card's subject and
 * rendered, with the column's label doubling as the trigger for a picker that
 * swaps the whole column to another metric.
 *
 * Generic in what the metrics read from, because two grains now wear these
 * columns — a league card reads a league's ranks and values, a share card reads
 * the leagues behind one player or leaguemate. The catalogue is passed in rather
 * than imported here, which is what keeps the column ignorant of both.
 *
 * The selection is the card's to hold, not this column's — every card shows the
 * same four metrics so the columns line up down the list, so which metric a slot
 * shows is lifted to {@link LeagueCard} or {@link ShareCard}, and the picker's
 * open state with it. This component is told which metric it holds and whether
 * its menu is open, and reports a toggle and a pick back up.
 */
export function MetricColumn<C>({
  metrics,
  metricKey,
  ctx,
  open,
  onToggle,
  onSelect,
}: {
  /** The catalogue this column picks from — the card's grain decides which. */
  metrics: Metric<C>[];
  /** The selected metric's key; falls back to the first metric if unknown. */
  metricKey: string;
  ctx: C;
  /** Whether this column's picker menu is open — one at a time per card. */
  open: boolean;
  /** Toggle this column's menu (the card closes any other that was open). */
  onToggle: () => void;
  /** Point this column at another metric. */
  onSelect: (key: string) => void;
}) {
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  const cell = metric.cell(ctx);

  return (
    <div className="group/col relative flex w-20 shrink-0 flex-col gap-1 px-2.5">
      <button
        type="button"
        onClick={onToggle}
        title={cell.title}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center text-left"
      >
        <span
          className={`whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide transition-colors ${
            open
              ? "text-foreground/80"
              : "text-foreground/40 group-hover/col:text-foreground/70"
          }`}
        >
          {metric.label}
        </span>
      </button>

      {/* The picker affordance: a caret that surfaces on hover or while open, over
          the column's right padding so it never crowds the label. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute right-0.5 top-0 text-[9px] leading-none transition-opacity ${
          open
            ? "text-foreground/70 opacity-100"
            : "text-foreground/40 opacity-0 group-hover/col:opacity-100"
        }`}
      >
        ▾
      </span>

      <StatBody cell={cell} title={cell.title} />

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1.5 min-w-[9.5rem] rounded-lg border border-foreground/15 bg-[var(--background)] p-1 shadow-[0_18px_44px_-14px_rgba(0,0,0,0.9)]"
        >
          {metrics.map((option) => {
            const active = option.key === metric.key;
            return (
              <button
                key={option.key}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => onSelect(option.key)}
                className={`flex w-full items-center justify-between gap-4 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  active
                    ? "bg-active/15 text-active"
                    : "text-foreground/75 hover:bg-foreground/10 hover:text-foreground"
                }`}
              >
                <span className="truncate">{option.label}</span>
                <span className="shrink-0 tabular-nums text-foreground/40">
                  {metricPreview(option.cell(ctx))}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const TIER_TEXT: Record<Tier, string> = {
  hi: "text-active",
  mid: "text-foreground/85",
  lo: "text-rose-300",
};
const TIER_FILL: Record<Tier, string> = {
  hi: "bg-active",
  mid: "bg-foreground/40",
  lo: "bg-rose-400/80",
};

type Tier = "hi" | "mid" | "lo";

/**
 * Where a rank falls in its league as a fraction (1 for first, 0 for last), and
 * the tier that fraction lands in. The tiers are wide bands, not thirds, so the
 * accent is reserved for genuinely near the top and rose for genuinely near the
 * bottom — most rows read as the neutral middle, which is what keeps a card of
 * four colours from looking like an alarm.
 */
function rankTier(rank: { rank: number; of: number }): { p: number; tier: Tier } {
  const p = rank.of <= 1 ? 1 : (rank.of - rank.rank) / (rank.of - 1);
  const tier: Tier = p >= 0.62 ? "hi" : p <= 0.3 ? "lo" : "mid";
  return { p, tier };
}

/**
 * The number and meter under a column's label. A rank is placed and metered by
 * where in its league it sits; a share is metered by its plain fraction, more
 * being more; a value is printed plain, since there is nothing to place it
 * against. All three keep the same three-row height — label, number, a track
 * strip — so mixing them in one row leaves the numbers on a shared baseline.
 */
function StatBody({ cell, title }: { cell: MetricCell; title: string }) {
  if (cell.kind === "share") {
    // Metered but never tiered: a player in 8 of 121 leagues is a small share,
    // not a bad one, so borrowing a rank's colours would read as an alarm on
    // nearly every row. The accent marks the fill and the number stays neutral.
    const p = cell.of > 0 ? cell.held / cell.of : 0;
    return (
      <>
        <span title={title} className="flex items-baseline gap-0.5 leading-none">
          <span className="text-base font-bold tabular-nums text-foreground/85">
            {cell.held}
          </span>
          <span className="text-[11px] tabular-nums text-foreground/40">
            /{cell.of}
          </span>
        </span>
        <span className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
          {cell.held > 0 && (
            <span
              className="block h-full rounded-full bg-active/70"
              style={{ width: `${Math.max(6, p * 100)}%` }}
            />
          )}
        </span>
      </>
    );
  }

  if (cell.kind === "value") {
    return (
      <>
        {cell.text ? (
          <span
            title={title}
            className="text-sm font-bold leading-none tabular-nums text-foreground/85"
          >
            {cell.text}
          </span>
        ) : (
          <span className="text-base font-bold leading-none text-foreground/25">
            —
          </span>
        )}
        {/* No meter — a value has no denominator to place it in — but the strip's
            height is held so value and rank columns share a baseline. */}
        <span className="h-1 w-full" />
      </>
    );
  }

  const t = cell.rank ? rankTier(cell.rank) : null;
  return (
    <>
      {cell.rank && t ? (
        <span title={title} className="flex items-baseline gap-0.5 leading-none">
          <span
            className={`text-base font-bold tabular-nums ${TIER_TEXT[t.tier]}`}
          >
            #{cell.rank.rank}
          </span>
          <span className="text-[11px] tabular-nums text-foreground/40">
            /{cell.rank.of}
          </span>
        </span>
      ) : (
        <span className="text-base font-bold leading-none text-foreground/25">
          —
        </span>
      )}
      <span className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
        {cell.rank && t && (
          <span
            className={`block h-full rounded-full ${TIER_FILL[t.tier]}`}
            style={{ width: `${Math.max(6, t.p * 100)}%` }}
          />
        )}
      </span>
    </>
  );
}
