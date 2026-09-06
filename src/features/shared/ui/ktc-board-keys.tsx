"use client";

import { Fragment } from "react";

import type { KtcBoardChoice, KtcLineupChoice } from "@/shared/contract";
import {
  KTC_BOARD_CHOICES,
  KTC_LINEUP_CHOICES,
} from "@/shared/ktc/board-choice";

import { CONSOLE_CHANNEL, CONSOLE_TRACK } from "../console-chrome";
import { MilledHairline } from "./card-plate";

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
 * **The small arm is a size, not a second component.** It was written when the
 * columns dialog stood two of these inside a 200px bay, where the full key's
 * `px-3 py-1.5` and 10px legend did not fit; what must not happen is a
 * hand-copied track beside this one, because a switch that stopped travelling
 * in one of the two spellings is exactly the failure `console-chrome`'s
 * constants exist to prevent. Two rows of three rather than one row of six is
 * the same argument at the layout grain: six keys across a bay is 30px each and
 * "1QB" stops being a word.
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

/**
 * Three sizes, and they are sizes rather than three components.
 *
 * `md` is the full key, `sm` the one that fits two switches inside a 200px
 * bay, and `row` the labelled track the columns dialog stands its five axes in
 * — legend on the left at `sm` and up, above the keys below it. What must not
 * happen is a hand-copied track beside this one: a switch that stopped
 * travelling in one of two spellings is exactly the failure `console-chrome`'s
 * constants exist to prevent.
 *
 * `row` is also the only arm whose key is a **raised face**, which is why it
 * takes {@link CONSOLE_CHANNEL} rather than {@link CONSOLE_TRACK}: see the
 * class string below.
 */
type Size = "md" | "sm" | "row";

export function KtcBoardKeys({
  board,
  onChange,
  disabled = false,
  className = "",
  size = "md",
  legend = false,
  unavailable,
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
  /**
   * Why a market cannot be pressed — see {@link SwitchTrack}.
   *
   * A **reason** rather than a `taken` boolean, and the reason belongs to the
   * caller rather than to this file: the columns picker checks a press against
   * the whole column it would write, so what is greyed here is a *column* a
   * sibling bay holds and not a board. A string spelled in here would be a
   * second wording of one rule, on one of the five tracks in that panel.
   */
  unavailable?: (board: KtcBoardChoice) => string | null;
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
      unavailable={unavailable}
    />
  );
}

