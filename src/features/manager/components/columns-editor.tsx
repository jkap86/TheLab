"use client";

import { useEffect, useRef, useState } from "react";

import { groupMetrics } from "@/features/shared/columns";

import {
  metricPreview,
  type ColumnPreset,
  type Metric,
} from "../metric-cell";

/**
 * All four stat columns in one place, behind a dialog.
 *
 * The columns are aimed one at a time from their own labels, which is the right
 * control for changing one and the wrong one for changing the board: the four
 * slots are rarely four independent choices — a reader arrives with a question,
 * and a question is a set of columns — so recomposing them meant four menus, four
 * passes over the same flat list, and no way to see the result until the last
 * pick landed. This is the other half of that: the four slots across the top, the
 * catalogue laid out in captioned bays under them, and the named boards as one
 * press each.
 *
 * **It commits live rather than editing a draft**, which is where it parts
 * company with the league filters dialog beside it. That one holds a draft
 * because every option in it carries a count, and counts can't be read while the
 * list behind them moves. Nothing here is counted: the slots show what each
 * column *will* say, previewed against a subject named in the footer, so there is
 * nothing to protect from moving and a reader who backs out has already seen the
 * result. Which is also why the footer says `Done` and not `Apply`.
 *
 * A native `<dialog>` for the focus trap, the inert background, Escape and the
 * backdrop; closing on a backdrop *click* is the one gesture the platform leaves
 * to the page.
 *
 * **It carries no trigger of its own — the column headings are the trigger.** A
 * chip beside them was a second way to reach the same board, and the one that
 * knew least: it could only ever open on slot 1, so a reader who wanted the
 * fourth column pressed the chip and then aimed again. `openSlot` is which
 * heading was pressed, and it is the slot the dialog opens armed on.
 *
 * Generic in the metrics' context on the same terms as {@link MetricColumn}: a
 * league card previews against a league, a share card against one player's or
 * person's leagues, and neither catalogue is imported here.
 */
