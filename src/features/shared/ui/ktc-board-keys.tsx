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
 * the manager page's Columns dialog and the trades board's **Value** panel. The
 * two pages consume the choice differently — see the trades route on why one
 * sends it to the server and the other does not, and note that only the market
 * axis has a second reader: a KTC column on `/manager` names its own QB board,
 * where the trades board resolves that from the league. But the control and the
 * key behind it are one.
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

/** Why a board key is off: a sibling bay is already reading it. */
const BOARD_TAKEN = "Another bay is on this board";

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

/**
 * Three sizes, and they are sizes rather than three components.
 *
 * `md` is the full key, `sm` the one that fits two switches inside a 200px
 * bay, and `row` the labelled track the columns dialog stands its four axes in
 * — legend on the left at `sm` and up, above the keys below it. What must not
 * happen is a hand-copied track beside this one: a switch that stopped
 * travelling in one of two spellings is exactly the failure `console-chrome`'s
 * constants exist to prevent.
 */
type Size = "md" | "sm" | "row";

export function KtcBoardKeys({
  board,
  onChange,
  disabled = false,
  className = "",
  size = "md",
  legend = false,
  taken,
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
  size?: Size;
  /** Draw the axis's name beside the track — see {@link SwitchTrack}. */
  legend?: boolean;
  /** Options another bay already holds — see {@link SwitchTrack}. */
  taken?: (board: KtcBoardChoice) => boolean;
}) {
  return (
    <SwitchTrack
      label="Market"
      legend={legend}
      options={KTC_BOARD_CHOICES}
      value={board}
      onChange={onChange}
      labels={size === "md" ? MARKET_LABELS : MARKET_LABELS_SM}
      className={className}
      size={size}
      disabled={disabled}
      unavailable={
        taken &&
        ((board: KtcBoardChoice) => (taken(board) ? BOARD_TAKEN : null))
      }
    />
  );
}

export function KtcLineupKeys({
  lineup,
  onChange,
  className = "",
  size = "sm",
  legend = false,
  taken,
}: {
  lineup: KtcLineupChoice;
  onChange: (lineup: KtcLineupChoice) => void;
  className?: string;
  size?: Size;
  legend?: boolean;
  taken?: (lineup: KtcLineupChoice) => boolean;
}) {
  return (
    <SwitchTrack
      label={legend ? "QB board" : "Lineup"}
      legend={legend}
      options={KTC_LINEUP_CHOICES}
      value={lineup}
      onChange={onChange}
      labels={LINEUP_LABELS}
      className={className}
      size={size}
      unavailable={
        taken &&
        ((lineup: KtcLineupChoice) => (taken(lineup) ? BOARD_TAKEN : null))
      }
    />
  );
}

/**
 * One switch: a recessed track holding one raised key and the rest flush.
 *
 * Generic over the option type so its readers share the grammar rather than
 * the vocabulary — a market is `dynasty`/`redraft`, a lineup is `oneqb`/`sf`
 * and the columns dialog's own axes are neither, and mixing two lists is a
 * state no parser would reject.
 *
 * **Exported, because the columns dialog's Value and Scope axes are the same
 * switch.** They were going to be a second track written beside this one, and
 * that is the duplication the module note above rules out: four tracks in one
 * panel where one of them has stopped travelling is a panel nobody can see is
 * broken.
 *
 * Two things generalised with it, and each is a state the two KTC axes never
 * had. `value` may be **null** — an empty bay lights nothing, where a market
 * always has an answer — and `unavailable` returns a *reason* rather than a
 * boolean, because a key can now be off for reasons that are not "another bay
 * holds it": there is no whole-roster projection, and only KeepTradeCut prices
 * a pick. A key that is off says which in its title.
 */
export function SwitchTrack<T extends string>({
  label,
  legend = false,
  options,
  value,
  onChange,
  labels,
  className,
  size,
  disabled = false,
  unavailable,
}: {
  label: string;
  /** Draw the label beside the track. Otherwise it is the group's name alone. */
  legend?: boolean;
  options: readonly T[];
  /** The lit option, or null where the switch is standing off every detent. */
  value: T | null;
  onChange: (value: T) => void;
  labels: Record<T, string>;
  className: string;
  size: Size;
  /** Whether the axis is in force at all — see {@link KtcBoardKeys.disabled}. */
  disabled?: boolean;
  /**
   * Why an option cannot be pressed, or null where it can.
   *
   * **Disabling rather than correcting**, which is the rule the columns dialog
   * already enforces its budget by: two bays on one metric differ only by these
   * keys, so a press that landed on the pricing the other bay holds would have
   * to either lose a column or exchange the two — one silent, the other a key
   * that appears dead once the canonical order puts them back where they were.
   * The reason is the key's `title`, so a reader can find out *why* it is off
   * rather than being left to guess between "taken" and "does not exist".
   */
  unavailable?: (option: T) => string | null;
}) {
  const row = size === "row";
  const small = size === "sm" || row;
  const keys = (
    <div
      role="group"
      aria-label={label}
      className={`${CONSOLE_TRACK} ${
        small ? "flex gap-0.5 p-[0.1875rem]" : "inline-flex gap-1 p-1"
      } ${row ? "min-w-0 flex-1" : ""} ${className}`}
    >
      {options.map((option) => {
        const why = option === value ? null : (unavailable?.(option) ?? null);
        return (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          // Two different reasons a key can be off, and only one of them is
          // about this key: `why` is about this option — another bay holds the
          // pricing, or the pairing has no metric behind it — where `disabled`
          // means the whole axis is out of force. The first explains itself in
          // a title; the second is explained by whatever turned the track off,
          // so a title here would be a second answer.
          disabled={disabled || why !== null}
          title={why ?? undefined}
          className={
            `min-w-0 truncate rounded-full border font-mono uppercase transition-[color,box-shadow] duration-150 ` +
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 " +
            "disabled:cursor-not-allowed " +
            (row
              ? "flex-1 px-1 py-[0.3125rem] text-[length:var(--fs-10)] tracking-[0.04em] "
              : small
                ? "flex-1 px-1 py-[0.1875rem] text-[length:var(--fs-8-5)] tracking-[0.1em] "
                : "px-3 py-1.5 text-[length:var(--fs-10)] tracking-[0.16em] ") +
            (value === option
              ? "border-active/45 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]"
              : why !== null
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

  if (!legend) return keys;

  // The legend is `aria-hidden` because the group it labels already carries
  // the same string as its accessible name — a visible copy on top of that
  // would announce the axis twice.
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2.5">
      <span
        aria-hidden
        className="font-mono text-[length:var(--fs-11)] uppercase tracking-[0.08em] text-foreground/72 sm:w-[4.375rem] sm:shrink-0"
      >
        {label}
      </span>
      {keys}
    </div>
  );
}
