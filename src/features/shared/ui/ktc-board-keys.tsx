"use client";

import type { KtcBoardChoice } from "@/shared/contract";
import { KTC_BOARD_CHOICES } from "@/shared/ktc/board-choice";

import { CONSOLE_TRACK } from "../console-chrome";

/**
 * The KeepTradeCut board control: three keys in one recessed track.
 *
 * Shaped after `LineupLensKeys` and for its reason — the selected option is a
 * raised face and the others are bare text *on the track*, because three raised
 * faces in one channel is a row of buttons where one raised and two flush is a
 * switch showing its position.
 *
 * It lives in `features/shared` on `CONSOLE_KEY`'s line: two features read it,
 * the manager page's Columns dialog and the trades board's control rail. The
 * two pages consume the choice differently — see the trades route on why one
 * sends it to the server and the other does not — but the control and the key
 * behind it are one.
 *
 * `auto` reads as "Auto" rather than naming a market, which is the whole
 * distinction: it is a rule about each league, not a third board.
 */

const LABELS: Record<KtcBoardChoice, string> = {
  auto: "Auto",
  dynasty: "Dynasty",
  redraft: "Redraft",
};

export function KtcBoardKeys({
  board,
  onChange,
  disabled = false,
  className = "",
}: {
  board: KtcBoardChoice;
  onChange: (board: KtcBoardChoice) => void;
  /**
   * Whether the choice is in force at all.
   *
   * The trades board's value panel is what needed it: on the capital and points
   * bases no market is being read, so the track is a control over nothing.
   * Disabling it rather than leaving it pressable-but-dimmed is this app's own
   * rule — the columns picker greys the box that would break its bounds, and a
   * key that visibly changes nothing is a key a reader presses twice and then
   * distrusts. Real `disabled` rather than `aria-disabled` is safe because
   * nothing here has focus at the moment it flips: the press that turns the
   * track off landed on a control outside it.
   */
  disabled?: boolean;
  /** Extra classes for the housing, so a caller can place it in its own row. */
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="KeepTradeCut board"
      className={`${CONSOLE_TRACK} inline-flex gap-1 p-1 ${className}`}
    >
      {KTC_BOARD_CHOICES.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={board === option}
          disabled={disabled}
          className={`rounded-full border px-3 py-1.5 font-mono text-[0.625rem] uppercase tracking-[0.16em] transition-[color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 disabled:cursor-not-allowed disabled:hover:text-foreground/58 ${
            board === option
              ? "border-active/45 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]"
              : "border-transparent text-foreground/58 hover:text-readout"
          }`}
        >
          {LABELS[option]}
        </button>
      ))}
    </div>
  );
}