export function ColumnsEditor<C>({
  metrics,
  columns,
  presets,
  ctx,
  previewLabel,
  openSlot,
  onClose,
  onColumnChange,
  onColumns,
  onReset,
}: {
  /** The catalogue this table picks from — the list's grain decides which. */
  metrics: Metric<C>[];
  /** The metric key each of the four slots shows. */
  columns: string[];
  /** The named boards offered as one press each. */
  presets: ColumnPreset[];
  /**
   * The subject the previews are read off — the first row of the list, or null
   * before one has loaded. An assumption, so {@link previewLabel} names it: an
   * unattributed number would pass as the column's own.
   */
  ctx: C | null;
  /** What `ctx` is, for the footer — "Previewing against …". */
  previewLabel: string | null;
  /** The heading that was pressed, or null while the dialog is closed. */
  openSlot: number | null;
  /** Escape, the backdrop, the close mark and Done all report through this. */
  onClose: () => void;
  /** Point one slot at a metric; the list swaps it with the slot that held it. */
  onColumnChange: (slot: number, key: string) => void;
  /** Replace all four — what a preset writes. */
  onColumns: (keys: readonly string[]) => void;
  /** Hand the table's opening columns back. */
  onReset: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  /**
   * Which slot the next pick fills.
   *
   * Armed rather than dragged: the catalogue is a dozen entries in two bays and
   * the slots are four small wells, so aim-then-pick is one press each way where
   * a drag is a gesture that can miss. It does not advance on its own — the
   * reader who came to change one column would find the next press landing
   * somewhere they never chose.
   *
   * It opens on the heading that was pressed rather than on slot 1, and then it
   * is the dialog's own: re-arming inside must survive, so `openSlot` seeds it
   * on the way in and never again. That seeding is done during render against
   * the previous `openSlot` — the pattern an effect would only reach a frame
   * late, which here is one frame of the dialog pointing at the wrong column.
   */
  const [slot, setSlot] = useState(openSlot ?? 0);
  const [openedAt, setOpenedAt] = useState(openSlot);
  if (openSlot !== openedAt) {
    setOpenedAt(openSlot);
    if (openSlot !== null) setSlot(openSlot);
  }

  // The one thing a `<dialog>` can't be told declaratively. `close` fires for
  // Escape and the backdrop alike, so the parent hears every way out through
  // the element's own event rather than through each of them separately.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (openSlot === null) {
      if (dialog.open) dialog.close();
    } else if (!dialog.open) {
      dialog.showModal();
    }
  }, [openSlot]);

  const groups = groupMetrics(metrics, "Metrics");
  const preview = (metric: Metric<C>) =>
    ctx === null ? null : metricPreview(metric.cell(ctx));

  // A preset is "on" when the board is exactly what it writes — the same
  // derivation the filters' chips use, so there is no second copy of the
  // selection that could disagree with the columns themselves.
  const isActive = (preset: ColumnPreset) =>
    preset.columns.length === columns.length &&
    preset.columns.every((key, i) => key === columns[i]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="columns-editor-title"
      onClose={onClose}
      // The backdrop is the dialog's own pseudo-element, so a click landing on
      // the dialog box itself is a click outside the panel.
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
      className="m-auto w-[min(760px,calc(100vw-2rem))] bg-transparent p-0 text-foreground backdrop:bg-[rgba(4,10,16,0.72)] backdrop:backdrop-blur-sm"
    >
        <div
          className="relative overflow-hidden rounded-2xl border border-active/20 bg-gradient-to-b from-[#14242f] to-[#0a1520] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.95),0_0_60px_-20px_rgba(0,255,229,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]"
          style={{ animation: "dialog-rise 0.18s cubic-bezier(0.2,0.9,0.3,1)" }}
        >
          {/* The specular rail every milled face in the app carries. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-active/70 to-transparent"
          />

          <div className="flex items-center gap-3 border-b border-foreground/10 bg-gradient-to-b from-foreground/[0.05] to-transparent px-5 py-4">
            <h2
              id="columns-editor-title"
              className="text-base font-semibold tracking-tight"
            >
              Stat columns
            </h2>
            <span className="hidden text-xs text-foreground/40 sm:inline">
              Every card shows the same four.
            </span>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Close"
              className="lab-chip lab-chip-sm ml-auto grid size-7 place-items-center rounded-full text-foreground/55 transition-colors hover:text-active"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="max-h-[min(72vh,36rem)] overflow-y-auto p-5">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <span className={CAPTION}>Board</span>
                {/*
                  The four slots as wells, in the order they appear on a card, so
                  the panel is laid out like the thing it edits. Each states the
                  metric it holds and what that metric would say — the value is
                  the point: a column named "Proj bench" tells you less than the
                  `#9 / 12` it is about to print.
                */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {columns.map((key, index) => {
                    const metric =
                      metrics.find((m) => m.key === key) ?? metrics[0];
                    const armed = index === slot;
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setSlot(index)}
                        aria-pressed={armed}
                        className={`lab-well flex flex-col gap-0.5 rounded-xl p-2.5 text-left transition-colors ${
                          armed ? "ring-1 ring-active/50" : "hover:bg-foreground/5"
                        }`}
                      >
                        <span className={CAPTION}>
                          Slot {index + 1}
                          {armed && (
                            <span className="ml-1 text-active/70">· editing</span>
                          )}
                        </span>
                        <span
                          className={`truncate text-[13px] font-bold ${
                            armed ? "text-active" : "text-foreground/85"
                          }`}
                        >
                          {metric?.label}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums text-foreground/40">
                          {(metric && preview(metric)) ?? "—"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/*
                The catalogue in bays, captioned by family. Two columns rather
                than one list, so a dozen metrics fit above the fold on a laptop
                — the same shape, and the same reason, as the filters dialog's
                rule bays.
              */}
              <div className="grid gap-3 sm:grid-cols-2">
                {groups.map((group) => (
                  <section
                    key={group.label}
                    className="lab-well flex flex-col gap-1.5 rounded-xl p-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-active/75">
                        {group.label}
                      </span>
                      <span className="h-px flex-1 bg-foreground/10" />
                    </div>
                    {group.metrics.map((metric) => {
                      const shown = columns.indexOf(metric.key);
                      const value = preview(metric);
                      return (
                        <button
                          key={metric.key}
                          type="button"
                          onClick={() => onColumnChange(slot, metric.key)}
                          className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors ${
                            shown === slot
                              ? "bg-active/15 text-active"
                              : "text-foreground/75 hover:bg-foreground/10 hover:text-foreground"
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {metric.label}
                          </span>
                          {/*
                            A metric already on the board says which slot has it,
                            because picking it moves the two rather than adding a
                            second copy — the swap is easier to accept when it was
                            visible before the press.
                          */}
                          {shown >= 0 && shown !== slot && (
                            <span className="shrink-0 rounded-[4px] border border-foreground/15 px-1 font-mono text-[9px] leading-4 text-foreground/40">
                              {shown + 1}
                            </span>
                          )}
                          {value !== null && (
                            <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground/40">
                              {value}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </section>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className={CAPTION}>Presets</span>
                {presets.map((preset) => {
                  const on = isActive(preset);
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => onColumns(preset.columns)}
                      title={preset.columns
                        .map(
                          (key) =>
                            metrics.find((m) => m.key === key)?.label ?? key,
                        )
                        .join(" · ")}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        on
                          ? "lab-chip-on"
                          : "lab-chip lab-chip-sm text-foreground/60 hover:text-foreground"
                      }`}
                    >
                      {preset.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 border-t border-foreground/10 bg-gradient-to-b from-transparent to-black/25 px-5 py-4">
            <button
              type="button"
              onClick={onReset}
              className="rounded-lg border border-foreground/10 px-4 py-2 text-sm font-semibold text-foreground/60 transition-colors hover:border-foreground/25 hover:text-foreground"
            >
              Reset
            </button>
            {previewLabel && (
              <span className="hidden min-w-0 truncate text-xs text-foreground/40 sm:inline">
                Previewing against {previewLabel}
              </span>
            )}
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className="ml-auto rounded-lg bg-active px-4 py-2 text-sm font-bold text-[#04141a] shadow-[0_0_24px_-6px_rgba(0,255,229,0.7)] transition-[filter] hover:brightness-110"
            >
              Done
            </button>
        </div>
      </div>
    </dialog>
  );
}

/** The uppercase caption over every group and slot, as in the filters dialog. */
const CAPTION =
  "font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/40";

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
    >
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}
