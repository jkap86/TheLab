"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { metricPreview, type Metric, type MetricCell } from "../metric-cell";

/**
 * The width and gutter one stat column takes, worn by the cells on a card and by
 * the headings above the list alike.
 *
 * They are two components and they have to line up to the pixel, so the geometry
 * is written once — a heading a hair wider than the number under it reads as a
 * misaligned table, and that is exactly the drift a retyped width produces.
 *
 * **From `sm` up the width is set by the longest label, not by the numbers.** It
 * was 80px everywhere, which fits every number these columns print and truncates
 * a third of the catalogue's labels ("Proj bench" is 69px at this size). That was
 * survivable while the label sat on every card, where a reader could read it off
 * a neighbouring row; with the labels lifted into one heading rail, a truncated
 * one is the only name that column has. 96px clears the widest of them with the
 * gutters counted, and the name beside it is the field that gives up the space —
 * it truncates to a tooltip, where a heading truncates to nothing.
 *
 * Below `sm` it stays 80px, because four of anything wider does not fit a phone:
 * 4 × 96 plus the card's own insets overflows a 390px screen. That is the same
 * width where the heading rail is dropped and the labels go back on the cards,
 * so the two rules are one rule — the wide column exists to hold a heading, and
 * there is no heading down there.
 */
const COLUMN_BOX = "w-20 shrink-0 px-2.5 sm:w-24";

/**
 * One-menu-at-a-time, closing on an outside press or Escape, and reporting
 * whether anything is up.
 *
 * Shared by the cells on a card and the headings above the list because it is
 * the same rule in both places, and because the *card* is what has to lift its
 * stacking order while a menu overhangs the row below — which is why `open`
 * travels back out rather than being solved here.
 */
function useOneOpen(onOpenChange?: (open: boolean) => void) {
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

  const toggle = useCallback(
    (slot: number) =>
      setOpenSlot((current) => (current === slot ? null : slot)),
    [],
  );
  const close = useCallback(() => setOpenSlot(null), []);

  return { ref, openSlot, toggle, close };
}

/**
 * The cluster of stat columns across a card — the league cards' four rankings,
 * the share cards' four counts.
 *
 * Which metric each slot shows is held in the list, so every card shows the same
 * columns and they line up down the page; this renders them and owns nothing but
 * which picker is open.
 *
 * **The labels are optional, because the list may already be stating them.**
 * Where a heading row sits above the list ({@link MetricHeadings}), repeating the
 * label on all hundred-odd cards says the selection is a fact about *this* card,
 * which is the misreading the heading row exists to correct. Below `sm` the cards
 * stack and the heading row is dropped, so the labels come back — which is why
 * this is a breakpoint and not a boolean the caller resolves.
 */
