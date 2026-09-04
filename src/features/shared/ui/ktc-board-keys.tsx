"use client";

import type { KtcBoardChoice, KtcLineupChoice } from "@/shared/contract";
import {
  KTC_BOARD_CHOICES,
  KTC_LINEUP_CHOICES,
} from "@/shared/ktc/board-choice";

import { CONSOLE_TRACK } from "../console-chrome";

/**
 * The two KeepTradeCut axes, each as three keys in one recessed track: which
 * market a number is read on, and which of that market's two QB boards.
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
 * `auto` reads as "Auto" on both axes rather than naming a board, which is the
 * whole distinction: it is a rule about each league, not a third option.
 *
 * **The small arm is a size, not a second component.** The columns dialog
 * stands two of these inside a 200px bay, where the full key's `px-3 py-1.5`
 * and 10px legend do not fit; what must not happen is a hand-copied track
 * beside this one, because a switch that stopped travelling in one of the two
 * spellings is exactly the failure `console-chrome`'s constants exist to
 * prevent. Two rows of three rather than one row of six is the same argument at
 * the layout grain: six keys across a bay is 30px each and "1QB" stops being a
 * word.
 */

const MARKET_LABELS: Record<KtcBoardChoice, string> = {
  auto: "Auto",
  dynasty: "Dynasty",
  redraft: "Redraft",
};

/** The same three, abbreviated for a bay's width. */
const MARKET_LABELS_SM: Record<KtcBoardChoice, string> = {
  auto: "Auto",
  dynasty: "Dyn",
  redraft: "Red",
};

const LINEUP_LABELS: Record<KtcLineupChoice, string> = {
  auto: "Auto",
  oneqb: "1QB",
  sf: "SF",
};

type Size = "md" | "sm";

export function KtcBoardKeys({
  board,
  onChange,
  className = "",
  size = "md",
  taken,
}: {
  board: KtcBoardChoice;
  onChange: (board: KtcBoardChoice) => void;
  /** Extra classes for the housing, so a caller can place it in its own row. */
  className?: string;
  size?: Size;
  /** Options another bay already holds — see {@link SwitchTrack}. */
  taken?: (board: KtcBoardChoice) => boolean;
}) {
  return (
    <SwitchTrack
      label="Market"
      options={KTC_BOARD_CHOICES}
      value={board}
      onChange={onChange}
      labels={size === "sm" ? MARKET_LABELS_SM : MARKET_LABELS}
      className={className}
      size={size}
      taken={taken}
    />
  );
}

export function KtcLineupKeys({
  lineup,
  onChange,
  className = "",
  size = "sm",
  taken,
}: {
  lineup: KtcLineupChoice;
  onChange: (lineup: KtcLineupChoice) => void;
  className?: string;
  size?: Size;
  taken?: (lineup: KtcLineupChoice) => boolean;
}) {
  return (
    <SwitchTrack
      label="Lineup"
      options={KTC_LINEUP_CHOICES}
      value={lineup}
      onChange={onChange}
      labels={LINEUP_LABELS}
      className={className}
      size={size}
      taken={taken}
    />
  );
}

/**
 * One switch: a recessed track holding one raised key and two flush ones.
 *
 * Generic over the option type so the two axes share the grammar rather than
 * the vocabulary — a market is `dynasty`/`redraft` and a lineup is
 * `oneqb`/`sf`, and mixing the two lists is a state neither parser would
 * reject.
 */
function SwitchTrack<T extends string>({
  label,
  options,
  value,
  onChange,
  labels,
  className,
  size,
  taken,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labels: Record<T, string>;
  className: string;
  size: Size;
  /**
   * Which options are already spoken for elsewhere, and therefore greyed.
   *
   * **Disabling rather than correcting**, which is the rule the columns dialog
   * already enforces its budget by: the two bays on one metric differ only by
   * these six keys, so a press that landed on the pricing the other bay holds
   * would have to either lose a column or exchange the two — one silent, the
   * other a key that appears dead once the canonical order puts them back where
   * they were. Greyed, the reader can see that the board is taken and by which
   * of the two switches.
   */
  taken?: (option: T) => boolean;
}) {
  const small = size === "sm";
  return (
    <div
      role="group"
      aria-label={label}
      className={`${CONSOLE_TRACK} ${
        small ? "flex gap-0.5 p-[0.1875rem]" : "inline-flex gap-1 p-1"
      } ${className}`}
    >
      {options.map((option) => {
        const spoken = option !== value && (taken?.(option) ?? false);
        return (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          disabled={spoken}
          title={spoken ? "Another bay is on this board" : undefined}
          className={
            `rounded-full border font-mono uppercase transition-[color,box-shadow] duration-150 ` +
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 " +
            (small
              ? "flex-1 px-1 py-[0.1875rem] text-[0.53125rem] tracking-[0.1em] "
              : "px-3 py-1.5 text-[0.625rem] tracking-[0.16em] ") +
            (value === option
              ? "border-active/45 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]"
              : spoken
                ? "cursor-not-allowed border-transparent text-foreground/25"
                : "border-transparent text-foreground/58 hover:text-readout")
          }
        >
          {labels[option]}
        </button>
        );
      })}
    </div>
  );
}
