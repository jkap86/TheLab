"use client";

import type { ReactNode } from "react";

import { CONSOLE_WINDOW, Scanlines } from "@/features/shared";

/**
 * The comps page's small parts: a lamp key, a weight rail, a lit window and
 * the caption every control wears. They are this folder's own — nothing else
 * draws a weighted rail — and they exist so the criteria panel and the pool
 * strip cannot draw the same key two ways.
 */

/** The `--fs-9` caption on every control: `Pool`, `Seasons`, `Matched on`. */
export const CAPTION =
  "font-mono text-[length:var(--fs-9)] uppercase tracking-[0.18em] text-foreground/60";

/** Readout ink with the readout's own glow — a lit figure. */
export const LIT = "text-readout [text-shadow:var(--readout-text-glow)]";

/**
 * A key with a lamp: the criterion keys and the two pool keys.
 *
 * The state is composed as `shape + state` on `CONSOLE_KEY_PILL`'s rule — the
 * on and off colours are two class sets rather than one string with an
 * override appended, since two `border-*` utilities of the same specificity
 * are decided by Tailwind's emit order. Both states keep `--key-bg`; what
 * moves is the border, the ink, the shadow's travel and the lamp.
 */
export function ToggleKey({
  on,
  onClick,
  children,
  className = "",
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex min-w-0 items-center gap-2 rounded-[0.625rem] border bg-[image:var(--key-bg)] px-[0.6875rem] py-[0.4375rem] text-left font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] transition-[color,box-shadow,border-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
        on
          ? "border-active/45 text-readout shadow-[var(--key-shadow)]"
          : "border-foreground/10 text-foreground/60 shadow-[var(--key-shadow-pressed)]"
      } ${className}`}
    >
      <Lamp on={on} />
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/** The lamp dot a toggle key carries. */
export function Lamp({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
        on ? "bg-active shadow-[0_0_8px_var(--accent-glow)]" : "bg-foreground/22"
      }`}
    />
  );
}

/**
 * A rail: a cut channel with a lit fill, and the `.lab-rail` input over it.
 *
 * A range input's thumb is a pseudo-element, so this is the one place the
 * page cannot be expressed as utilities — the thumb is `.lab-rail` in
 * `globals.css`, the timeline scrubber's own rule, and everything else here
 * is the track and the fill drawn behind the transparent input. The fill is
 * the value's share of the range so a reader can see a weight without
 * reading it.
 */
export function Rail({
  value,
  min,
  max,
  step,
  label,
  onChange,
  className = "",
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  /** A real accessible name: `"<criterion> · <window> weight"`. */
  label: string;
  onChange: (value: number) => void;
  className?: string;
}) {
  const fill = Math.round(((value - min) / (max - min)) * 100);
  return (
    <span className={`relative block h-6 ${className}`}>
      <span
        aria-hidden
        className="absolute inset-x-0 top-[0.5625rem] h-1.5 rounded-full bg-[color:var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)]"
      />
      <span
        aria-hidden
        className="absolute left-0 top-[0.5625rem] h-1.5 rounded-full bg-active/70"
        style={{ width: `${fill}%` }}
      />
      <input
        className="lab-rail absolute inset-0 w-full"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
    </span>
  );
}

/** A lit window set into the housing, with its scanlines. */
export function Window({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section";
}) {
  return (
    <Tag className={`${CONSOLE_WINDOW} rounded-[0.6875rem] ${className}`}>
      <Scanlines />
      {children}
    </Tag>
  );
}
