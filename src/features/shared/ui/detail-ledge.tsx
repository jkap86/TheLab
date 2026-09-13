"use client";

import type { ReactNode } from "react";

import { CONSOLE_KEY_PILL_BARE, CONSOLE_WINDOW_LEDGE } from "../console-chrome";

/**
 * A detail pane's own header: the subject, what sits beside its name, and the
 * `Narrow grid` key.
 *
 * It came out of the manager page's shares console when the gametime stat
 * board's pane became a second reader — the line `CONSOLE_KEY` and
 * `ManagerPlate` moved on. The two panes answer the same question from two
 * tools ("which of my leagues is this player in, and show me them"), and a key
 * that narrowed the grid on one page and was drawn differently, or missing, on
 * the other is the drift the console passes exist to remove.
 *
 * **One key, not a press on every row.** Every league a pane reads narrows to
 * the same set, so a row in it is a reading and this is the control; pressed,
 * it says the grid behind is already on it. It is omitted when `onNarrow` is —
 * a subject with no leagues to narrow to has no key, rather than a key that
 * empties the grid.
 *
 * What differs between the two panes rides the slots: `aside` is the manager's
 * position-and-team note and gametime's points well, `sub` is gametime's meta
 * lines, and `children` is whatever control shares the key's row.
 */
export function DetailLedge({
  name,
  aside,
  sub,
  narrowing,
  onNarrow,
  narrowLabel = "",
  children,
}: {
  name: string;
  /** Beside the name, on its baseline. */
  aside?: ReactNode;
  /** Under the name line, above the controls. */
  sub?: ReactNode;
  narrowing: boolean;
  /** Absent draws no key. */
  onNarrow?: () => void;
  /** What the grid would be narrowed *to* — the key's accessible name. */
  narrowLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`${CONSOLE_WINDOW_LEDGE} relative z-[2] mx-1.5 mt-1.5 flex shrink-0 flex-col gap-1.5 rounded-[7px] px-2.5 py-2`}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-display text-[length:var(--fs-15)] font-semibold text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)]">
          {name}
        </span>
        {aside}
      </div>
      {sub}
      {(children || onNarrow) && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {children}
          {onNarrow && (
            <button
              type="button"
              onClick={onNarrow}
              aria-pressed={narrowing}
              aria-label={
                narrowing
                  ? `Stop narrowing to ${narrowLabel}`
                  : `Narrow the league grid to ${narrowLabel}`
              }
              className={`${CONSOLE_KEY_PILL_BARE} ml-auto px-3 py-[0.3125rem] text-[length:var(--fs-10)] tracking-[0.14em] ${
                narrowing
                  ? "border-active/55 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow-pressed),inset_0_0_14px_color-mix(in_srgb,var(--accent)_16%,transparent)] [text-shadow:var(--readout-text-glow)]"
                  : "border-foreground/10 bg-[image:var(--key-metal)] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout"
              }`}
            >
              {narrowing ? "Narrowing" : "Narrow grid"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
