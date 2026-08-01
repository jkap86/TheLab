"use client";

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
 * **The headings drop below `sm` and the cards take their labels back.** That is
 * the width where a card stops being a row — it stacks, the name takes a line of
 * its own — so a heading rail above the list would be naming columns that are no
 * longer under it. The trigger stays at every width, since the editor is the one
 * control that works the same whatever the cards are doing.
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
  return (
    <div className="flex items-end gap-4 border border-transparent px-4 pl-5">
      <div className="flex min-w-0 flex-1 items-center">
        <ColumnsEditor
          metrics={metrics}
          columns={columns}
          presets={presets}
          ctx={ctx}
          previewLabel={previewLabel}
          onColumnChange={onColumnChange}
          onColumns={onColumns}
          onReset={onReset}
        />
      </div>

      <div className="hidden sm:block">
        <MetricHeadings
          metrics={metrics}
          columns={columns}
          onColumnChange={onColumnChange}
          onReset={onReset}
        />
      </div>
    </div>
  );
}
