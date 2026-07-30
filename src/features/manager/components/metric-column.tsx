"use client";

import {
  LEAGUE_METRICS,
  LEAGUE_METRICS_BY_KEY,
  metricPreview,
  type LeagueMetric,
  type MetricCell,
  type MetricContext,
} from "../league-metrics";

/**
 * One stat column on a league card: the chosen metric, read off this league and
 * rendered, with the column's label doubling as the trigger for a picker that
 * swaps the whole column to another metric.
 *
 * The selection is the card's to hold, not this column's — every card shows the
 * same four metrics so the columns line up down the list, so which metric a slot
 * shows is lifted to {@link LeagueCard} and the picker's open state with it. This
 * component is told which metric it holds and whether its menu is open, and
 * reports a toggle and a pick back up.
 */
export function MetricColumn({
  metricKey,
  ctx,
  open,
  onToggle,
  onSelect,
}: {
  /** The selected metric's key; falls back to the first metric if unknown. */
  metricKey: string;
  ctx: MetricContext;
  /** Whether this column's picker menu is open — one at a time per card. */
  open: boolean;
  /** Toggle this column's menu (the card closes any other that was open). */
  onToggle: () => void;
  /** Point this column at another metric. */
  onSelect: (key: string) => void;
}) {
  const metric: LeagueMetric =
    LEAGUE_METRICS_BY_KEY[metricKey] ?? LEAGUE_METRICS[0];
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
          {LEAGUE_METRICS.map((option) => {
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
 * where in its league it sits; a value is printed plain, since there is no
 * league to place it against. Both keep the same three-row height — label,
 * number, a track strip — so mixing rank and value columns in one row leaves the
 * numbers on a shared baseline.
 */
function StatBody({ cell, title }: { cell: MetricCell; title: string }) {
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
