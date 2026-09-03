"use client";

import { useRef } from "react";

import type { LineupMetricId } from "@/shared/contract";
import {
  CONSOLE_KEY_BLOCK,
  CONSOLE_KEY_PILL,
  CONSOLE_READOUT,
  LINEUP_METRIC_IDS,
  MAX_LINEUP_COLUMNS,
  storeLineupColumns,
} from "@/features/shared";

import { LINEUP_METRIC_LABELS } from "../helpers/lineup-metrics";

/**
 * The column picker: a trigger key and a native `<dialog>`, which is the whole
 * reason there is no dependency here — `showModal()` brings the focus trap,
 * the Esc-to-close and the `::backdrop` with it.
 *
 * A toggle writes immediately rather than staging an "apply": the cards update
 * live behind the dialog, which *is* the preview, and there is no draft state
 * to reconcile with a change from another tab. The bounds are enforced by
 * disabling rather than refusing — at {@link MAX_LINEUP_COLUMNS} the unchecked
 * boxes grey out, and the last checked box does too, so the selection can
 * never be invalid in the first place.
 *
 * **Every checkbox is an indicator lamp**, and the real `<input>` is still
 * underneath it. Visually hidden rather than replaced: the lamp is drawn from
 * `peer-checked`, so the keyboard behaviour, the label association and the
 * disabled semantics are the browser's rather than something re-implemented
 * with `role="checkbox"`.
 */
export function LineupColumnsDialog({
  columns,
  triggerClassName = `${CONSOLE_KEY_PILL} inline-flex items-center border-foreground/10 bg-[image:var(--key-bg)] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout`,
}: {
  columns: readonly LineupMetricId[];
  /** The trigger's shape — see `LeagueFiltersDialog`, which is shaped the same way. */
  triggerClassName?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const active = new Set(columns);
  const full = columns.length >= MAX_LINEUP_COLUMNS;

  const toggle = (id: LineupMetricId) => {
    storeLineupColumns(
      active.has(id) ? columns.filter((c) => c !== id) : [...columns, id],
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-haspopup="dialog"
        className={triggerClassName}
      >
        Columns
        {/* The count is a plain trailing figure, not a badge: unlike Filters
            this key is never "off", so there is no state for a lit chip to
            announce — only how many of the four are in use. */}
        <span className="ml-2 tabular-nums text-foreground/55">
          {columns.length}
        </span>
      </button>

      <dialog
        ref={ref}
        // Closing on a backdrop click: the dialog element itself is only ever
        // the click target when the click landed outside the panel.
        onClick={(e) => {
          if (e.target === e.currentTarget) ref.current?.close();
        }}
        className="m-auto w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-foreground/12 bg-background bg-[image:var(--panel-bg)] p-0 text-foreground shadow-[var(--panel-shadow),0_24px_60px_-34px_var(--surface-shadow)] backdrop:bg-black/60"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[image:var(--panel-grain)]"
        />
        <div className="relative p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 font-display text-base font-semibold tracking-[-0.01em]">
              Card columns
            </h2>
            {/* The budget, on glass: it is a number that moves as you press,
                which is the one thing on this panel that is a readout. */}
            <span
              className={`${CONSOLE_READOUT} inline-flex shrink-0 items-center rounded-full px-2.5 py-1`}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
              />
              <span className="relative font-mono text-[0.6875rem] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
                {columns.length} / {MAX_LINEUP_COLUMNS}
              </span>
            </span>
          </div>
          <p className="mt-1.5 font-mono text-[0.6875rem] leading-normal text-foreground/58">
            Up to {MAX_LINEUP_COLUMNS} columns, ranked against the rest of each
            league.
          </p>

          <ul className="m-0 mt-4 flex list-none flex-col gap-0.5 p-0">
            {LINEUP_METRIC_IDS.map((id) => {
              const checked = active.has(id);
              // The two invalid states, prevented rather than corrected: a
              // fifth column, and an empty card.
              const disabled = checked ? columns.length === 1 : full;
              return (
                <li key={id}>
                  <label
                    className={`flex items-center gap-3 rounded-[0.625rem] px-2 py-[0.4375rem] transition-colors ${
                      disabled
                        ? "cursor-not-allowed opacity-40"
                        : "cursor-pointer hover:bg-foreground/[0.04]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(id)}
                      className="peer sr-only"
                    />
                    {/* A dark empty socket, lit from within when checked. The
                        focus ring rides the lamp because the input it belongs
                        to has no box of its own to draw one on. */}
                    <span
                      aria-hidden
                      className="inline-flex size-[1.125rem] shrink-0 items-center justify-center rounded-[0.3125rem] border border-black/80 bg-[image:var(--key-bg)] shadow-[inset_0_2px_5px_rgba(0,0,0,0.6)] transition-[box-shadow,border-color] duration-150 peer-checked:border-active/55 peer-checked:bg-[image:var(--readout-bg)] peer-checked:shadow-[var(--readout-shadow),0_0_14px_-4px_var(--accent-glow)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-active/60"
                    >
                      <span
                        className={`size-[0.4375rem] rounded-full transition-opacity duration-150 ${
                          checked
                            ? "bg-active opacity-100 shadow-[0_0_9px_var(--accent-glow)]"
                            : "opacity-0"
                        }`}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block font-display text-[0.8125rem] font-semibold ${
                          checked ? "text-readout" : "text-foreground/88"
                        }`}
                      >
                        {LINEUP_METRIC_LABELS[id].column}
                      </span>
                      <span className="block font-mono text-[0.6875rem] text-foreground/52">
                        {LINEUP_METRIC_LABELS[id].option}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <p className="mt-3 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/45">
            At {MAX_LINEUP_COLUMNS}, the rest grey out rather than refuse.
          </p>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className={`${CONSOLE_KEY_BLOCK} border-active/50 bg-[image:var(--key-bg)] px-5 text-[0.625rem] text-readout shadow-[var(--key-shadow),0_0_22px_-8px_var(--accent-glow)] [text-shadow:var(--readout-text-glow)]`}
            >
              Done
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
