"use client";

import { useCallback, useState } from "react";

import type { ColumnPreset, Metric } from "../metric-cell";
import { ColumnsEditor } from "./columns-editor";
import { MetricHeadings } from "./metric-column";

/**
 * The list's stat columns, stated once above it: what each slot holds, and the
 * two ways to change it.
 *
 * The selection has always been list-wide — one pick moves the column on every
 * card — but it was only ever drawn on the cards, which says the opposite: four
 * labels repeated down a hundred rows read as four per-card controls, and
 * changing the board read as four unrelated errands. So the labels are lifted
 * here, where the selection actually lives, and the cards below keep the numbers
 * alone.
 *
 * It is laid on the cards' own geometry — the same left inset, the same trailing
 * gutter, the same column width — so each heading sits over the numbers it names.
 * The 1px transparent border is not a rounding error: the cards carry a border,
 * and without one here every heading would be a pixel out.
 *
 * **A heading is the only control here — there is no `Columns` chip beside it.**
 * The chip and the menus were two ways to the same board and the chip knew less
 * than the label: it always opened on slot 1, so changing the fourth column was
 * a press to open and a second press to aim at the column already named on
 * screen. Pressing a heading opens the editor armed on that heading's slot,
 * which is the same gesture answering both.
 *
 * **The headings are drawn at every width — they used to drop below `sm` and let
 * the cards grow their own labels back.** That made the same list two different
 * things either side of one breakpoint: a table with a heading rail on a laptop,
 * a stack of cards each naming its own four columns on a phone, which says the
 * selection is a fact about a card when it is a fact about the list. What was
 * actually breaking down there is geometry, not the rail — a card stacks, so its
 * columns take a line of their own — so the rail stacks with it and its columns
 * divide that line exactly as the cards' do, landing over the numbers they name
 * at both widths.
 */
export function ColumnsBar<C>({
  metrics,
  columns,
  presets,
  ctx,
  previewLabel,
  onColumnChange,
  onColumns,
  onReset,
}: {
  metrics: Metric<C>[];
  columns: string[];
  presets: ColumnPreset[];
  /** The subject the editor previews against — the list's first row, or null. */
  ctx: C | null;
  previewLabel: string | null;
  onColumnChange: (slot: number, key: string) => void;
  onColumns: (keys: readonly string[]) => void;
  onReset: () => void;
}) {
  /** Which heading opened the editor, and so which slot it opens armed on. */
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const close = useCallback(() => setOpenSlot(null), []);

  return (
    // Below `sm` the headings take a line of their own, as the cards' columns do
    // — so the rail sits over the numbers it names at both widths. From `sm` up
    // it rides at the end of the row, which with nothing to its left is what
    // `justify-end` is for.
    <div className="flex flex-col gap-2 border border-transparent px-4 pl-5 sm:flex-row sm:items-end sm:justify-end sm:gap-4">
      <MetricHeadings
        metrics={metrics}
        columns={columns}
        onOpen={setOpenSlot}
      />

      <ColumnsEditor
        metrics={metrics}
        columns={columns}
        presets={presets}
        ctx={ctx}
        previewLabel={previewLabel}
        openSlot={openSlot}
        onClose={close}
        onColumnChange={onColumnChange}
        onColumns={onColumns}
        onReset={onReset}
      />
    </div>
  );
}