export function MetricColumns<C>({
  metrics,
  ctx,
  columns,
  onColumnChange,
  onOpenChange,
  onReset,
  labels = true,
}: {
  metrics: Metric<C>[];
  ctx: C;
  /** The metric key each column shows, shared by every card in the list. */
  columns: string[];
  /** Point a column at another metric (applies to every card at once). */
  onColumnChange: (slot: number, key: string) => void;
  /** Told whether any of this card's menus is open. Must be a stable callback. */
  onOpenChange?: (open: boolean) => void;
  /** Offered at the foot of every menu, where the list can hand the defaults back. */
  onReset?: () => void;
  /** False where a heading row above the list carries them at `sm` and up. */
  labels?: boolean;
}) {
  const { ref, openSlot, toggle, close } = useOneOpen(onOpenChange);

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
          labels={labels}
          open={openSlot === slot}
          onToggle={() => toggle(slot)}
          onSelect={(metricKey) => {
            onColumnChange(slot, metricKey);
            close();
          }}
          // Closes behind you exactly as a pick does — it *is* a pick, of all
          // four at once, and a menu still standing over columns that have
          // already moved leaves the next press toggling it shut instead of
          // doing what it looks like it does.
          onReset={onReset && (() => {
            onReset();
            close();
          })}
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
 * The selection is the list's to hold, not this column's — every card shows the
 * same four metrics so the columns line up down the list. This component is told
 * which metric it holds and whether its menu is open, and reports a toggle and a
 * pick back up.
 */
export function MetricColumn<C>({
  metrics,
  metricKey,
  ctx,
  open,
  onToggle,
  onSelect,
  onReset,
  labels = true,
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
  /** Hand the whole list its opening columns back. */
  onReset?: () => void;
  /** False where a heading row above the list carries the label at `sm` and up. */
  labels?: boolean;
}) {
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  const cell = metric.cell(ctx);

  return (
    <div
      className={`group/col relative flex flex-col gap-1 ${COLUMN_BOX}`}
    >
      {/*
        Hidden rather than absent above `sm`: with a heading row over the list the
        label would be the same word repeated down a hundred rows, and it is the
        heading that is the control there. `display: none` also takes the trigger
        out of the tab order and out of reach of a click, so there is one picker
        per column on screen and not two.
      */}
      <span className={labels ? "contents" : "contents sm:hidden"}>
        <button
          type="button"
          onClick={onToggle}
          title={cell.title}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex w-full items-center text-left"
        >
          <span
            className={`min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide transition-colors ${
              open
                ? "text-foreground/80"
                : "text-foreground/40 group-hover/col:text-foreground/70"
            }`}
          >
            {metric.label}
          </span>
        </button>
        {/*
          The picker's affordance, over the column's right gutter so it never
          costs the label a character. It is always drawn: on `group-hover` alone
          it never appeared on a touch device, leaving the one control that
          changes the board with nothing to say it was a control.
        */}
        <Caret open={open} />
      </span>

      {/*
        The name, for a reader who can't see the heading rail lining up with this
        column. Hiding the visible label takes it out of the accessibility tree
        too, which would leave a screen reader announcing "#3 of 12" with no word
        for what it ranks. `hidden sm:block` scopes it to exactly the widths the
        visible label is gone at, so it never reads twice.
      */}
      <span className="sr-only hidden sm:block">{metric.label}</span>

      <StatBody cell={cell} title={cell.title} />

      {open && (
        <ColumnMenu
          options={metrics.map((option) => ({
            key: option.key,
            label: option.label,
            preview: metricPreview(option.cell(ctx)),
          }))}
          activeKey={metric.key}
          onSelect={onSelect}
          onReset={onReset}
        />
      )}
    </div>
  );
}

/**
 * The stat columns' labels, stated once above the list rather than on every row.
 *
 * The selection is list-wide — moving a column moves it on all hundred-odd cards
 * — but drawn per card it read as a per-card control, which is the whole reason
 * changing four columns felt like four unrelated errands. The headings are the
 * same pickers in one place, laid on the cards' own geometry so each sits over
 * the numbers it names.
 *
 * It takes no context and shows no preview values: a heading belongs to the
 * whole list, and a preview here would be one arbitrary row's numbers offered as
 * if they described the column. The editor is where previews belong, because it
 * says out loud which subject it is previewing against.
 */
export function MetricHeadings({
  metrics,
  columns,
  onColumnChange,
  onReset,
}: {
  /** The catalogue, for the menus — only the key and label are read. */
  metrics: readonly { key: string; label: string }[];
  columns: string[];
  onColumnChange: (slot: number, key: string) => void;
  onReset?: () => void;
}) {
  const { ref, openSlot, toggle, close } = useOneOpen();

  return (
    // `divide-x divide-transparent` draws nothing and is not decoration: the
    // cards' own columns carry a 1px divider *inside* their 80px box, so without
    // the same border here every heading after the first would sit a pixel left
    // of the number it names.
    <div
      ref={ref}
      className="flex shrink-0 items-stretch divide-x divide-transparent"
    >
      {columns.map((key, slot) => {
        const metric = metrics.find((m) => m.key === key) ?? metrics[0];
        const open = openSlot === slot;
        return (
          <div key={slot} className={`group/col relative ${COLUMN_BOX}`}>
            <button
              type="button"
              onClick={() => toggle(slot)}
              aria-haspopup="menu"
              aria-expanded={open}
              // The full label, in case a catalogue ever grows one past the
              // column's width — a truncated heading is the only name its
              // column has.
              title={metric?.label}
              className="flex w-full items-center text-left"
            >
              <span
                className={`min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                  open
                    ? "text-active"
                    : "text-foreground/50 group-hover/col:text-foreground/80"
                }`}
              >
                {metric?.label}
              </span>
            </button>
            <Caret open={open} />

            {open && (
              <ColumnMenu
                options={metrics.map((option) => ({
                  key: option.key,
                  label: option.label,
                }))}
                activeKey={metric?.key ?? ""}
                onSelect={(metricKey) => {
                  onColumnChange(slot, metricKey);
                  close();
                }}
                onReset={
                  onReset &&
                  (() => {
                    onReset();
                    close();
                  })
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The picker menu itself, hung under whichever label opened it.
 *
 * One component for the cells' menu and the headings' because they are the same
 * menu — the only difference is whether a preview number rides on each row, and
 * that is data the caller either has or doesn't.
 *
 * The reset sits at the foot rather than in the list: it is not a metric, and a
 * thirteenth row among twelve metrics is how it would be picked by accident. It
 * is only rendered where the list offered one, since a table with no stored
 * selection has nothing to hand back.
 */
function ColumnMenu({
  options,
  activeKey,
  onSelect,
  onReset,
}: {
  options: { key: string; label: string; preview?: string }[];
  activeKey: string;
  onSelect: (key: string) => void;
  onReset?: () => void;
}) {
  return (
    <div
      role="menu"
      className="absolute right-0 top-full z-30 mt-1.5 min-w-[9.5rem] rounded-lg border border-foreground/15 bg-[var(--background)] p-1 shadow-[0_18px_44px_-14px_rgba(0,0,0,0.9)]"
    >
      {options.map((option) => {
        const active = option.key === activeKey;
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
            {option.preview !== undefined && (
              <span className="shrink-0 tabular-nums text-foreground/40">
                {option.preview}
              </span>
            )}
          </button>
        );
      })}

      {onReset && (
        <>
          <span
            aria-hidden="true"
            className="my-1 block h-px bg-foreground/10"
          />
          <button
            type="button"
            role="menuitem"
            onClick={onReset}
            className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-foreground/45 transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            Reset all columns
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The picker's disclosure mark: dim at rest, lit on hover or while open.
 *
 * Absolutely placed over the column's right gutter rather than laid in the row
 * beside the label — a 10px mark and its gap is two characters out of a label
 * that already has to fit in 76px, and the gutter is empty.
 */
function Caret({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute right-0.5 top-0 text-[8px] leading-none transition-colors ${
        open
          ? "text-active"
          : "text-foreground/25 group-hover/col:text-foreground/60"
      }`}
    >
      ▾
    </span>
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
