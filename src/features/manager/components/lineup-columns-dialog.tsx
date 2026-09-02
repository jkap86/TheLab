"use client";

import { useRef } from "react";

import type { LineupMetricId } from "@/shared/contract";
import {
  LINEUP_METRIC_IDS,
  MAX_LINEUP_COLUMNS,
  storeLineupColumns,
} from "@/features/shared";

import { LINEUP_METRIC_LABELS } from "../helpers/lineup-metrics";

/**
 * The column picker: a trigger button and a native `<dialog>`, which is the
 * whole reason there is no dependency here — `showModal()` brings the focus
 * trap, the Esc-to-close and the `::backdrop` with it.
 *
 * A toggle writes immediately rather than staging an "apply": the cards update
 * live behind the dialog, which *is* the preview, and there is no draft state
 * to reconcile with a change from another tab. The bounds are enforced by
 * disabling rather than refusing — at {@link MAX_LINEUP_COLUMNS} the unchecked
 * boxes grey out, and the last checked box does too, so the selection can
 * never be invalid in the first place.
 */
export function LineupColumnsDialog({
  columns,
}: {
  columns: readonly LineupMetricId[];
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
        className="shrink-0 rounded-lg border border-foreground/15 px-4 py-2 text-sm text-foreground/70 transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/50"
      >
        Columns
      </button>

      <dialog
        ref={ref}
        // Closing on a backdrop click: the dialog element itself is only ever
        // the click target when the click landed outside the panel.
        onClick={(e) => {
          if (e.target === e.currentTarget) ref.current?.close();
        }}
        className="m-auto w-full max-w-sm rounded-2xl border border-foreground/12 bg-background p-6 text-foreground shadow-[0_24px_60px_-34px_var(--surface-shadow)] backdrop:bg-black/60"
      >
        <h2 className="font-display text-base font-semibold tracking-tight">
          Card columns
        </h2>
        <p className="mt-1 text-xs text-foreground/60">
          Up to {MAX_LINEUP_COLUMNS} columns, ranked against the rest of each
          league.
        </p>

        <ul className="mt-4 space-y-1">
          {LINEUP_METRIC_IDS.map((id) => {
            const checked = active.has(id);
            // The two invalid states, prevented rather than corrected: a fifth
            // column, and an empty card.
            const disabled = checked ? columns.length === 1 : full;
            return (
              <li key={id}>
                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-foreground/5 ${
                    disabled ? "cursor-not-allowed opacity-40" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(id)}
                    className="accent-active"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-foreground/90">
                      {LINEUP_METRIC_LABELS[id].column}
                    </span>
                    <span className="block text-xs text-foreground/55">
                      {LINEUP_METRIC_LABELS[id].option}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="rounded-lg border border-active/40 bg-active/10 px-5 py-2 text-sm font-medium text-active transition-colors hover:bg-active/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/50"
          >
            Done
          </button>
        </div>
      </dialog>
    </>
  );
}
