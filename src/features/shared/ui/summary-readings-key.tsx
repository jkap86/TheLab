"use client";

import type { MouseEvent } from "react";

import { CONSOLE_KEY_PILL_BARE } from "../console-chrome";

/**
 * The key on an open card's seam that brings its summary readings back.
 *
 * Both league cards fold two readings away while they are open — see
 * `SummaryFold` — and this is the one control that un-folds them, in place,
 * without closing the card. It is lit while they are shown and its caret is
 * rotated; `aria-pressed` carries the same state for a reader who cannot see
 * either. The manager card labels it `Ranks` and the lineup checker `Checks`,
 * because what each folds is four ranks and four checks respectively, and the
 * sentence in `title` names both parts the press brings back.
 *
 * **It sits on the panel's seam, never in the `<summary>`**, for
 * `LeagueSyncKey`'s reason: a `<summary>` maps to a leaf button in the
 * accessibility tree, so a control nested in one is unreliably reachable. The
 * seam is also where the reader's eye already is when the panel opens, and the
 * one row on an open card that is neither the summary nor the lists.
 *
 * **`stopPropagation` on the press**, as the design asks. The card's disclosure
 * is driven from a click on the summary and this key is inside the same
 * `<details>`; a `<details>` toggles on its summary alone, so the guard costs
 * nothing today and is what keeps a later listener higher up from reading a
 * press on this key as a press on the card.
 *
 * **The chrome is the panel-seam key idiom** — the bare pill on `--key-bg`
 * under `--key-shadow`, 22px tall and 28 on a coarse pointer, at the row's
 * own `--fs-11` and `0.16em`. It composes `CONSOLE_KEY_PILL_BARE` rather than
 * the shell, because the shell's type size and tracking are arbitrary values
 * and a second of either is decided by Tailwind's emit order; the bare shape
 * names neither. The two state strings are whole for the same reason.
 *
 * **The caret rotates rather than swapping glyphs**, so the press reads as the
 * same key turning: `rotate-90` is Tailwind's own `rotate` property, which
 * `transition-transform` covers, and the span carries `.lab-anim` so reduced
 * motion turns it in one frame.
 */
export function SummaryReadingsKey({
  label,
  title,
  shown,
  onToggle,
}: {
  /** `Ranks` or `Checks` — what this card's fold puts away. */
  label: string;
  /** The sentence naming what the press brings back. */
  title: string;
  /** Whether the readings are on screen — the key's lit state. */
  shown: boolean;
  onToggle: () => void;
}) {
  const press = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggle();
  };

  return (
    <button
      type="button"
      onClick={press}
      aria-pressed={shown}
      title={title}
      className={`${CONSOLE_KEY_PILL_BARE} inline-flex h-[22px] items-center gap-[7px] bg-[image:var(--key-bg)] px-3 text-[length:var(--fs-11)] tracking-[0.16em] shadow-[var(--key-shadow)] touch:h-7 ${
        shown
          ? "border-active/45 text-readout [text-shadow:var(--readout-text-glow)]"
          : "border-foreground/10 text-foreground/80 hover:text-readout"
      }`}
    >
      {label}
      <span className="sr-only"> — {title}</span>
      <span
        aria-hidden
        className={`lab-anim inline-block w-[9px] text-[length:var(--fs-12)] leading-none transition-transform duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
          shown ? "rotate-90" : "rotate-0"
        }`}
      >
        ▸
      </span>
    </button>
  );
}