export function KtcLineupKeys({
  lineup,
  onChange,
  className = "",
  size = "sm",
  legend = false,
  unavailable,
}: {
  lineup: KtcLineupChoice;
  onChange: (lineup: KtcLineupChoice) => void;
  className?: string;
  size?: Size;
  legend?: boolean;
  /** Why a QB board cannot be pressed — see {@link KtcBoardKeys.unavailable}. */
  unavailable?: (lineup: KtcLineupChoice) => string | null;
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
      unavailable={unavailable}
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
 * Three things generalised with it, and each is a state the two KTC axes never
 * had. `value` may be **null** — a switch standing off every detent, where a
 * market always has an answer; `unavailable` returns a *reason* rather than a
 * boolean, because a key can be off for reasons that are not "another bay holds
 * it" (there is no whole-roster projection, and only KeepTradeCut prices a
 * pick), and a key that is off says which in its title; and `value` may be an
 * **array**, which is the multi-select mode the position axis needs.
 *
 * **Multi-select is a second position for one switch, not a second track.** The
 * nine position keys toggle independently and `All` is lit exactly when none of
 * them is — nine keys and a tenth in a channel of their own, hand-spelled beside
 * this one, is precisely the duplication the module note above rules out: a
 * track that stopped travelling in one of two spellings is a panel nobody can
 * see is broken. The mode is `Array.isArray(value)` rather than a flag, because
 * the array *is* the switch's position and a boolean beside it would be a second
 * thing to keep in step with it.
 *
 * **The caller maps its own state into the track's vocabulary**, which is what
 * lets `All` be a key here and the absence of a narrowing everywhere else: the
 * track lights what it is handed and the caller owns the toggle, exactly as the
 * single-select arm lights `value` and the caller owns the write.
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
  divider,
}: {
  label: string;
  /** Draw the label beside the track. Otherwise it is the group's name alone. */
  legend?: boolean;
  options: readonly T[];
  /**
   * The switch's position: one detent, none at all, or — as an array — every
   * one of several. An array is what puts the track in multi-select.
   */
  value: T | readonly T[] | null;
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
   * already enforces its bounds by: two bays on one metric differ only by these
   * keys, so a press that landed on the pricing the other bay holds would have
   * to either lose a column or exchange the two — one silent, the other a key
   * that appears dead once the canonical order puts them back where they were.
   * The reason is the key's `title`, so a reader can find out *why* it is off
   * rather than being left to guess between "taken" and "does not exist".
   *
   * **A lit key is skipped on a single-select track and asked on a
   * multi-select one** — see the call below, where that asymmetry is argued: a
   * lit key's press means "again" in one mode and "off" in the other, and only
   * the second can land on a column somebody else holds.
   */
  unavailable?: (option: T) => string | null;
  /**
   * Break the track with a milled hairline *before* this option.
   *
   * The position axis is what wants it — `K` and `DEF` sit with the four skill
   * positions and the three individual-defender families sit apart from both,
   * because those are the groups a league actually starts. It is a cut in the
   * channel rather than three tracks, since a reader is choosing from one list
   * and three tracks would say they were choosing three times.
   */
  divider?: (option: T) => boolean;
}) {
  const row = size === "row";
  const small = size === "sm" || row;
  // The array is the mode. `chosen` is null on a single-select track, which is
  // what keeps `value === option` the test there rather than a one-element
  // array a caller would have to remember to build.
  const chosen = Array.isArray(value) ? (value as readonly T[]) : null;
  const keys = (
    <div
      role="group"
      aria-label={label}
      className={`${
        // **The row arm is a deeper recess than the other two**, and it has to
        // be: its lit key is a raised face carrying a riser and a cast, where
        // `CONSOLE_TRACK`'s key is flush enough for `--key-shadow`. A raised
        // face in a shallow channel reads as a key sitting *on* the track
        // rather than travelling in it.
        row ? CONSOLE_CHANNEL : CONSOLE_TRACK
      } ${
        small ? "flex p-[0.1875rem]" : "inline-flex gap-1 p-1"
      } ${
        row
          ? // The gap tightens below `sm` with the key's own gutter — see the
            // measurement on the key's padding, which is one arithmetic and
            // has to move in step with this.
            "min-w-0 flex-1 items-stretch gap-0.5 sm:gap-[0.1875rem]"
          : small
            ? "gap-0.5"
            : ""
      } ${className}`}
    >
      {options.map((option) => {
        const lit = chosen ? chosen.includes(option) : value === option;
        // **A lit key is skipped only on a single-select track**, and the
        // asymmetry is the difference between the two modes rather than an
        // oversight: there, pressing the lit option rewrites the same column and
        // there is nothing a sibling could hold that this does not already; here,
        // pressing a lit key *removes* that option, which is a different column
        // and one a sibling may hold. Asking every key in multi-select is what
        // stops a reader pressing a lit position and watching nothing happen.
        const why =
          !chosen && lit ? null : (unavailable?.(option) ?? null);
        return (
          <Fragment key={option}>
            {divider?.(option) && <MilledHairline />}
            <button
              type="button"
              onClick={() => onChange(option)}
              // Correct in both modes: a single-select track is a row of
              // toggles of which exactly one is on, and a multi-select one is
              // the same row without that constraint.
              aria-pressed={lit}
              // Two different reasons a key can be off, and only one of them is
              // about this key: `why` is about this option — another bay holds
              // the pricing, or the pairing has no metric behind it — where
              // `disabled` means the whole axis is out of force. The first
              // explains itself in a title; the second is explained by whatever
              // turned the track off, so a title here would be a second answer.
              disabled={disabled || why !== null}
              title={why ?? undefined}
              className={
                "lab-anim min-w-0 truncate rounded-full border font-mono uppercase " +
                "transition-[color,box-shadow,transform] duration-150 " +
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 " +
                "disabled:cursor-not-allowed " +
                (row
                  ? // **The gutter and the tracking are measured, not chosen,
                    // and the position axis is what measures them.** At 390 the
                    // case is 358px, which leaves the axes housing 298 and the
                    // track 292 inside its own padding; ten keys, eleven 3px
                    // gaps and two hairlines is 25.7px a key, of which the
                    // design's `px-1` and 0.04em leave 17.7px against `DEF` at
                    // ~21.9 — every defensive key clipped to two characters, on
                    // the one axis whose whole point is naming a position. At
                    // 2px gaps, `px-0.5` and no tracking it is 22.8 against
                    // 20.5. From `sm` up the case is 560, the track 412 and the
                    // design's own figures are comfortable, so they are what a
                    // desktop draws.
                    "flex-1 px-0.5 py-1.5 text-[length:var(--fs-10)] tracking-normal sm:px-1 sm:tracking-[0.04em] "
                  : small
                    ? "flex-1 px-1 py-[0.1875rem] text-[length:var(--fs-8-5)] tracking-[0.1em] "
                    : "px-3 py-1.5 text-[length:var(--fs-10)] tracking-[0.16em] ") +
                (lit
                  ? row
                    ? // The riser is composed whole rather than layered beside
                      // a resting one: a shadow list is atomic, so a second
                      // `shadow-[…]` would replace all four rather than adding
                      // to them. `motion-safe:` on the travel because
                      // `.lab-anim` clears the transition and not the transform
                      // — a lift written without it would still jump under
                      // reduced motion, which is the thing the preference is
                      // about.
                      "border-active/50 bg-[image:var(--key-metal)] text-readout [text-shadow:var(--readout-text-glow)] " +
                      "motion-safe:-translate-y-px " +
                      "shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_3px_0_rgba(0,0,0,0.65),0_7px_12px_-6px_rgba(0,0,0,0.95),0_0_20px_-5px_var(--accent-glow)]"
                    : "border-active/45 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]"
                  : why !== null
                    ? `cursor-not-allowed border-transparent ${row ? "text-foreground/26" : "text-foreground/25"}`
                    : `border-transparent ${row ? "text-foreground/60" : "text-foreground/58"} hover:text-readout`)
              }
            >
              {labels[option]}
            </button>
          </Fragment>
        );
      })}
    </div>
  );

  if (!legend) return keys;

  // The legend is `aria-hidden` because the group it labels already carries
  // the same string as its accessible name — a visible copy on top of that
  // would announce the axis twice.
  //
  // **It stacks below `sm`, and that is what makes ten position keys fit.** At
  // 78px plus its gap the legend takes 88 of the 328px the axes housing has at
  // a phone's width, which leaves ~20px a key against `DEF` at 20.5 — every
  // defensive key truncated to two characters. Stacked, the track has the
  // housing's full width and `DEF` clears it. A stamped caption rather than a
  // readout's ink: it is a label milled into the key stock the row stands on,
  // and drawing it in mint would say the housing was a window.
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2.5">
      <span
        aria-hidden
        className="font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-[color:var(--billet-label)] sm:w-[4.875rem] sm:shrink-0"
      >
        {label}
      </span>
      {keys}
    </div>
  );
}
