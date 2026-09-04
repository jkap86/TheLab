"use client";

import type {
  KtcBoardChoice,
  LineupMetricId,
  ManagerLineupsPayload,
} from "@/shared/contract";
import {
  CONSOLE_KEY_BLOCK,
  CONSOLE_WELL,
  LINEUP_METRIC_LABELS,
  LineupColumnsDialog,
  storeLineupColumns,
} from "@/features/shared";

/**
 * Which rank columns the cards are carrying, as a tray of lit chips under the
 * plate — each one pressable to take that column off.
 *
 * **A closed dialog says nothing**, which is the same problem the subject
 * tokens below the grid solve and the same answer: the picker hides its own
 * state the moment it closes, so a reader who chose two columns three scrolls
 * ago has nothing on screen naming them. The chips are that naming, and making
 * them pressable costs nothing — removing a column is the only edit a reader
 * makes often enough to want without opening a dialog for it.
 *
 * **Only the chosen columns are drawn.** The prototype also showed the five
 * unchosen metrics as unlit `+` chips; that was a way of reviewing the idea
 * rather than the design. Nine options as a permanent strip is the picker
 * rebuilt in the page, and the picker is one key away.
 *
 * The strip and the dialog are the same state, not two: both write through
 * {@link storeLineupColumns} and both read {@link useLineupColumns}, so a chip
 * pressed here and a box unticked in there are one edit under
 * `thelab:lineup-columns`.
 */
export function ColumnsStrip({
  columns,
  board,
  ktc,
}: {
  /** The chosen columns, already in canonical order — see `useLineupColumns`. */
  columns: readonly LineupMetricId[];
  /** The stored KeepTradeCut market, for the dialog's own readout. */
  board: KtcBoardChoice;
  /** Which market answered and when it was scraped; null when none could. */
  ktc: ManagerLineupsPayload["ktc"];
}) {
  /**
   * **The last chip is guarded here rather than in the store**, and the reason
   * is `normalize`: handed an empty array it falls back to
   * `DEFAULT_LINEUP_COLUMNS`, which is right for a stale or hand-edited stored
   * value and exactly wrong for this press — removing the last column would
   * silently restore all four defaults rather than clearing the row. So the
   * press is a no-op instead. The dialog's own picker enforces the same bound
   * by disabling the last ticked box, which is the same rule seen from the
   * other side.
   */
  const remove = (id: LineupMetricId) => {
    if (columns.length <= 1) return;
    storeLineupColumns(columns.filter((c) => c !== id));
  };

  return (
    <div
      className={`${CONSOLE_WELL} relative mt-3.5 flex flex-wrap items-center gap-2 p-2`}
    >
      <span className="pl-1.5 pr-2 font-mono text-[0.5625rem] uppercase tracking-[0.18em] text-foreground/[0.42]">
        Columns
      </span>

      {columns.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => remove(id)}
          className={
            `${CONSOLE_KEY_BLOCK} gap-2 border-active/40 bg-[image:var(--readout-bg)] px-2.5 py-[0.4375rem] ` +
            "text-readout [text-shadow:var(--readout-text-glow)] " +
            "shadow-[inset_0_0_14px_rgba(0,255,229,0.12),0_1px_0_rgba(255,255,255,0.07)]"
          }
        >
          {/* The accessible name is the *action*, not the label: a button
              reading "ROS starters" announces a column, where what pressing it
              does is take one away. The glyph is decoration on top of that. */}
          <span className="sr-only">Remove {LINEUP_METRIC_LABELS[id].column}</span>
          <span aria-hidden>{LINEUP_METRIC_LABELS[id].column}</span>
          <span aria-hidden className="text-[0.75rem] leading-none text-readout-muted">
            ×
          </span>
        </button>
      ))}

      <LineupColumnsDialog
        columns={columns}
        board={board}
        ktc={ktc}
        triggerClassName={`${CONSOLE_KEY_BLOCK} ml-auto border-foreground/10 bg-[image:var(--key-bg)] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout`}
      />
    </div>
  );
}
