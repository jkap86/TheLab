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
  return (
    // Below `sm` this stacks for the same reason the cards do — the trigger takes
    // the first line, the headings the second, whole — so the two lines of the
    // rail sit over the two lines of every card under it.
    <div className="flex flex-col gap-2 border border-transparent px-4 pl-5 sm:flex-row sm:items-end sm:gap-4">
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

      <MetricHeadings
        metrics={metrics}
        columns={columns}
        onColumnChange={onColumnChange}
        onReset={onReset}
      />
    </div>
  );
}
